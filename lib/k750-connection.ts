import {
  STX, ACK, NAK, DEFAULT_ADDH, DEFAULT_ADDL,
  buildENQ, buildAPPacket, buildFC7Packet, buildDCPacket,
  buildFD0Packet, buildFD1Packet, buildDBPacket,
  buildRSPacket, buildGVPacket,
  buildCPPacket, buildFC0Packet, buildFC4Packet, buildFC6Packet, buildFC8Packet,
  buildFD2Packet, buildFD3Packet, buildFD4Packet, buildBEPacket, buildBDPacket,
  buildFC1Packet, buildFRPacket, addressBytes,
  buildRFPacket, buildFC2Packet, buildBFPacket, buildBGPacket,
  buildCSPacket, buildLPPacket, buildLFPacket, type BaudRate,
  buildNfcSearchPacket, buildNfcSerialPacket, buildNfcAuthPacket,
  buildNfcReadBlockPacket, buildNfcHaltPacket,
  chipCommandCode, parseCardResponse, NFC_PM, NFC_CHIP_TYPES, uidComesFromSearch,
  bytesToHex, bytesToHexCompact, parseNFResponse,
  parseAPStatusFromResponse, parseFC1Response, parseFRResponse,
  type NfcChipType,
  type StatusBytes,
  type StatusFlags, getStatusFlags,
  type DevicePosition,
} from "./k750-protocol";

export type { NfcChipType, BaudRate } from "./k750-protocol";

export interface NfcReadResult {
  success: boolean;
  message: string;
  chipType?: NfcChipType;
  /** Uppercase hex, no separators (e.g. "04A23F19"). */
  uid?: string;
  uidBytes?: number[];
}

/** Whether the contactless reader module itself is answering. */
export type NfcReaderState = "disconnected" | "unknown" | "ready" | "error";

/** What the reader currently sees at the read position. */
export type NfcCardState = "none" | "present" | "detected" | "unreadable";

export interface NfcState {
  reader: NfcReaderState;
  card: NfcCardState;
  uid?: string;
  chipType?: NfcChipType;
  /** Last thing that happened, for the subtitle line. */
  message?: string;
  updatedAt: number;
}

export interface NfcBlockResult {
  success: boolean;
  message: string;
  /** The 16 raw bytes of the block. */
  data?: number[];
  hex?: string;
}

// The RF field needs a moment to settle after a card lands at the reader, so a
// search is retried a few times before a chip family is ruled out.
const NFC_SEARCH_RETRIES = 2;
const NFC_SEARCH_DELAY = 150;
// How long to wait for the transport to stop before searching, and how long to
// let the card sit still over the antenna once it has.
const NFC_SETTLE_TIMEOUT = 3000;
const NFC_SETTLE_DELAY = 300;
/** Factory-default Mifare key — used when readNfcBlock() is called without one. */
const DEFAULT_MIFARE_KEY = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceStatus {
  raw: StatusBytes;
  flags: StatusFlags;
  hex: string;
}

export type LogEntry = {
  timestamp: number;
  direction: "TX" | "RX" | "INFO";
  hex: string;
  text?: string;
};

const SERIAL_OPTIONS: SerialOptions = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" };
const CMD_GAP = 300;
const ENQ_DELAY = 50;
const CMD_DELAY = 300;
const ACK_TIMEOUT = 1000;
const RESPONSE_TIMEOUT = 2000;

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

export class K750Connection {
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
  private _flowBusy = false;
  private _manualDisconnect = false;
  private _autoReconnect = true;
  private disconnectHandler?: (event: { port: SerialPort }) => void;
  private lastAPQueryTime = 0;
  private lastCommandTime = 0;
  private consecutiveFailures = 0;
  private _reconnecting = false;
  private _deviceAddress = 0;
  private _fc1Supported: boolean | null = null;
  private _nfcState: NfcState = { reader: "disconnected", card: "none", updatedAt: 0 };
  private _nfcSawAnswer = false;

  get nfcState(): NfcState { return this._nfcState; }

  /**
   * Merge a patch into the NFC state and notify listeners, but only when
   * something actually changed — queryAP runs on a 1s timer and must not
   * re-render the status panel on every tick.
   */
  private setNfcState(patch: Partial<Omit<NfcState, "updatedAt">>): void {
    const next: NfcState = { ...this._nfcState, ...patch, updatedAt: Date.now() };
    const same =
      next.reader === this._nfcState.reader &&
      next.card === this._nfcState.card &&
      next.uid === this._nfcState.uid &&
      next.chipType === this._nfcState.chipType &&
      next.message === this._nfcState.message;
    if (same) return;
    this._nfcState = next;
    this.onNfcStateChange?.(next);
  }

  get isConnected(): boolean { return this._connected; }
  get isBusy() { return this._busy; }
  get isFlowBusy() { return this._flowBusy; }
  get deviceAddress(): number { return this._deviceAddress; }

  onLog?: (entry: LogEntry) => void;

  private logListeners = new Set<(entry: LogEntry) => void>();

  /**
   * Subscribe to the comm log without taking the single `onLog` slot, which
   * CommLog and the device page already assign to. Returns an unsubscribe fn.
   */
  addLogListener(fn: (entry: LogEntry) => void): () => void {
    this.logListeners.add(fn);
    return () => { this.logListeners.delete(fn); };
  }
  onStatusChange?: (status: DeviceStatus | null) => void;
  onNfcStateChange?: (state: NfcState) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  onAutoReconnect?: () => void;

  // ─── Lock ────────────────────────────────────────────────

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

  log(direction: "TX" | "RX" | "INFO", data: Uint8Array | number[], text?: string) {
    const hex = typeof data === "object" && "length" in data ? bytesToHex(data) : String(data);
    const entry: LogEntry = { timestamp: Date.now(), direction, hex, text };
    this.onLog?.(entry);
    for (const fn of this.logListeners) {
      try { fn(entry); } catch { /* a listener must not break device I/O */ }
    }
  }

  delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  // ─── Connection ──────────────────────────────────────────

  async getAvailablePorts(): Promise<SerialPort[]> {
    try {
      if (navigator.serial) return await navigator.serial.getPorts();
    } catch { /* */ }
    return [];
  }

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

  private async connectToPort(port: SerialPort): Promise<void> {
    try {
      this.onConnectionChange?.("connecting");
      await port.open(SERIAL_OPTIONS);
      this.port = port;
      this._connected = true;
      this._manualDisconnect = false;

      if (port.readable) this.reader = port.readable.getReader();
      if (port.writable) this.writer = port.writable.getWriter();

      const handleDisconnect = (event: { port: SerialPort }) => {
        if (event.port === this.port && this._connected) {
          this.log("INFO", [], "USB DISCONNECTED");
          this._connected = false;
          this.readerActive = false;
          this.setNfcState({ reader: "disconnected", card: "none", uid: undefined, chipType: undefined, message: undefined });
          this.onConnectionChange?.("error");
          this.onStatusChange?.(null);
          if (!this._manualDisconnect && this._autoReconnect) {
            this.attemptReconnect();
          }
        }
      };
      if (this.disconnectHandler) {
        navigator.serial.removeEventListener("disconnect", this.disconnectHandler);
      }
      navigator.serial.addEventListener("disconnect", handleDisconnect);
      this.disconnectHandler = handleDisconnect;

      try {
        const info = port.getInfo();
        this.log("INFO", [], `Port: vendor=0x${(info.usbVendorId ?? 0).toString(16).padStart(4, "0")} product=0x${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`);
      } catch { /* not USB */ }

      this.startReaderLoop();
      this.setNfcState({ reader: "unknown", card: "none", uid: undefined, chipType: undefined, message: undefined });
      this.onConnectionChange?.("connected");
      this.log("INFO", [], "Connected - reader loop started");

      this.log("INFO", [], "Health check: querying AP...");
      let status = await this.queryAP();
      if (!status) {
        this.log("INFO", [], "Health check: no answer, scanning 0-15...");
        if ((await this.detectAddress()) !== null) status = await this.queryAP();
      }
      if (!status) {
        this.log("INFO", [], "Health check FAILED: no response");
      } else {
        this.log("INFO", [], `Health check OK (address ${this._deviceAddress})`);
        await this.queryPosition();
      }
    } catch (err) {
      this._connected = false;
      this.onConnectionChange?.("error");
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `Connection failed: ${msg}`);
      throw err;
    }
  }

  private async releasePort(): Promise<void> {
    this.readerActive = false;
    this._connected = false;
    if (this.reader) {
      try { await this.reader.cancel(); } catch { /* */ }
      try { this.reader.releaseLock(); } catch { /* */ }
      this.reader = null;
    }
    if (this.writer) {
      try { this.writer.releaseLock(); } catch { /* */ }
      this.writer = null;
    }
    if (this.port) {
      try { await this.port.close(); } catch { /* */ }
      this.port = null;
    }
    this.ringBuf.clear();
  }

  private async attemptReconnect(): Promise<void> {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.log("INFO", [], "Attempting auto-reconnect...");
    this.onConnectionChange?.("connecting");
    try {
      await this.releasePort();
      for (let i = 0; i < 10; i++) {
        await this.delay(2000);
        if (this._manualDisconnect) { this.log("INFO", [], "Auto-reconnect cancelled"); return; }
        try {
          const ports = await this.getAvailablePorts();
          if (ports.length > 0) { await this.connectToPort(ports[0]); this.log("INFO", [], "Auto-reconnect successful"); return; }
        } catch { await this.releasePort(); }
        this.log("INFO", [], `Reconnect attempt ${i + 1}/10 failed`);
      }
      this.onConnectionChange?.("error");
    } finally { this._reconnecting = false; }
  }

  async connect(): Promise<void> {
    this._manualDisconnect = false;
    try {
      this.onConnectionChange?.("connecting");
      const port = await navigator.serial.requestPort();
      await this.connectToPort(port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancelled") || msg.includes("aborted") || msg.includes("NotFoundError")) {
        this.onConnectionChange?.("disconnected");
        this.log("INFO", [], "Port selection cancelled by user");
        return;
      }
      this._connected = false;
      this.onConnectionChange?.("error");
      this.log("INFO", [], `Connection failed: ${msg}`);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this._manualDisconnect = true;
    if (this.disconnectHandler) {
      navigator.serial.removeEventListener("disconnect", this.disconnectHandler);
      this.disconnectHandler = undefined;
    }
    await this.releasePort();
    this.setNfcState({ reader: "disconnected", card: "none", uid: undefined, chipType: undefined, message: undefined });
    this.onConnectionChange?.("disconnected");
    this.onStatusChange?.(null);
    this.log("INFO", [], "Disconnected");
  }

  // ─── Reader loop ─────────────────────────────────────────

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
          if (this._connected) { await this.delay(100); this.recreateReader(); }
          continue;
        }
        if (!value || value.length === 0) continue;
        const bytes = Array.from(value);
        this.ringBuf.push(...bytes);
        this.log("RX", bytes);
      } catch (err) {
        if (!this._connected) break;
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
    } catch { /* */ }
  }

  // ─── Low-level transport ─────────────────────────────────

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
    return null;
  }

  private matchAckNak(buf: number[]) {
    const first = buf[0];
    if (first === ACK || first === NAK) return { ready: buf.length >= 3, slice: buf.slice(0, 3) };
    if (first === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      if (expected > 1024) return { ready: false, slice: [] };
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  private matchResponse(buf: number[]) {
    if (buf.length === 0) return { ready: false, slice: [] };
    if (buf[0] === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      if (expected > 1024) return { ready: false, slice: [] };
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  private async pace(): Promise<void> {
    const wait = CMD_GAP - (Date.now() - this.lastCommandTime);
    if (wait > 0) await this.delay(wait);
  }

  private async write(packet: Uint8Array): Promise<boolean> {
    if (!this.writer || !this._connected) {
      this.log("INFO", [], "write failed: port not open");
      return false;
    }
    await this.writer.write(packet);
    this.lastCommandTime = Date.now();
    return true;
  }

  private checkAutoReconnect(): void {
    if (this.consecutiveFailures >= 5 && this._connected && !this._manualDisconnect) {
      this.log("INFO", [], "5 consecutive failures — triggering auto-reconnect");
      this.consecutiveFailures = 0;
      this.onAutoReconnect?.();
      this.attemptReconnect();
    }
  }

  async transact(packet: Uint8Array, expectResponse: boolean): Promise<number[] | null> {
    return this.withLock(async () => {
      await this.pace();
      this.log("TX", packet);
      this.ringBuf.clear();
      if (!(await this.write(packet))) return null;

      const ackResp = await this.consumeFromBuffer(ACK_TIMEOUT, this.matchAckNak.bind(this));
      if (!ackResp) {
        this.log("INFO", [], "transact: no ACK/NAK (timeout)");
        this.consecutiveFailures++;
        this.checkAutoReconnect();
        return null;
      }

      const first = ackResp[0];
      if (first === STX) { this.log("RX", ackResp, "Tolerant: STX directly"); this.consecutiveFailures = 0; return ackResp; }
      if (first === NAK) { this.log("RX", ackResp, "NAK - aborting"); this.consecutiveFailures++; this.checkAutoReconnect(); return null; }
      if (first !== ACK) { this.log("RX", ackResp, `Unexpected: 0x${first.toString(16)}`); this.consecutiveFailures++; this.checkAutoReconnect(); return null; }
      this.log("RX", ackResp, "ACK");

      await this.delay(ENQ_DELAY);
      const enq = buildENQ(this.addH, this.addL);
      this.log("TX", enq, "ENQ");
      this.ringBuf.clear();
      if (!(await this.write(enq))) return null;

      if (expectResponse) {
        const resp = await this.consumeFromBuffer(RESPONSE_TIMEOUT, this.matchResponse.bind(this));
        if (resp) {
          this.log("RX", resp, `RESPONSE len=${resp.length} hex=[${resp.map(b => b.toString(16).padStart(2,"0")).join(" ")}]`);
          const nf = parseNFResponse(resp);
          if (nf) this.log("INFO", [], `Device error frame: ${nf.errorName} (0x${nf.errorCode.toString(16).padStart(2, "0")})`);
          this.consecutiveFailures = 0;
        } else {
          this.log("INFO", [], "transact: no RESPONSE after ENQ");
          this.consecutiveFailures++;
          this.checkAutoReconnect();
        }
        return resp;
      }
      this.consecutiveFailures = 0;
      return [];
    });
  }

  async sendCmdList2(packet: Uint8Array): Promise<boolean> {
    return this.withLock(async () => {
      await this.pace();
      this.log("TX", packet);
      this.ringBuf.clear();
      if (!(await this.write(packet))) return false;

      const ackResp = await this.consumeFromBuffer(ACK_TIMEOUT, this.matchAckNak.bind(this));
      if (!ackResp) {
        this.log("INFO", [], "sendCmdList2: no ACK/NAK (timeout)");
        this.consecutiveFailures++;
        this.checkAutoReconnect();
        return false;
      }

      const first = ackResp[0];
      if (first === NAK) { this.log("RX", ackResp, "NAK"); this.consecutiveFailures++; this.checkAutoReconnect(); return false; }
      if (first === ACK) {
        this.log("RX", ackResp, "ACK");
        await this.delay(ENQ_DELAY);
        const enq = buildENQ(this.addH, this.addL);
        this.log("TX", enq, "ENQ (execute)");
        this.ringBuf.clear();
        if (!(await this.write(enq))) return false;
        this.consecutiveFailures = 0;
        return true;
      }
      this.log("RX", ackResp, `Unexpected: 0x${first.toString(16)}`);
      this.consecutiveFailures++;
      this.checkAutoReconnect();
      return false;
    });
  }

  // ─── AP status query ─────────────────────────────────────

  async queryAP(): Promise<DeviceStatus | null> {
    if (!this.isConnected) return null;
    const now = Date.now();
    const elapsed = now - this.lastAPQueryTime;
    if (elapsed < 200) await this.delay(200 - elapsed);
    this.lastAPQueryTime = Date.now();
    try {
      const resp = await this.transact(buildAPPacket(this.addH, this.addL), true);
      if (!resp) return null;
      const statusBytes = parseAPStatusFromResponse(resp);
      if (!statusBytes) return null;
      this.log("INFO", [], `AP parse: B1=0x${statusBytes.byte1.toString(16).padStart(2, "0")} B2=0x${statusBytes.byte2.toString(16).padStart(2, "0")} B3=0x${statusBytes.byte3.toString(16).padStart(2, "0")} B4=0x${statusBytes.byte4.toString(16).padStart(2, "0")}`);
      const deviceStatus: DeviceStatus = { raw: statusBytes, flags: getStatusFlags(statusBytes), hex: bytesToHex(resp) };
      this.trackCardPresence(deviceStatus);
      this.onStatusChange?.(deviceStatus);
      return deviceStatus;
    } catch { return null; }
  }

  /**
   * Keep the NFC card state in step with sensor 3, which is the read position.
   * A card leaving the reader invalidates any UID we read from it; a card
   * arriving is "present" until something actually reads it.
   */
  private trackCardPresence(status: DeviceStatus): void {
    if (!status.flags.cardAtSensor3) {
      if (this._nfcState.card !== "none") {
        this.setNfcState({ card: "none", uid: undefined, chipType: undefined, message: undefined });
      }
      return;
    }
    if (this._nfcState.card === "none") {
      this.setNfcState({ card: "present", message: "Card at reader — not read yet" });
    }
  }

  setAddress(addr: number): void {
    const { addH, addL } = addressBytes(addr);
    this._deviceAddress = addr;
    this.addH = addH;
    this.addL = addL;
    this._fc1Supported = null;
    this.log("INFO", [], `Device address set to ${addr} (0x${addH.toString(16)} 0x${addL.toString(16)})`);
  }

  async detectAddress(): Promise<number | null> {
    if (!this.isConnected) return null;
    const previous = this._deviceAddress;
    for (let addr = 0; addr <= 15; addr++) {
      const { addH, addL } = addressBytes(addr);
      this.addH = addH;
      this.addL = addL;
      this.log("INFO", [], `Probing device address ${addr}...`);
      const resp = await this.transact(buildAPPacket(addH, addL), true);
      if (resp && parseAPStatusFromResponse(resp)) {
        this._deviceAddress = addr;
        this._fc1Supported = null;
        this.log("INFO", [], `Device found at address ${addr}`);
        return addr;
      }
    }
    this.setAddress(previous);
    this.log("INFO", [], "No device answered on addresses 0-15");
    return null;
  }

  async queryPosition(): Promise<DevicePosition | null> {
    if (!this.isConnected || this._fc1Supported === false) return null;
    try {
      const resp = await this.transact(buildFC1Packet(this.addH, this.addL), true);
      const pos = resp ? parseFC1Response(resp) : null;
      if (!pos) {
        if (this._fc1Supported === null) {
          this._fc1Supported = false;
          this.log("INFO", [], "FC1 not supported by this firmware — falling back to AP sensor bits");
        }
        return null;
      }
      this._fc1Supported = true;
      this.log("INFO", [], `FC1: device=${pos.device} card=${pos.transport} box=${pos.cardBox} retain=${pos.retainBox}`);
      return pos;
    } catch { return null; }
  }

  async getDeviceSettings(): Promise<{ frontEntry: string; resetAction: string } | null> {
    if (!this.isConnected) return null;
    try {
      const resp = await this.transact(buildFRPacket(this.addH, this.addL), true);
      const settings = resp ? parseFRResponse(resp) : null;
      if (!settings) { this.log("INFO", [], "FR: no/invalid settings response"); return null; }
      this.log("INFO", [], `FR: ${settings.frontEntry}; ${settings.resetAction}`);
      return settings;
    } catch { return null; }
  }

  // ─── Individual commands ─────────────────────────────────

  async returnDB(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "DB: return to issuing box...");
    return await this.sendCmdList2(buildDBPacket(this.addH, this.addL));
  }

  async ejectDC(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "DC: eject card...");
    return await this.sendCmdList2(buildDCPacket(this.addH, this.addL));
  }

  async recycleCP(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "CP: recycle to box...");
    return await this.sendCmdList2(buildCPPacket(this.addH, this.addL));
  }

  async moveFC4(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC4: move to hold...");
    return await this.sendCmdList2(buildFC4Packet(this.addH, this.addL));
  }

  async moveFC6(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC6: move to sensor2...");
    return await this.sendCmdList2(buildFC6Packet(this.addH, this.addL));
  }

  async enterFC8(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC8: enter from front...");
    return await this.sendCmdList2(buildFC8Packet(this.addH, this.addL));
  }

  async enableFrontAutoSense(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD0: enable front auto-sense...");
    return await this.sendCmdList2(buildFD0Packet(this.addH, this.addL));
  }

  async disableFrontAutoSense(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD1: disable front auto-sense...");
    return await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
  }

  async resetFD2(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD2: reset no action...");
    return await this.sendCmdList2(buildFD2Packet(this.addH, this.addL));
  }

  async resetFD3(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD3: reset → issuing box...");
    return await this.sendCmdList2(buildFD3Packet(this.addH, this.addL));
  }

  async resetFD4(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD4: reset → recycle box...");
    return await this.sendCmdList2(buildFD4Packet(this.addH, this.addL));
  }

  async bufferEnable(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "BE: buffer enable...");
    return await this.sendCmdList2(buildBEPacket(this.addH, this.addL));
  }

  async bufferDisable(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "BD: buffer disable...");
    return await this.sendCmdList2(buildBDPacket(this.addH, this.addL));
  }

  async resetDevice(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "RS: reset...");
    const ok = await this.sendCmdList2(buildRSPacket(this.addH, this.addL));
    if (ok) {
      this.log("INFO", [], "RS: waiting 3s for device reset...");
      await this.delay(3000);
      this.ringBuf.clear();
      this.log("INFO", [], "RS: reset complete, buffer cleared");
    }
    return ok;
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

  // ─── Remaining Command list 2 entries ────────────────────

  /** RF — short status check (3 status bytes; the channel byte is absent, so
   *  byte4 comes back as 0). Cheaper than AP when only the machine state
   *  matters. */
  async queryRF(): Promise<DeviceStatus | null> {
    if (!this.isConnected) return null;
    try {
      const resp = await this.transact(buildRFPacket(this.addH, this.addL), true);
      if (!resp) return null;
      const statusBytes = parseAPStatusFromResponse(resp);
      if (!statusBytes) return null;
      const status: DeviceStatus = {
        raw: statusBytes,
        flags: getStatusFlags(statusBytes),
        hex: bytesToHex(resp),
      };
      this.trackCardPresence(status);
      this.onStatusChange?.(status);
      return status;
    } catch { return null; }
  }

  /** FC2 — sensor status. Same decoded-byte shape as FC1. */
  async querySensors(): Promise<DevicePosition | null> {
    if (!this.isConnected) return null;
    const resp = await this.transact(buildFC2Packet(this.addH, this.addL), true);
    if (!resp) return null;
    return parseFC1Response(resp);
  }

  /** BF — accept a card at the front slot (the DLL guide's equivalent of FC8). */
  async acceptFrontBF(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "BF: accept card at front...");
    return await this.sendCmdList2(buildBFPacket(this.addH, this.addL));
  }

  /** BG — prohibit front-end card entry (invalidates BF/FC8). */
  async blockFrontBG(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "BG: block front entry...");
    return await this.sendCmdList2(buildBGPacket(this.addH, this.addL));
  }

  /**
   * CS2–CS5 — change the device baud rate.
   *
   * The serial port stays open at its current rate, so the link goes silent
   * the moment the device switches. Disconnect and reconnect (reopening the
   * port at the new rate) before sending anything else.
   */
  async setBaudRate(baud: BaudRate): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], `CS: set baud rate ${baud} — reconnect required afterwards`);
    return await this.sendCmdList2(buildCSPacket(baud, this.addH, this.addL));
  }

  /** LP — LED on. rate 0x00 = steady, 0x01-0x0F = n flashes/sec,
   *  0x82-0x8F = 1 flash every 2-15 sec. */
  async ledOn(rate = 0x00): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], `LP: LED on (rate 0x${rate.toString(16).padStart(2, "0")})...`);
    return await this.sendCmdList2(buildLPPacket(rate, this.addH, this.addL));
  }

  /** LF — LED off. */
  async ledOff(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "LF: LED off...");
    return await this.sendCmdList2(buildLFPacket(this.addH, this.addL));
  }

  // ─── Contactless (NFC) card read ─────────────────────────

  /** Run one contactless command and decode its P/N response frame. */
  private async nfcTransact(packet: Uint8Array, chip: NfcChipType, pm: number) {
    const resp = await this.transact(packet, true);
    // Any framed reply — including an error frame — proves the contactless
    // module is alive. Silence is what marks the reader as failed.
    if (!resp) return null;
    this._nfcSawAnswer = true;
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
      if (res && !res.ok) this.log("INFO", [], `NFC ${chip} search: ${res.errorName}`);

      // 0x01 is "command parameter error" — the device rejected the packet
      // itself rather than failing to find a card. The vendor SDK sends this
      // exact two-byte form (CM 0x47, PM 0x30, dataLen 0), so the packet is
      // correct and the unit simply has no CPU/TypeA module fitted.
      if (chip === "TypeA" && res && !res.ok && res.errorCode === 0x01) {
        this.log("INFO", [], "NFC TypeA: not supported by this unit (it rejected the vendor's own activate frame)");
        return null;
      }
    }
    return null;
  }

  /**
   * Wait for the transport to stop and the card to be sitting at the reader.
   *
   * dispenseFC7() returns as soon as B4 bit2 goes high, but the motor is often
   * still running (B2 = 0x08 "sending card") and the card is not yet over the
   * RF antenna. Searching in that window makes every chip family answer
   * "Search card failure" (0x41).
   */
  private async waitForCardSettled(timeoutMs = NFC_SETTLE_TIMEOUT): Promise<DeviceStatus | null> {
    const t0 = Date.now();
    let last: DeviceStatus | null = null;
    let n = 0;
    while (Date.now() - t0 < timeoutMs) {
      const st = await this.queryAP();
      if (st) {
        last = st;
        n++;
        const settled = !st.flags.cardIssuing && !st.flags.cardCollecting && st.flags.cardAtSensor3;
        this.log("INFO", [], `NFC settle #${n}: B2=0x${st.raw.byte2.toString(16).padStart(2, "0")} B4=0x${st.raw.byte4.toString(16).padStart(2, "0")} settled=${settled}`);
        if (settled) {
          await this.delay(NFC_SETTLE_DELAY);
          return st;
        }
      }
      await this.delay(200);
    }
    this.log("INFO", [], "NFC settle: transport still busy at timeout — searching anyway");
    return last;
  }

  private async nfcHalt(chip: NfcChipType): Promise<void> {
    const packet = buildNfcHaltPacket(chip, this.addH, this.addL);
    if (!packet) return; // family has no close-down command
    try {
      await this.transact(packet, true);
    } catch { /* halt is best-effort */ }
  }

  /**
   * Read the UID of the card at the reader, probing chip families in order
   * (S50 → S70 → UL → TypeA) until one answers. The card must already be at
   * sensor 3 — call dispenseFC7() or enterFC8() first.
   *
   * requireCardAtReader (default true) checks AP first so an operator pressing
   * "Read NFC" on an empty channel gets a clear message instead of four
   * failed searches.
   */
  async readNfcCard(options: { requireCardAtReader?: boolean } = {}): Promise<NfcReadResult> {
    const { requireCardAtReader = true } = options;
    if (!this.isConnected) return { success: false, message: "Device not connected." };

    this.log("INFO", [], "=== NFC read ===");
    const settled = await this.waitForCardSettled();
    if (requireCardAtReader) {
      if (!settled) return { success: false, message: "No response from device." };
      if (!settled.flags.cardAtSensor3) {
        this.setNfcState({ card: "none", uid: undefined, chipType: undefined, message: "No card at the reader" });
        return { success: false, message: "No card at the reader position — dispense a card first." };
      }
    }

    this._nfcSawAnswer = false;
    for (const chip of NFC_CHIP_TYPES) {
      const searchData = await this.nfcSearch(chip);
      if (searchData === null) continue;

      // TypeA activate and the ISO15693 content request already return the
      // UID; the Mifare families need a separate read-serial command.
      let uidBytes: number[];
      if (uidComesFromSearch(chip)) {
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

      if (uidBytes.length === 0) { await this.nfcHalt(chip); continue; }

      const uid = bytesToHexCompact(uidBytes);
      this.log("INFO", [], `NFC ${chip}: UID ${uid}`);
      await this.nfcHalt(chip);
      this.setNfcState({
        reader: "ready",
        card: "detected",
        uid,
        chipType: chip,
        message: `${chip} card read`,
      });
      return { success: true, message: `${chip} card — UID ${uid}`, chipType: chip, uid, uidBytes };
    }

    this.log("INFO", [], "NFC: no card detected (S50/S70/UL/TypeA all failed)");
    // The reader answered every search with a proper error frame, so the module
    // works — there is just no chip it recognises in the field. Total silence
    // instead means the contactless module is missing or broken.
    if (this._nfcSawAnswer) {
      this.setNfcState({
        reader: "ready",
        card: settled?.flags.cardAtSensor3 ? "unreadable" : "none",
        uid: undefined,
        chipType: undefined,
        message: settled?.flags.cardAtSensor3
          ? "Card at reader, but no chip answered"
          : "No card at the reader",
      });
      return { success: false, message: "No NFC card detected at the reader." };
    }
    this.setNfcState({
      reader: "error",
      card: "none",
      uid: undefined,
      chipType: undefined,
      message: "Reader did not respond",
    });
    return { success: false, message: "NFC reader did not respond." };
  }

  /**
   * Read one 16-byte data block from the card at the reader. S50/S70 blocks are
   * password-protected, so the sector key is checked first (factory-default key
   * when none is supplied); UL blocks need no key.
   */
  async readNfcBlock(
    chip: "S50" | "S70" | "UL",
    blockAddr: number,
    key: number[] = DEFAULT_MIFARE_KEY,
    keyType: "A" | "B" = "A"
  ): Promise<NfcBlockResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected." };

    if ((await this.nfcSearch(chip)) === null) {
      return { success: false, message: `No ${chip} card detected at the reader.` };
    }

    if (chip !== "UL") {
      const auth = await this.nfcTransact(
        buildNfcAuthPacket(chip, blockAddr, key, keyType, this.addH, this.addL),
        chip,
        NFC_PM[chip].auth
      );
      if (!auth?.ok) {
        await this.nfcHalt(chip);
        return { success: false, message: `Key ${keyType} rejected for block ${blockAddr}${auth ? ` — ${auth.errorName}` : ""}.` };
      }
    }

    const read = await this.nfcTransact(
      buildNfcReadBlockPacket(chip, blockAddr, this.addH, this.addL),
      chip,
      NFC_PM[chip].read
    );
    await this.nfcHalt(chip);
    if (!read?.ok) {
      return { success: false, message: `Read of block ${blockAddr} failed${read ? ` — ${read.errorName}` : " — no response"}.` };
    }
    const hex = bytesToHex(read.data);
    this.log("INFO", [], `NFC ${chip} block ${blockAddr}: ${hex}`);
    return { success: true, message: `Block ${blockAddr} read.`, data: read.data, hex };
  }

  async dispenseFC7(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC7: dispense...");
    const sent = await this.sendCmdList2(buildFC7Packet(this.addH, this.addL));
    if (!sent) { this.log("INFO", [], "FC7: NAK"); return false; }
    this.log("INFO", [], "FC7: polling for card...");
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 12000) {
      await this.delay(300);
      n++;
      const st = await this.queryAP();
      if (st) {
        const b4 = st.raw.byte4;
        this.log("INFO", [], `FC7 #${n}: B4=0x${b4.toString(16).padStart(2, "0")}`);
        if (b4 & 0x04) { this.log("INFO", [], "FC7: card at S3"); return true; }
        if (b4 & 0x03) { this.log("INFO", [], "FC7: card in channel, waiting..."); continue; }
        if (st.flags.boxEmpty) { this.log("INFO", [], "FC7: BOX EMPTY"); return false; }
        if (st.flags.cardJam) { this.log("INFO", [], "FC7: JAM"); return false; }
        if (st.flags.cardOverlap) { this.log("INFO", [], "FC7: OVERLAP"); return false; }
        if (st.flags.issueError) { this.log("INFO", [], "FC7: ISSUE ERROR"); return false; }
      }
    }
    this.log("INFO", [], `FC7: timeout after ${n} polls`);
    return false;
  }

  async ejectFC0(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC0: eject...");
    const sent = await this.sendCmdList2(buildFC0Packet(this.addH, this.addL));
    if (!sent) { this.log("INFO", [], "FC0: NAK"); return false; }
    this.log("INFO", [], "FC0: polling for channel clear...");
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 8000) {
      await this.delay(300);
      n++;
      const st = await this.queryAP();
      if (st) {
        const clear = (st.raw.byte4 & 0x07) === 0;
        this.log("INFO", [], `FC0 #${n}: B4=0x${st.raw.byte4.toString(16).padStart(2, "0")} clear=${clear}`);
        if (clear) { this.log("INFO", [], "FC0: SUCCESS"); return true; }
      }
    }
    this.log("INFO", [], `FC0: timeout after ${n} polls`);
    return false;
  }
}
