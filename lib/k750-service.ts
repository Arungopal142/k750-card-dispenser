import {
  STX, ACK, NAK, DEFAULT_ADDH, DEFAULT_ADDL,
  buildENQ, buildAPPacket, buildFC7Packet, buildFC0Packet,
  buildRSPacket, buildGVPacket,
  buildNfcSearchPacket, buildNfcSerialPacket, buildNfcAuthPacket,
  buildNfcReadBlockPacket, buildNfcHaltPacket,
  chipCommandCode, parseCardResponse, NFC_PM, NFC_CHIP_TYPES,
  bytesToHex, bytesToHexCompact, parseNFResponse,
  type NfcChipType,
  type StatusBytes,
  type StatusFlags, getStatusFlags,
} from "./k750-protocol";

export type { NfcChipType } from "./k750-protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ErrorCode =
  | "NOT_CONNECTED"
  | "BOX_EMPTY"
  | "CARD_JAM"
  | "CARD_OVERLAP"
  | "CARD_IN_CHANNEL"
  | "ISSUE_ERROR"
  | "DISPENSE_FAILED"
  | "EJECT_TIMEOUT"
  | "FC7_TIMEOUT"
  | "NO_RESPONSE"
  | "NAK_RECEIVED"
  | "USB_DISCONNECTED"
  | "PERMISSION_DENIED"
  | "DEVICE_BUSY"
  | "NO_CARD_AT_READER"
  | "NFC_NO_CARD"
  | "NFC_READ_FAILED"
  | "UNKNOWN_ERROR";

export interface DeviceStatus {
  raw: StatusBytes;
  flags: StatusFlags;
  hex: string;
}

export interface IssueResult {
  success: boolean;
  message: string;
  errorCode?: ErrorCode;
  status?: DeviceStatus;
  /** UID of the card that was dispensed, when the NFC read succeeded. */
  uid?: string;
  chipType?: NfcChipType;
}

export interface NfcReadResult {
  success: boolean;
  message: string;
  errorCode?: ErrorCode;
  chipType?: NfcChipType;
  /** Uppercase hex, no separators (e.g. "04A23F19"). */
  uid?: string;
  uidBytes?: number[];
}

export interface NfcBlockResult {
  success: boolean;
  message: string;
  errorCode?: ErrorCode;
  /** 16 raw bytes of the block. */
  data?: number[];
  hex?: string;
}

export type LogEntry = {
  timestamp: number;
  direction: "TX" | "RX" | "INFO";
  hex: string;
  text?: string;
};

const SERIAL_OPTIONS: SerialOptions = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" };
const CMD_DELAY = 300;
const POLL_INTERVAL = 300;
const FC7_TIMEOUT = 12000;
const EJECT_TIMEOUT = 8000;
const ACK_TIMEOUT = 1000;
// The RF field needs a moment to settle after the card lands at the reader,
// so a search is retried a few times before a chip family is ruled out.
const NFC_SEARCH_RETRIES = 2;
const NFC_SEARCH_DELAY = 150;
/** Factory-default Mifare key — used when readNfcBlock() is called without one. */
const DEFAULT_MIFARE_KEY = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

// ---- Ring Buffer ----
class RingBuffer {
  private buf: number[] = [];
  private waiters: (() => void)[] = [];

  push(...bytes: number[]) {
    this.buf.push(...bytes);
    while (this.waiters.length > 0 && this.buf.length > 0) {
      this.waiters.shift()!();
    }
  }

  drain(n: number): number[] { return this.buf.splice(0, n); }
  get length() { return this.buf.length; }
  clear() { this.buf.length = 0; }

  waitForData(timeoutMs: number): Promise<boolean> {
    if (this.buf.length > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      // eslint-disable-next-line prefer-const
      let timer: ReturnType<typeof setTimeout>;
      const ok = () => { clearTimeout(timer); resolve(true); };
      this.waiters.push(ok);
      timer = setTimeout(() => {
        const idx = this.waiters.indexOf(ok);
        if (idx !== -1) this.waiters.splice(idx, 1);
        resolve(false);
      }, timeoutMs);
    });
  }
}

// ---- Service ----
export class K750Service {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _connected = false;
  private readerActive = false;
  private ringBuf = new RingBuffer();
  private addH = DEFAULT_ADDH;
  private addL = DEFAULT_ADDL;
  private transactLock: Promise<void> = Promise.resolve();
  private _busy = false;
  private _manualDisconnect = false;
  private _autoReconnect = true;
  private _pendingPorts: SerialPort[] = [];
  private disconnectHandler?: (event: { port: SerialPort }) => void;

  get isBusy() { return this._busy; }

  onLog?: (entry: LogEntry) => void;
  onStatusChange?: (status: DeviceStatus | null) => void;
  onConnectionChange?: (state: ConnectionState) => void;

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.transactLock;
    let release!: () => void;
    this.transactLock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this._busy = true;
    try {
      return await fn();
    } finally {
      this._busy = false;
      release();
    }
  }

  private log(direction: "TX" | "RX" | "INFO", data: Uint8Array | number[], text?: string) {
    const hex = typeof data === "object" && "length" in data ? bytesToHex(data) : String(data);
    this.onLog?.({ timestamp: Date.now(), direction, hex, text });
  }

  private delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
  get isConnected(): boolean { return this._connected; }

  // ---- List all available serial ports ----
  async getAvailablePorts(): Promise<SerialPort[]> {
    try {
      if (navigator.serial) {
        return await navigator.serial.getPorts();
      }
    } catch { /* */ }
    return [];
  }

  // ---- Auto-connect to available device ----
  async autoConnect(): Promise<boolean> {
    try {
      const ports = await this.getAvailablePorts();
      if (ports.length > 0) {
        this._manualDisconnect = false;
        await this.connectToPort(ports[0]);
        return true;
      }
    } catch { /* */ }
    return false;
  }

  // ---- Connect to specific port ----
  private async connectToPort(port: SerialPort): Promise<void> {
    try {
      this.onConnectionChange?.("connecting");
      await port.open(SERIAL_OPTIONS);
      this.port = port;
      this._connected = true;
      this._manualDisconnect = false;

      if (port.readable) this.reader = port.readable.getReader();
      if (port.writable) this.writer = port.writable.getWriter();

      // Detect USB disconnect
      const handleDisconnect = (event: { port: SerialPort }) => {
        if (event.port === this.port && this._connected) {
          this.log("INFO", [], "USB DISCONNECTED");
          this._connected = false;
          this.readerActive = false;
          this.onConnectionChange?.("error");
          this.onStatusChange?.(null);
          // Auto-reconnect if not manual disconnect
          if (!this._manualDisconnect && this._autoReconnect) {
            this.attemptReconnect();
          }
        }
      };
      navigator.serial.addEventListener("disconnect", handleDisconnect);
      this.disconnectHandler = handleDisconnect;

      try {
        const info = port.getInfo();
        this.log("INFO", [], `Port: vendor=0x${(info.usbVendorId ?? 0).toString(16).padStart(4, "0")} product=0x${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`);
      } catch { /* not USB */ }

      this.startReaderLoop();
      this.onConnectionChange?.("connected");
      this.log("INFO", [], "Connected - reader loop started");

      this.log("INFO", [], "Health check: querying AP...");
      const status = await this.queryAP();
      if (!status) {
        this.log("INFO", [], "Health check FAILED: no response");
      } else {
        this.log("INFO", [], "Health check OK");
      }
    } catch (err) {
      this._connected = false;
      this.onConnectionChange?.("error");
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `Connection failed: ${msg}`);
      throw err;
    }
  }

  // ---- Attempt reconnection ----
  private async attemptReconnect(): Promise<void> {
    this.log("INFO", [], "Attempting auto-reconnect...");
    this.onConnectionChange?.("connecting");
    
    const maxAttempts = 10;
    const delayMs = 2000;
    
    for (let i = 0; i < maxAttempts; i++) {
      await this.delay(delayMs);
      try {
        const ports = await this.getAvailablePorts();
        if (ports.length > 0) {
          await this.connectToPort(ports[0]);
          this.log("INFO", [], "Auto-reconnect successful");
          return;
        }
      } catch { /* */ }
      this.log("INFO", [], `Reconnect attempt ${i + 1}/${maxAttempts} failed`);
    }
    this.log("INFO", [], "Auto-reconnect failed after max attempts");
  }

  // ---- Connect / Disconnect ----
  async connect(): Promise<void> {
    this._manualDisconnect = false;
    try {
      this.onConnectionChange?.("connecting");

      // Show all serial devices
      const port = await navigator.serial.requestPort();

      await this.connectToPort(port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // User clicked Cancel — don't change state
      if (msg.includes("cancelled") || msg.includes("aborted") || msg.includes("NotFoundError")) {
        this.onConnectionChange?.("disconnected");
        this.log("INFO", [], "Port selection cancelled by user");
        return;
      }

      this._connected = false;
      this.onConnectionChange?.("error");
      if (msg.includes("permission") || msg.includes("Permission")) {
        this.log("INFO", [], "PERMISSION DENIED: Serial port access denied by user");
      } else {
        this.log("INFO", [], `Connection failed: ${msg}`);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this._manualDisconnect = true;
    this._connected = false;
    this.readerActive = false;
    if (this.disconnectHandler) {
      navigator.serial.removeEventListener("disconnect", this.disconnectHandler);
      this.disconnectHandler = undefined;
    }
    try { if (this.reader) { await this.reader.cancel().catch(() => {}); this.reader.releaseLock(); this.reader = null; } } catch { /* */ }
    try { if (this.writer) { this.writer.releaseLock(); this.writer = null; } } catch { /* */ }
    try { if (this.port) { await this.port.close(); this.port = null; } } catch { /* */ }
    this.ringBuf.clear();
    this.onConnectionChange?.("disconnected");
    this.onStatusChange?.(null);
    this.log("INFO", [], "Disconnected");
  }
  private startReaderLoop() {
    if (this.readerActive) return;
    this.readerActive = true;
    this.readerLoop();
  }

  private async readerLoop() {
    while (this.readerActive && this._connected) {
      try {
        if (!this.reader) break;
        const { value, done } = await this.reader.read();
        if (done) {
          if (this._connected) {
            this.log("INFO", [], "Stream done - recreating reader in 100ms");
            await this.delay(100);
            this.recreateReader();
          }
          continue;
        }
        if (!value || value.length === 0) continue;
        const bytes = Array.from(value);
        this.ringBuf.push(...bytes);
        this.log("RX", bytes);
      } catch (err) {
        if (!this._connected) break;
        this.log("INFO", [], `Reader error: ${err instanceof Error ? err.message : String(err)} - recreating in 100ms`);
        await this.delay(100);
        this.recreateReader();
      }
    }
    this.readerActive = false;
  }

  private recreateReader() {
    if (!this.port || !this._connected) return;
    try {
      if (this.reader) { try { this.reader.releaseLock(); } catch { /* ok */ } }
      if (this.port.readable) { this.reader = this.port.readable.getReader(); }
    } catch (err) {
      this.log("INFO", [], `Reader recreate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Ring buffer consumer ----
  private async consumeFromBuffer(
    timeoutMs: number,
    matcher: (buf: number[]) => { ready: boolean; slice: number[] }
  ): Promise<number[] | null> {
    const deadline = Date.now() + timeoutMs;
    const collected: number[] = [];
    while (Date.now() < deadline) {
      if (this.ringBuf.length > 0) {
        collected.push(...this.ringBuf.drain(this.ringBuf.length));
        const result = matcher(collected);
        if (result.ready) return result.slice;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this.ringBuf.waitForData(Math.min(remaining, 50));
    }
    return collected.length > 0 ? collected : null;
  }

  private matchAckNak(buf: number[]) {
    const first = buf[0];
    if (first === ACK || first === NAK) return { ready: buf.length >= 3, slice: buf.slice(0, 3) };
    if (first === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  private matchResponse(buf: number[]) {
    if (buf.length === 0) return { ready: false, slice: [] };
    if (buf[0] === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  // ---- Transact ----
  private async transact(packet: Uint8Array, expectResponse: boolean): Promise<number[] | null> {
    return this.withLock(async () => {
      this.log("TX", packet);
      this.ringBuf.clear();
      await this.writer!.write(packet);
      await this.delay(CMD_DELAY);

      const ackResp = await this.consumeFromBuffer(ACK_TIMEOUT, this.matchAckNak.bind(this));
      if (!ackResp) { this.log("INFO", [], "transact: no ACK/NAK (timeout)"); return null; }

      const first = ackResp[0];
      if (first === STX) { this.log("RX", ackResp, "Tolerant: STX directly"); return ackResp; }
      if (first === NAK) { this.log("RX", ackResp, "NAK - aborting"); return null; }
      if (first !== ACK) { this.log("RX", ackResp, `Unexpected: 0x${first.toString(16)}`); return null; }
      this.log("RX", ackResp, "ACK");

      const enq = buildENQ(this.addH, this.addL);
      this.log("TX", enq, "ENQ");
      this.ringBuf.clear();
      await this.writer!.write(enq);
      await this.delay(CMD_DELAY);

      if (expectResponse) {
        const resp = await this.consumeFromBuffer(3000, this.matchResponse.bind(this));
        if (resp) { this.log("RX", resp, resp[0] === STX ? "RESPONSE" : `unexpected: 0x${resp[0].toString(16)}`); }
        else { this.log("INFO", [], "transact: no RESPONSE after ENQ"); }
        return resp;
      }
      return [];
    });
  }

  // ---- AP status ----
  async queryAP(): Promise<DeviceStatus | null> {
    if (!this.isConnected) return null;
    try {
      const resp = await this.transact(buildAPPacket(this.addH, this.addL), true);
      if (!resp) return null;
      return this.parseAPResponse(resp);
    } catch { return null; }
  }

  private parseAPResponse(response: number[]): DeviceStatus | null {
    if (response.length < 13 || response[0] !== STX) return null;
    const len = (response[3] << 8) | response[4];
    if (len < 6) return null;
    if (response[5] !== 0x53 || response[6] !== 0x46) {
      this.log("INFO", [], `AP missing SF: 0x${response[5]?.toString(16)} 0x${response[6]?.toString(16)}`);
      return null;
    }
    const rawHexChars = response.slice(7, 7 + len - 2);
    const hexStr = rawHexChars.map((b) => String.fromCharCode(b)).join("");
    const byte3 = parseInt(hexStr.substring(0, 2), 16) || 0;
    const byte4 = parseInt(hexStr.substring(2, 4), 16) || 0;
    this.log("INFO", [], `AP parse: hexStr="${hexStr}" raw=[${rawHexChars.map(b => b.toString(16).padStart(2, "0")).join(" ")}] → B3=0x${byte3.toString(16).padStart(2, "0")} B4=0x${byte4.toString(16).padStart(2, "0")}`);
    const statusBytes = { byte1: 0, byte2: 0, byte3, byte4 };
    const deviceStatus: DeviceStatus = { raw: statusBytes, flags: getStatusFlags(statusBytes), hex: bytesToHex(response) };
    this.onStatusChange?.(deviceStatus);
    return deviceStatus;
  }

  // ---- Movement commands ----
  async dispenseFC7(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC7: dispense...");
    const resp = await this.transact(buildFC7Packet(this.addH, this.addL), false);
    if (resp === null) { this.log("INFO", [], "FC7: NAK or no ACK"); return false; }
    if (resp[0] === STX) {
      const nf = parseNFResponse(resp);
      if (nf) {
        this.log("INFO", [], `FC7 REJECTED: NF code=0x${nf.errorCode.toString(16).padStart(2, "0")} — ${nf.errorName}`);
        return false;
      }
    }
    this.log("INFO", [], "FC7: polling AP...");
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < FC7_TIMEOUT) {
      await this.delay(POLL_INTERVAL); n++;
      const st = await this.queryAP();
      if (st) {
        this.log("INFO", [], `FC7 #${n}: b4=0x${st.raw.byte4.toString(16).padStart(2, "0")} S3=${st.flags.cardAtSensor3}`);
        if (st.flags.cardAtSensor3) { this.log("INFO", [], "FC7: card at reader"); return true; }
      } else { this.log("INFO", [], `FC7 #${n}: no AP`); }
    }
    this.log("INFO", [], `FC7: timeout after ${n} polls`);
    return false;
  }

  async ejectFC0(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC0: eject...");
    const resp = await this.transact(buildFC0Packet(this.addH, this.addL), false);
    if (resp === null) { this.log("INFO", [], "FC0: NAK"); return false; }
    this.log("INFO", [], "FC0: polling...");
    const t0 = Date.now();
    while (Date.now() - t0 < EJECT_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      const st = await this.queryAP();
      if (st && (st.raw.byte4 & 0x07) === 0) { this.log("INFO", [], "FC0: clear"); return true; }
    }
    this.log("INFO", [], "FC0: timeout");
    return false;
  }



  async resetDevice(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "RS: reset...");
    return (await this.transact(buildRSPacket(this.addH, this.addL), false)) !== null;
  }

  async getVersion(): Promise<string | null> {
    if (!this.isConnected) return null;
    try {
      const resp = await this.transact(buildGVPacket(this.addH, this.addL), true);
      if (!resp || resp[0] !== STX) return null;
      const len = (resp[3] << 8) | resp[4];
      const ver = resp.slice(5, 5 + len).filter((b) => b >= 0x20 && b <= 0x7e).map((b) => String.fromCharCode(b)).join("");
      this.log("INFO", [], `GV: ${ver}`);
      return ver;
    } catch { return null; }
  }

  // ---- Contactless (NFC) card read ----

  /** Run one contactless command and decode its P/N response frame. */
  private async nfcTransact(packet: Uint8Array, chip: NfcChipType, pm: number) {
    const resp = await this.transact(packet, true);
    if (!resp) return null;
    return parseCardResponse(resp, chipCommandCode(chip), pm);
  }

  /** Search (TypeA: activate) a card of the given family at the reader. */
  private async nfcSearch(chip: NfcChipType): Promise<number[] | null> {
    for (let attempt = 0; attempt <= NFC_SEARCH_RETRIES; attempt++) {
      if (attempt > 0) await this.delay(NFC_SEARCH_DELAY);
      const res = await this.nfcTransact(
        buildNfcSearchPacket(chip, this.addH, this.addL),
        chip,
        NFC_PM[chip].search
      );
      if (res?.ok) return res.data;
      if (res && !res.ok) {
        this.log("INFO", [], `NFC ${chip} search: ${res.errorName}`);
      }
    }
    return null;
  }

  private async nfcHalt(chip: NfcChipType): Promise<void> {
    try {
      await this.transact(buildNfcHaltPacket(chip, this.addH, this.addL), true);
    } catch { /* halt is best-effort */ }
  }

  /**
   * Read the UID of the card sitting at the reader position, probing the
   * chip families in order (S50 → S70 → UL → TypeA) until one answers.
   * The card must already be at sensor 3 — call dispenseFC7() first.
   */
  private async performNfcRead(): Promise<NfcReadResult> {
    for (const chip of NFC_CHIP_TYPES) {
      const searchData = await this.nfcSearch(chip);
      if (searchData === null) continue;

      // TypeA activate already returns the UID; the others need a serial read.
      let uidBytes: number[] | null;
      if (chip === "TypeA") {
        uidBytes = searchData;
      } else {
        const serial = await this.nfcTransact(
          buildNfcSerialPacket(chip, this.addH, this.addL),
          chip,
          NFC_PM[chip].serial
        );
        if (!serial?.ok) {
          this.log("INFO", [], `NFC ${chip}: serial read failed${serial ? ` — ${serial.errorName}` : " — no response"}`);
          await this.nfcHalt(chip);
          continue;
        }
        uidBytes = serial.data;
      }

      if (!uidBytes || uidBytes.length === 0) {
        await this.nfcHalt(chip);
        continue;
      }

      const uid = bytesToHexCompact(uidBytes);
      this.log("INFO", [], `NFC ${chip}: UID ${uid}`);
      await this.nfcHalt(chip);
      return { success: true, message: `${chip} card — UID ${uid}`, chipType: chip, uid, uidBytes };
    }

    this.log("INFO", [], "NFC: no card detected (S50/S70/UL/TypeA all failed)");
    return {
      success: false,
      message: "No NFC card detected at the reader.",
      errorCode: "NFC_NO_CARD",
    };
  }

  /**
   * Public NFC read. Verifies a card is at the reader first, so an operator
   * pressing "Read NFC" with an empty channel gets a clear message.
   */
  async readNfcCard(options: { requireCardAtReader?: boolean } = {}): Promise<NfcReadResult> {
    const { requireCardAtReader = true } = options;
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };
    if (this._busy) return { success: false, message: "Device busy — please wait.", errorCode: "DEVICE_BUSY" };

    if (requireCardAtReader) {
      const status = await this.queryAP();
      if (!status) return { success: false, message: "Cannot read device status.", errorCode: "NO_RESPONSE" };
      if (!status.flags.cardAtSensor3) {
        return {
          success: false,
          message: "No card at the reader position — dispense a card first.",
          errorCode: "NO_CARD_AT_READER",
        };
      }
    }

    this.log("INFO", [], "=== NFC read ===");
    return this.performNfcRead();
  }

  /**
   * Read one 16-byte data block from the card at the reader.
   * S50/S70 blocks are password-protected, so the sector key is checked first
   * (factory-default key when none is supplied). UL blocks need no key.
   */
  async readNfcBlock(
    chip: "S50" | "S70" | "UL",
    blockAddr: number,
    key: number[] = DEFAULT_MIFARE_KEY,
    keyType: "A" | "B" = "A"
  ): Promise<NfcBlockResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };
    if (this._busy) return { success: false, message: "Device busy — please wait.", errorCode: "DEVICE_BUSY" };

    const found = await this.nfcSearch(chip);
    if (found === null) {
      return { success: false, message: `No ${chip} card detected at the reader.`, errorCode: "NFC_NO_CARD" };
    }

    if (chip !== "UL") {
      const auth = await this.nfcTransact(
        buildNfcAuthPacket(chip, blockAddr, key, keyType, this.addH, this.addL),
        chip,
        NFC_PM[chip].auth
      );
      if (!auth?.ok) {
        await this.nfcHalt(chip);
        return {
          success: false,
          message: `Key ${keyType} rejected for block ${blockAddr}${auth ? ` — ${auth.errorName}` : ""}.`,
          errorCode: "NFC_READ_FAILED",
        };
      }
    }

    const read = await this.nfcTransact(
      buildNfcReadBlockPacket(chip, blockAddr, this.addH, this.addL),
      chip,
      NFC_PM[chip].read
    );
    await this.nfcHalt(chip);
    if (!read?.ok) {
      return {
        success: false,
        message: `Read of block ${blockAddr} failed${read ? ` — ${read.errorName}` : " — no response"}.`,
        errorCode: "NFC_READ_FAILED",
      };
    }
    const hex = bytesToHex(read.data);
    this.log("INFO", [], `NFC ${chip} block ${blockAddr}: ${hex}`);
    return { success: true, message: `Block ${blockAddr} read.`, data: read.data, hex };
  }

  // ---- Pre-issue check ----
  async preIssueCheck(): Promise<string | null> {
    const status = await this.queryAP();
    if (!status) return "Cannot read device status.";
    const { raw, flags } = status;
    if (flags.boxEmpty) return "Card box is empty.";
    if (raw.byte4 & 0x07) return "Card in channel — eject first.";
    if (flags.cardOverlap) return "Card overlap — press RS.";
    if (flags.cardJam) return "Card jam — press RS.";
    if (flags.issueError) return "Issue error — press RS.";
    if (flags.commandCannotExecute) return "Command cannot execute.";
    return null;
  }

  // ---- Issue flow ----
  async issueCard(employeeId: string, name: string, department: string): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };
    if (this._busy) return { success: false, message: "Device busy — please wait.", errorCode: "DEVICE_BUSY" };
    try {
      this.log("INFO", [], "=== Issue flow ===");

      this.log("INFO", [], "Step 1: Pre-check AP...");
      const block = await this.preIssueCheck();
      if (block) {
        const errorCode: ErrorCode = block.includes("empty") ? "BOX_EMPTY"
          : block.includes("jam") ? "CARD_JAM"
          : block.includes("overlap") ? "CARD_OVERLAP"
          : block.includes("channel") ? "CARD_IN_CHANNEL"
           : block.includes("Issue error") ? "ISSUE_ERROR"
           : "UNKNOWN_ERROR";
        return { success: false, message: block, errorCode };
      }

      this.log("INFO", [], "Step 2: FC7 dispense...");
      const dispensed = await this.dispenseFC7();
      if (!dispensed) {
        // Check if device is still connected after dispense attempt
        if (!this.isConnected) {
          return { success: false, message: "Device disconnected during dispense.", errorCode: "USB_DISCONNECTED" };
        }
        const status = await this.queryAP();
        let errorMsg = "Dispense failed — card did not reach reader.";
        let errorCode: ErrorCode = "DISPENSE_FAILED";
        if (status) {
          if (status.flags.cardJam) { errorMsg = "Card jam detected during dispense. Press RS to reset."; errorCode = "CARD_JAM"; }
          else if (status.flags.cardOverlap) { errorMsg = "Card overlap detected. Press RS to reset."; errorCode = "CARD_OVERLAP"; }
          else if (status.flags.boxEmpty) { errorMsg = "Card box is empty. Refill cards."; errorCode = "BOX_EMPTY"; }
        }
        return { success: false, message: errorMsg, errorCode, status: status ?? undefined };
      }

      // Step 3: read the card UID while it is still at the reader. A card
      // without a readable chip is still a valid issue, so this never blocks.
      this.log("INFO", [], "Step 3: NFC read...");
      const nfc = await this.performNfcRead();
      if (!nfc.success) this.log("INFO", [], `NFC read skipped: ${nfc.message}`);

      this.log("INFO", [], "Step 4: FC0 eject...");
      const ejected = await this.ejectFC0();
      if (!ejected) {
        if (!this.isConnected) {
          return { success: false, message: "Device disconnected during eject.", errorCode: "USB_DISCONNECTED", uid: nfc.uid, chipType: nfc.chipType };
        }
        return { success: false, message: "Card dispensed but eject timed out. Card may be at reader.", errorCode: "EJECT_TIMEOUT", uid: nfc.uid, chipType: nfc.chipType };
      }

      this.log("INFO", [], "=== SUCCESS ===");
      const status = await this.queryAP();
      const uidNote = nfc.uid ? ` UID ${nfc.uid}.` : "";
      return {
        success: true,
        message: `Card issued for ${name} (${employeeId} — ${department}) — please collect the card.${uidNote}`,
        status: status ?? undefined,
        uid: nfc.uid,
        chipType: nfc.chipType,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `FAILED: ${msg}`);
      if (msg.includes("disconnect") || msg.includes("device")) {
        return { success: false, message: "Device disconnected. Reconnect and try again.", errorCode: "USB_DISCONNECTED" };
      }
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    }
  }
}
