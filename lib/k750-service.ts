import {
  STX, ACK, NAK, DEFAULT_ADDH, DEFAULT_ADDL,
  buildENQ, buildAPPacket, buildFC7Packet, buildDCPacket,
  buildFD0Packet, buildFD1Packet, buildDBPacket,
  buildRSPacket, buildGVPacket,
  buildCPPacket, buildFC0Packet, buildFC4Packet, buildFC6Packet, buildFC8Packet,
  buildFD2Packet, buildFD3Packet, buildFD4Packet, buildBEPacket, buildBDPacket,
  buildFC1Packet, buildFRPacket, addressBytes,
  bytesToHex, parseNFResponse,
  parseAPStatusFromResponse, parseFC1Response, parseFRResponse,
  type StatusBytes,
  type StatusFlags, getStatusFlags,
  type DCResult, type DevicePosition,
} from "./k750-protocol";

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
  | "MOVEMENT_TIMEOUT"
  | "TARGET_NOT_CONFIRMED"
  | "CARD_EMPTY"
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
}

export type LogEntry = {
  timestamp: number;
  direction: "TX" | "RX" | "INFO";
  hex: string;
  text?: string;
};

const SERIAL_OPTIONS: SerialOptions = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" };
/** Vendor guidance: leave ~300ms between two commands (200ms minimum between AP queries). */
const CMD_GAP = 300;
/** Gap between the ACK and the ENQ that actually triggers execution. */
const ENQ_DELAY = 50;
const CMD_DELAY = 300;
const POLL_INTERVAL = 300;
const FC7_TIMEOUT = 12000;
const EJECT_TIMEOUT = 4000; // DLL EjectCard_Time = 4000ms
const ACK_TIMEOUT = 1000;
const RESPONSE_TIMEOUT = 2000;
/**
 * Channel sensor (B4) that reports "card is at the RF reader position" after FC7.
 * The vendor docs never state which of the three sensors this is, so it lives in
 * one place: check the AP log after an FC7 on real hardware and adjust if needed.
 * 0x04 = sensor 3, 0x02 = sensor 2, 0x01 = sensor 1.
 */
const READER_SENSOR_MASK = 0x04;

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
  private lastAPQueryTime = 0;
  private lastCommandTime = 0;
  private consecutiveFailures = 0;
  private _flowBusy = false;
  private _reconnecting = false;
  private _deviceAddress = 0;
  /** null = not probed yet, true/false = firmware answers FC1 or not. */
  private _fc1Supported: boolean | null = null;

  get isBusy() { return this._busy; }
  get isFlowBusy() { return this._flowBusy; }

  onLog?: (entry: LogEntry) => void;
  onStatusChange?: (status: DeviceStatus | null) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  onAutoReconnect?: () => void;

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

  /** Guard a full issue/checkout flow. Prevents concurrent flows while allowing
   *  background queryAP polls (which only set _busy, not _flowBusy). */
  private runFlow<T>(fn: () => Promise<T>): Promise<T | { success: false; message: string; errorCode: "DEVICE_BUSY" | "UNKNOWN_ERROR" }> {
    return new Promise<T | { success: false; message: string; errorCode: "DEVICE_BUSY" | "UNKNOWN_ERROR" }>((resolve) => {
      if (this._flowBusy) {
        resolve({ success: false, message: "Device busy — an operation is already running.", errorCode: "DEVICE_BUSY" as const });
        return;
      }
      this._flowBusy = true;
      fn().then(
        (result) => { resolve(result); },
        (error) => { resolve({ success: false, message: String(error), errorCode: "UNKNOWN_ERROR" as const }); }
      ).finally(() => { this._flowBusy = false; });
    });
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
      // Drop any handler from a previous connection first — otherwise every
      // reconnect stacks another listener on navigator.serial.
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
      this.onConnectionChange?.("connected");
      this.log("INFO", [], "Connected - reader loop started");

      this.log("INFO", [], "Health check: querying AP...");
      let status = await this.queryAP();
      if (!status) {
        // The DIP switch may not be on address 0 — scan before giving up.
        this.log("INFO", [], "Health check: no answer at current address, scanning 0-15...");
        if ((await this.detectAddress()) !== null) status = await this.queryAP();
      }
      if (!status) {
        this.log("INFO", [], "Health check FAILED: no response");
      } else {
        this.log("INFO", [], `Health check OK (address ${this._deviceAddress})`);
        await this.queryPosition(); // learn whether this firmware supports FC1
      }
    } catch (err) {
      this._connected = false;
      this.onConnectionChange?.("error");
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `Connection failed: ${msg}`);
      throw err;
    }
  }

  /** Tear down reader/writer/port without touching the public connection state. */
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

  // ---- Attempt reconnection ----
  private async attemptReconnect(): Promise<void> {
    // Both the USB disconnect event and the consecutive-failure watchdog can
    // fire this; without a guard they race and open the port twice.
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.log("INFO", [], "Attempting auto-reconnect...");
    this.onConnectionChange?.("connecting");

    const maxAttempts = 10;
    const delayMs = 2000;

    try {
      // The old handles must be released before the same port can be reopened.
      await this.releasePort();

      for (let i = 0; i < maxAttempts; i++) {
        await this.delay(delayMs);
        if (this._manualDisconnect) {
          this.log("INFO", [], "Auto-reconnect cancelled (manual disconnect)");
          return;
        }
        try {
          const ports = await this.getAvailablePorts();
          if (ports.length > 0) {
            await this.connectToPort(ports[0]);
            this.log("INFO", [], "Auto-reconnect successful");
            return;
          }
        } catch (err) {
          this.log("INFO", [], `Reconnect error: ${err instanceof Error ? err.message : String(err)}`);
          await this.releasePort();
        }
        this.log("INFO", [], `Reconnect attempt ${i + 1}/${maxAttempts} failed`);
      }
      this.log("INFO", [], "Auto-reconnect failed after max attempts");
      this.onConnectionChange?.("error");
    } finally {
      this._reconnecting = false;
    }
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
    if (this.disconnectHandler) {
      navigator.serial.removeEventListener("disconnect", this.disconnectHandler);
      this.disconnectHandler = undefined;
    }
    await this.releasePort();
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
    return null; // timeout with incomplete data
  }

  private matchAckNak(buf: number[]) {
    const first = buf[0];
    if (first === ACK || first === NAK) return { ready: buf.length >= 3, slice: buf.slice(0, 3) };
    if (first === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      if (expected > 1024) return { ready: false, slice: [] }; // sanity limit
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  private matchResponse(buf: number[]) {
    if (buf.length === 0) return { ready: false, slice: [] };
    if (buf[0] === STX && buf.length >= 5) {
      const expected = 7 + ((buf[3] << 8) | buf[4]);
      if (expected > 1024) return { ready: false, slice: [] }; // sanity limit
      return { ready: buf.length >= expected, slice: buf.slice(0, expected) };
    }
    return { ready: false, slice: [] };
  }

  /** Keep the vendor-recommended gap between two commands without padding the
   *  time between a command and the reply we are already waiting for. */
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

  // ---- Transact (List 1: CMD → ACK → ENQ → RESPONSE) ----
  private async transact(packet: Uint8Array, expectResponse: boolean): Promise<number[] | null> {
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

  // ---- List 2 command: CMD → ACK → ENQ (device executes; no response frame) ----
  //
  // The ENQ is not optional. Per the vendor communication diagram the device only
  // *implements* the action after it receives ENQ+ADDR; the ACK merely says the
  // frame parsed. Without it every movement command (FC7/FC0/DC/CP/DB/RS/FDx)
  // is accepted and then silently dropped.
  private async sendCmdList2(packet: Uint8Array): Promise<boolean> {
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
      if (first === NAK) {
        this.log("RX", ackResp, "NAK");
        this.consecutiveFailures++;
        this.checkAutoReconnect();
        return false;
      }
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

  // ---- Auto-reconnect after 5 consecutive failures ----
  private checkAutoReconnect(): void {
    if (this.consecutiveFailures >= 5 && this._connected && !this._manualDisconnect) {
      this.log("INFO", [], `5 consecutive failures — triggering auto-reconnect`);
      this.consecutiveFailures = 0;
      this.onAutoReconnect?.();
      this.attemptReconnect();
    }
  }

  // ---- AP status ----
  async queryAP(): Promise<DeviceStatus | null> {
    if (!this.isConnected) return null;
    // Enforce 200ms minimum interval between AP queries
    const now = Date.now();
    const elapsed = now - this.lastAPQueryTime;
    if (elapsed < 200) {
      await this.delay(200 - elapsed);
    }
    this.lastAPQueryTime = Date.now();
    try {
      const resp = await this.transact(buildAPPacket(this.addH, this.addL), true);
      if (!resp) return null;
      return this.parseAPResponse(resp);
    } catch { return null; }
  }

  // ---- Device address (DIP switch 0-15) ----
  get deviceAddress(): number { return this._deviceAddress; }

  /** Point the service at a specific DIP address. Default is 0 ("00"). */
  setAddress(addr: number): void {
    const { addH, addL } = addressBytes(addr);
    this._deviceAddress = addr;
    this.addH = addH;
    this.addL = addL;
    this._fc1Supported = null;
    this.log("INFO", [], `Device address set to ${addr} (0x${addH.toString(16)} 0x${addL.toString(16)})`);
  }

  /**
   * Probe addresses 0-15 and latch onto the first that answers, mirroring
   * K7X0_AutoTestMac. The vendor probes with RS, which physically resets the
   * mechanism; AP is used here instead so scanning cannot eject a card.
   */
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

  /**
   * FC1 — the firmware's own decoded view of where the card is. Far more
   * reliable than inferring the reader position from the AP sensor bits, since
   * the docs never say which of S1/S2/S3 sits at the RF antenna.
   * Returns null when the firmware does not implement FC1 (older units).
   */
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

  /** FR — parameter settings (front-entry mode and reset behaviour). */
  async getDeviceSettings(): Promise<{ frontEntry: string; resetAction: string } | null> {
    if (!this.isConnected) return null;
    try {
      const resp = await this.transact(buildFRPacket(this.addH, this.addL), true);
      const settings = resp ? parseFRResponse(resp) : null;
      if (!settings) { this.log("INFO", [], "FR: no/!invalid settings response"); return null; }
      this.log("INFO", [], `FR: ${settings.frontEntry}; ${settings.resetAction}`);
      return settings;
    } catch { return null; }
  }

  /** True when the card is confirmed at the RF reader position. */
  private async confirmAtReader(status: DeviceStatus | null): Promise<boolean> {
    if (status && status.raw.byte4 & READER_SENSOR_MASK) return true;
    // The sensor guess said no. If something is in the channel and the mechanism
    // has stopped, ask the firmware directly before giving up.
    if (!status || !(status.raw.byte4 & 0x07) || status.flags.cardIssuing) return false;
    const pos = await this.queryPosition();
    return pos?.transport === "AT_READER";
  }

  private parseAPResponse(response: number[]): DeviceStatus | null {
    const statusBytes = parseAPStatusFromResponse(response);
    if (!statusBytes) return null;

    this.log("INFO", [], `AP parse: B1=0x${statusBytes.byte1.toString(16).padStart(2, "0")} B2=0x${statusBytes.byte2.toString(16).padStart(2, "0")} B3=0x${statusBytes.byte3.toString(16).padStart(2, "0")} B4=0x${statusBytes.byte4.toString(16).padStart(2, "0")}`);
    const deviceStatus: DeviceStatus = { raw: statusBytes, flags: getStatusFlags(statusBytes), hex: bytesToHex(response) };
    this.onStatusChange?.(deviceStatus);
    return deviceStatus;
  }

  // ---- Movement commands ----
  async dispenseFC7(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC7: dispense...");
    const ok = await this.sendCmdList2(buildFC7Packet(this.addH, this.addL));
    if (!ok) { this.log("INFO", [], "FC7: NAK or no ACK"); return false; }
    this.log("INFO", [], "FC7: polling AP...");
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < FC7_TIMEOUT) {
      await this.delay(POLL_INTERVAL); n++;
      const st = await this.queryAP();
      if (st) {
        this.log("INFO", [], `FC7 #${n}: b4=0x${st.raw.byte4.toString(16).padStart(2, "0")} reader=${!!(st.raw.byte4 & READER_SENSOR_MASK)}`);
        if (await this.confirmAtReader(st)) { this.log("INFO", [], "FC7: card at reader"); return true; }
        // Don't burn the full 12s on a fault the device already reported.
        if (st.flags.cardJam || st.flags.cardOverlap || st.flags.issueError || st.flags.commandCannotExecute) {
          this.log("INFO", [], "FC7: aborting — device reported a fault");
          return false;
        }
        if (st.flags.boxEmpty && !(st.raw.byte4 & 0x07) && !st.flags.cardIssuing) {
          this.log("INFO", [], "FC7: aborting — hopper empty and nothing moving");
          return false;
        }
      } else { this.log("INFO", [], `FC7 #${n}: no AP`); }
    }
    this.log("INFO", [], `FC7: timeout after ${n} polls`);
    return false;
  }

  async ejectDC(): Promise<DCResult> {
    const result: DCResult = {
      success: false,
      confirmed: false,
      resultCode: "MOVEMENT_TIMEOUT",
      message: "",
      pollCount: 0,
      elapsed: 0,
    };

    if (!this.isConnected) {
      result.resultCode = "NOT_CONNECTED";
      result.message = "Device not connected.";
      return result;
    }

    if (this._flowBusy) {
      result.resultCode = "DEVICE_BUSY";
      result.message = "Device busy — an operation is already running.";
      return result;
    }

    // Snapshot the channel *before* moving. If the card is already sitting at a
    // sensor and the eject is quick, the sensors can clear before our first poll;
    // without this seed the transition is invisible and a card that really came
    // out is reported as TARGET_NOT_CONFIRMED.
    const preStatus = await this.queryAP();
    let sawSensorsActive = !!(preStatus && preStatus.raw.byte4 & 0x07);
    if (sawSensorsActive) this.log("INFO", [], "DC: card present in channel before eject");

    // STATE: SEND_DC
    this.log("INFO", [], "DC: sending command to move card to pickup position...");
    const ok = await this.sendCmdList2(buildDCPacket(this.addH, this.addL));
    if (!ok) {
      result.resultCode = "ACK_TIMEOUT";
      result.message = "DC command not acknowledged.";
      this.log("INFO", [], "DC: command rejected or no ACK");
      return result;
    }
    this.log("INFO", [], "DC: command accepted — ACK received");

    // STATE: WAIT_FOR_DEVICE_MOVEMENT — brief pause, then start polling immediately.
    // The device starts moving the card right after ACK. We need to catch the
    // sensor transition while it happens, not after. First AP after DC usually
    // times out (device processing), so we minimize initial delay.
    this.log("INFO", [], "DC: waiting for mechanism to start movement...");
    await this.delay(100);

    // STATE: POLL_AP
    this.log("INFO", [], "DC: polling AP for movement completion...");
    let sawTransition = false;
    const t0 = Date.now();
    let pollCount = 0;

    while (Date.now() - t0 < EJECT_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      pollCount++;
      result.pollCount = pollCount;

      // Attempt up to 2 times to get AP response per poll cycle
      // (first AP after DC often times out — device still processing)
      // Cap retries so we don't blow past EJECT_TIMEOUT
      let st: DeviceStatus | null = null;
      for (let retry = 0; retry < 2; retry++) {
        st = await this.queryAP();
        if (st) break;
        this.log("INFO", [], `DC: poll #${pollCount} attempt ${retry + 1}/2 — no AP response`);
        if (Date.now() - t0 >= EJECT_TIMEOUT) break;
        if (retry < 1) await this.delay(200);
      }

      if (!st) {
        this.log("INFO", [], `DC: poll #${pollCount} — communication failed`);
        continue;
      }

      const { raw, flags } = st;
      const b1 = raw.byte1;
      const b2 = raw.byte2;
      const b3 = raw.byte3;
      const b4 = raw.byte4;
      const channelSensors = b4 & 0x07;
      const anySensorActive = channelSensors !== 0;

      // Log detailed status on every poll
      const sensorList = [
        flags.cardAtSensor3 ? "S3" : "",
        flags.cardAtSensor2 ? "S2" : "",
        flags.cardAtSensor1 ? "S1" : "",
      ].filter(Boolean).join("+") || "clear";

      this.log("INFO", [], [
        `DC: poll #${pollCount}`,
        `B1=0x${b1.toString(16).padStart(2, "0")}`,
        `B2=0x${b2.toString(16).padStart(2, "0")}`,
        `B3=0x${b3.toString(16).padStart(2, "0")}`,
        `B4=0x${b4.toString(16).padStart(2, "0")}`,
        `channel=[${sensorList}]`,
      ].join(" "));

      // --- Hardware error detection (B1/B2/B3) ---

      if (flags.commandCannotExecute) {
        result.success = false;
        result.resultCode = "DEVICE_ERROR";
        result.message = "Device cannot execute command.";
        result.finalStatus = st;
        this.log("INFO", [], "DC: CANNOT EXECUTE — device reported command cannot be executed");
        return result;
      }

      if (flags.issueError) {
        result.success = false;
        result.resultCode = "DEVICE_ERROR";
        result.message = "Card issuance error detected by device.";
        result.finalStatus = st;
        this.log("INFO", [], "DC: ISSUE ERROR — device reported card issuance error");
        return result;
      }

      if (flags.collectError) {
        result.success = false;
        result.resultCode = "DEVICE_ERROR";
        result.message = "Card collection error detected by device.";
        result.finalStatus = st;
        this.log("INFO", [], "DC: COLLECT ERROR — device reported card collection error");
        return result;
      }

      if (flags.cardJam) {
        result.success = false;
        result.resultCode = "CARD_JAM";
        result.message = "Card jam detected — reset (RS) required.";
        result.finalStatus = st;
        this.log("INFO", [], "DC: CARD JAM — card is stuck in channel");
        return result;
      }

      if (flags.cardOverlap) {
        result.success = false;
        result.resultCode = "CARD_OVERLAP";
        result.message = "Card overlap detected — reset (RS) required.";
        result.finalStatus = st;
        this.log("INFO", [], "DC: CARD OVERLAP — multiple cards in channel");
        return result;
      }

      // NOTE: boxEmpty (B4 bit3) describes the *hopper*, not the channel. Issuing
      // the last card legitimately leaves the hopper empty, so it must not abort
      // an eject that is already under way — that turned a good eject into a
      // "Card box is empty" failure after the card had physically come out.
      if (flags.boxEmpty) {
        this.log("INFO", [], "DC: hopper now empty (not an eject failure — continuing)");
      }

      if (flags.cardPreEmpty) {
        // Pre-empty is a warning only — does not block eject (per DLL CARDBOXLESS 0x31)
        this.log("INFO", [], "DC: CARD PRE-EMPTY — card box running low (continuing)");
      }

      // --- Sensor state tracking ---

      if (anySensorActive) {
        sawSensorsActive = true;
        this.log("INFO", [], "DC: card detected in channel — waiting for ejection...");
      } else if (sawSensorsActive && !anySensorActive) {
        // Sensors went from active to all clear → card left the channel
        sawTransition = true;
        this.log("INFO", [], "DC: target position confirmed — sensors clear after card was detected");
      }

      // --- Completion: only confirmed when we observe sensor transition ---

      if (sawTransition) {
        result.success = true;
        result.confirmed = true;
        result.resultCode = "SUCCESS";
        result.message = "Card ejected — sensor transition observed.";
        result.finalStatus = st;
        result.elapsed = Date.now() - t0;
        this.log("INFO", [], `DC: SUCCESS — card moved through channel in ${result.elapsed}ms`);
        return result;
      }
    }

    // STATE: TIMEOUT — determine which timeout condition occurred
    result.elapsed = Date.now() - t0;
    if (sawSensorsActive) {
      // We saw the card in the channel but sensors never cleared — card may be stuck
      result.resultCode = "MOVEMENT_TIMEOUT";
      result.message = `Card was detected in channel but did not exit within ${result.elapsed}ms. Card may be stuck.`;
      this.log("INFO", [], `DC: MOVEMENT TIMEOUT — card seen in channel but did not exit (${pollCount} polls, ${result.elapsed}ms)`);
    } else {
      // We never saw the card in any sensor — cannot confirm anything happened
      result.resultCode = "TARGET_NOT_CONFIRMED";
      result.message = `No sensor activity detected within ${result.elapsed}ms. DC was accepted (ACK) but card movement could not be verified.`;
      this.log("INFO", [], `DC: TARGET NOT CONFIRMED — no sensor activity observed (${pollCount} polls, ${result.elapsed}ms)`);
    }
    return result;
  }

  // ---- DB: Return card to issuing box ----
  async returnDB(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "DB: return to issuing box...");
    return await this.sendCmdList2(buildDBPacket(this.addH, this.addL));
  }

  // ---- CP: Recycle card to recycling box ----
  async recycleCP(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "CP: recycle to box...");
    return await this.sendCmdList2(buildCPPacket(this.addH, this.addL));
  }

  // ---- FC0: Dispense out of mouth (drop from bayonet) — with completion polling ----
  async ejectFC0(): Promise<DCResult> {
    const result: DCResult = {
      success: false,
      confirmed: false,
      resultCode: "MOVEMENT_TIMEOUT",
      message: "",
      pollCount: 0,
      elapsed: 0,
    };

    if (!this.isConnected) {
      result.resultCode = "NOT_CONNECTED";
      result.message = "Device not connected.";
      return result;
    }

    if (this._flowBusy) {
      result.resultCode = "DEVICE_BUSY";
      result.message = "Device busy — an operation is already running.";
      return result;
    }

    // See ejectDC: seed the sensor history so a fast eject is not misreported.
    const preStatus = await this.queryAP();
    let sawSensorsActive = !!(preStatus && preStatus.raw.byte4 & 0x07);
    if (sawSensorsActive) this.log("INFO", [], "FC0: card present in channel before eject");

    this.log("INFO", [], "FC0: sending command to eject card out of mouth...");
    const ok = await this.sendCmdList2(buildFC0Packet(this.addH, this.addL));
    if (!ok) {
      result.resultCode = "ACK_TIMEOUT";
      result.message = "FC0 command not acknowledged.";
      this.log("INFO", [], "FC0: command rejected or no ACK");
      return result;
    }
    this.log("INFO", [], "FC0: command accepted — ACK received");

    this.log("INFO", [], "FC0: waiting for mechanism to start movement...");
    await this.delay(100);

    this.log("INFO", [], "FC0: polling AP for ejection completion...");
    let sawTransition = false;
    const t0 = Date.now();
    let pollCount = 0;

    while (Date.now() - t0 < EJECT_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      pollCount++;
      result.pollCount = pollCount;

      let st: DeviceStatus | null = null;
      for (let retry = 0; retry < 2; retry++) {
        st = await this.queryAP();
        if (st) break;
        this.log("INFO", [], `FC0: poll #${pollCount} attempt ${retry + 1}/2 — no AP response`);
        if (Date.now() - t0 >= EJECT_TIMEOUT) break;
        if (retry < 1) await this.delay(200);
      }

      if (!st) {
        this.log("INFO", [], `FC0: poll #${pollCount} — communication failed`);
        continue;
      }

      const { raw, flags } = st;
      const b4 = raw.byte4;
      const channelSensors = b4 & 0x07;
      const anySensorActive = channelSensors !== 0;

      const sensorList = [
        flags.cardAtSensor3 ? "S3" : "",
        flags.cardAtSensor2 ? "S2" : "",
        flags.cardAtSensor1 ? "S1" : "",
      ].filter(Boolean).join("+") || "clear";

      this.log("INFO", [], [
        `FC0: poll #${pollCount}`,
        `B1=0x${raw.byte1.toString(16).padStart(2, "0")}`,
        `B2=0x${raw.byte2.toString(16).padStart(2, "0")}`,
        `B3=0x${raw.byte3.toString(16).padStart(2, "0")}`,
        `B4=0x${b4.toString(16).padStart(2, "0")}`,
        `channel=[${sensorList}]`,
      ].join(" "));

      if (flags.commandCannotExecute) {
        result.success = false;
        result.resultCode = "DEVICE_ERROR";
        result.message = "Device cannot execute command.";
        result.finalStatus = st;
        this.log("INFO", [], "FC0: CANNOT EXECUTE");
        return result;
      }

      if (flags.cardJam) {
        result.success = false;
        result.resultCode = "CARD_JAM";
        result.message = "Card jam detected — reset (RS) required.";
        result.finalStatus = st;
        this.log("INFO", [], "FC0: CARD JAM");
        return result;
      }

      if (flags.cardOverlap) {
        result.success = false;
        result.resultCode = "CARD_OVERLAP";
        result.message = "Card overlap detected — reset (RS) required.";
        result.finalStatus = st;
        this.log("INFO", [], "FC0: CARD OVERLAP");
        return result;
      }

      if (anySensorActive) {
        sawSensorsActive = true;
        this.log("INFO", [], "FC0: card detected in channel — waiting for ejection...");
      } else if (sawSensorsActive && !anySensorActive) {
        sawTransition = true;
        this.log("INFO", [], "FC0: sensors clear — card ejected from mouth");
      }

      if (sawTransition) {
        result.success = true;
        result.confirmed = true;
        result.resultCode = "SUCCESS";
        result.message = "Card ejected from mouth — sensor transition observed.";
        result.finalStatus = st;
        result.elapsed = Date.now() - t0;
        this.log("INFO", [], `FC0: SUCCESS — card ejected in ${result.elapsed}ms`);
        return result;
      }
    }

    result.elapsed = Date.now() - t0;
    if (sawSensorsActive) {
      result.resultCode = "MOVEMENT_TIMEOUT";
      result.message = `Card was detected but did not eject within ${result.elapsed}ms.`;
      this.log("INFO", [], `FC0: MOVEMENT TIMEOUT (${pollCount} polls, ${result.elapsed}ms)`);
    } else {
      result.resultCode = "TARGET_NOT_CONFIRMED";
      result.message = `No sensor activity within ${result.elapsed}ms.`;
      this.log("INFO", [], `FC0: TARGET NOT CONFIRMED (${pollCount} polls, ${result.elapsed}ms)`);
    }
    return result;
  }

  // ---- FC4: Move to hold position (force pull) ----
  async moveFC4(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC4: move to hold...");
    return await this.sendCmdList2(buildFC4Packet(this.addH, this.addL));
  }

  // ---- FC6: Move to sensor 2 ----
  async moveFC6(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC6: move to sensor2...");
    return await this.sendCmdList2(buildFC6Packet(this.addH, this.addL));
  }

  // ---- FC8: Enter card from front ----
  async enterFC8(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FC8: enter from front...");
    return await this.sendCmdList2(buildFC8Packet(this.addH, this.addL));
  }

  // ---- FD0: Front-end auto-sense card entry ----
  async enableFrontAutoSense(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD0: enable front auto-sense...");
    return await this.sendCmdList2(buildFD0Packet(this.addH, this.addL));
  }

  // ---- FD1: Disable auto-sense, require BF/FC8 for front entry ----
  async disableFrontAutoSense(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD1: disable front auto-sense...");
    return await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
  }

  // ---- FD2: Reset without action ----
  async resetFD2(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD2: reset no action...");
    return await this.sendCmdList2(buildFD2Packet(this.addH, this.addL));
  }

  // ---- FD3: Reset, return channel card to issuing box ----
  async resetFD3(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD3: reset → issuing box...");
    return await this.sendCmdList2(buildFD3Packet(this.addH, this.addL));
  }

  // ---- FD4: Reset, return channel card to recycling box ----
  async resetFD4(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "FD4: reset → recycle box...");
    return await this.sendCmdList2(buildFD4Packet(this.addH, this.addL));
  }

  // ---- BE: Buffer enable (buzzer on) ----
  async bufferEnable(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "BE: buffer enable...");
    return await this.sendCmdList2(buildBEPacket(this.addH, this.addL));
  }

  // ---- BD: Buffer disable (buzzer off) ----
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
      this.log("INFO", [], "RS: waiting3s for device reset...");
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

  // ---- Pre-issue check ----
  async preIssueCheck(): Promise<string | null> {
    const status = await this.queryAP();
    if (!status) return "Cannot read device status.";
    const { raw, flags } = status;
    if (flags.recycleBoxFull) return "Recycle box full.";
    if (flags.boxEmpty) return "Card box is empty.";
    if (raw.byte4 & 0x07) return "Card in channel — eject first.";
    if (flags.cardOverlap) return "Card overlap — press RS.";
    if (flags.cardJam) return "Card jam — press RS.";
    if (flags.issueError) return "Issue error — press RS.";
    if (flags.collectError) return "Collection error — press RS.";
    if (flags.commandCannotExecute) return "Command cannot execute.";
    if (flags.cardIssuing || flags.cardCollecting) return "Device busy — wait for current operation.";
    return null;
  }

  // ---- Visitor Issue flow: FC7 → poll sensor3 → DC eject ----
  async issueVisitorCard(visitorName: string, company: string, host: string): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(async () => {
      try {
      this.log("INFO", [], "=== Visitor Issue flow ===");

      // Step 1: Pre-check AP
      this.log("INFO", [], "Step 1: Pre-check AP...");
      const status = await this.queryAP();
      if (!status) return { success: false, message: "Cannot read device status.", errorCode: "NO_RESPONSE" };
      const { raw, flags } = status;
      if (raw.byte4 & 0x07) return { success: false, message: "Channel busy (0xA3).", errorCode: "CARD_IN_CHANNEL" };
      if (flags.boxEmpty) return { success: false, message: "Card box empty (0xA0).", errorCode: "BOX_EMPTY" };

      // Step 2: FC7 → poll sensor2 (12s timeout)
      this.log("INFO", [], "Step 2: FC7 dispense to reader...");
      const dispensed = await this.dispenseFC7();
      if (!dispensed) {
        if (!this.isConnected) return { success: false, message: "Device disconnected.", errorCode: "USB_DISCONNECTED" };
        const st = await this.queryAP();
        let errorMsg = "Issue timeout (0xA5).";
        let errorCode: ErrorCode = "FC7_TIMEOUT";
        if (st) {
          if (st.flags.cardJam) { errorMsg = "Card jam. Press RS."; errorCode = "CARD_JAM"; }
          else if (st.flags.cardOverlap) { errorMsg = "Card overlap. Press RS."; errorCode = "CARD_OVERLAP"; }
          else if (st.flags.boxEmpty) { errorMsg = "Card box empty (0xA0)."; errorCode = "BOX_EMPTY"; }
        }
        return { success: false, message: errorMsg, errorCode, status: st ?? undefined };
      }

      // Step 3: FC0 eject out of mouth (4s timeout)
      this.log("INFO", [], "Step 3: FC0 eject out of mouth...");
      const fc0Result = await this.ejectFC0();
      if (!fc0Result.success) {
        if (!this.isConnected) return { success: false, message: "Device disconnected.", errorCode: "USB_DISCONNECTED" };
        const errorCode: ErrorCode = fc0Result.resultCode === "CARD_JAM" ? "CARD_JAM"
          : fc0Result.resultCode === "CARD_OVERLAP" ? "CARD_OVERLAP"
          : fc0Result.resultCode === "CARD_EMPTY" ? "BOX_EMPTY"
          : fc0Result.resultCode === "DEVICE_ERROR" ? "ISSUE_ERROR"
          : fc0Result.resultCode === "NOT_CONNECTED" ? "NOT_CONNECTED"
          : fc0Result.resultCode === "TARGET_NOT_CONFIRMED" ? "TARGET_NOT_CONFIRMED"
          : fc0Result.resultCode === "MOVEMENT_TIMEOUT" ? "MOVEMENT_TIMEOUT"
          : "EJECT_TIMEOUT";
        return { success: false, message: fc0Result.message, errorCode };
      }

      this.log("INFO", [], "=== VISITOR ISSUE SUCCESS ===");
      const finalStatus = await this.queryAP();
      return { success: true, message: `Card ready for: ${visitorName} - ${company} - ${host}`, status: finalStatus ?? undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `FAILED: ${msg}`);
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    }
    });
  }

  // ---- Visitor Checkout: FD0 → wait for insertion → FC7 → CP → poll empty ----
  //
  // The returned card always goes to the recycle box (CP), never back into the
  // issuing hopper (DB).
  async visitorCheckout(onStep?: (step: number, msg: string) => void): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(async () => {
    let fd0Enabled = false;
    try {
      this.log("INFO", [], "=== Visitor Checkout flow ===");

      // Step 1: FD0 — enable front auto-sense entry
      onStep?.(1, "Enabling front entry...");
      this.log("INFO", [], "Step 1: FD0 (enable front auto-sense)...");
      await this.sendCmdList2(buildFD0Packet(this.addH, this.addL));
      fd0Enabled = true;
      await this.delay(CMD_DELAY);

      // Step 2: Poll sensor1 (30s timeout) — wait for card inserted at front
      onStep?.(2, "Insert card from front bezel... (30s)");
      this.log("INFO", [], "Step 2: Polling for front entry (sensor1)...");
      let cardAtFront = false;
      const t1 = Date.now();
      while (Date.now() - t1 < 30000) {
        await this.delay(POLL_INTERVAL);
        const st = await this.queryAP();
        if (st && st.raw.byte4 & 0x07) {
          // Any channel sensor means something was inserted; FC1 (when the
          // firmware supports it) says definitively where it is.
          const pos = await this.queryPosition();
          if (!pos || pos.transport === "AT_FRONT" || pos.transport === "AT_READER") {
            this.log("INFO", [], `Step 2: Card detected at front${pos ? ` (${pos.transport})` : ""}`);
            cardAtFront = true;
            break;
          }
        }
      }
      if (!cardAtFront) {
        this.log("INFO", [], "Step 2: Front entry timeout");
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
        fd0Enabled = false;
        return { success: false, message: "Front entry timeout (0xA6).", errorCode: "EJECT_TIMEOUT" };
      }

      // Step 3: FC7 — move card to reader position / sensor3 (12s timeout)
      onStep?.(3, "Moving card to reader... (12s)");
      this.log("INFO", [], "Step 3: FC7 (move to reader / sensor3)...");
      const fc7Ok = await this.sendCmdList2(buildFC7Packet(this.addH, this.addL));
      if (!fc7Ok) {
        this.log("INFO", [], "Step 3: FC7 NAK");
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
        fd0Enabled = false;
        return { success: false, message: "FC7 failed.", errorCode: "FC7_TIMEOUT" };
      }
      let cardAtReader = false;
      const t2 = Date.now();
      while (Date.now() - t2 < FC7_TIMEOUT) {
        await this.delay(POLL_INTERVAL);
        const st = await this.queryAP();
        if (await this.confirmAtReader(st)) {
          this.log("INFO", [], "Step 3: Card at reader position");
          cardAtReader = true;
          break;
        }
        if (st && (st.flags.cardJam || st.flags.cardOverlap || st.flags.collectError)) {
          this.log("INFO", [], "Step 3: aborting — device reported a fault");
          break;
        }
      }
      if (!cardAtReader) {
        this.log("INFO", [], "Step 3: Move timeout — card did not reach reader");
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
        fd0Enabled = false;
        return { success: false, message: "Move timeout (0xA5).", errorCode: "FC7_TIMEOUT" };
      }

      // Step 4: CP — take the card into the recycle box (4s timeout)
      const boxName = "recycle box";
      onStep?.(4, "Returning card to recycle box...");
      this.log("INFO", [], "Step 4: CP (return to recycle box)...");

      // Refuse rather than jam: the device already told us the box is full.
      const preCollect = await this.queryAP();
      if (preCollect?.flags.recycleBoxFull) {
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
        fd0Enabled = false;
        return { success: false, message: "Recycle box is full — empty it before returning more cards.", errorCode: "DEVICE_BUSY", status: preCollect };
      }

      const dbOk = await this.sendCmdList2(buildCPPacket(this.addH, this.addL));
      if (!dbOk) {
        this.log("INFO", [], "Step 4: CP NAK");
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
        fd0Enabled = false;
        return { success: false, message: "Recycle command failed.", errorCode: "EJECT_TIMEOUT" };
      }
      const t3 = Date.now();
      while (Date.now() - t3 < EJECT_TIMEOUT) {
        await this.delay(POLL_INTERVAL);
        const st = await this.queryAP();
        if (st?.flags.collectError) {
          this.log("INFO", [], "Step 4: device reported a collection error");
          await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
          fd0Enabled = false;
          return { success: false, message: `Card collection error — check the channel and press RS.`, errorCode: "ISSUE_ERROR", status: st };
        }
        if (st && (st.raw.byte4 & 0x07) === 0) {
          this.log("INFO", [], `Step 4: Card returned to ${boxName}`);
          await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
          fd0Enabled = false;
          this.log("INFO", [], "=== VISITOR CHECKOUT SUCCESS ===");
          return { success: true, message: `Card returned to the ${boxName}.`, status: st };
        }
      }

      this.log("INFO", [], "Step 4: collect timeout");
      await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));
      fd0Enabled = false;
      return { success: false, message: "Return timeout. Card may still be in channel.", errorCode: "EJECT_TIMEOUT" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `FAILED: ${msg}`);
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    } finally {
      if (fd0Enabled) {
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL)).catch(() => {});
      }
    }
    });
  }

  // ---- Issue flow ----
  async issueCard(employeeId: string, name: string, department: string): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(async () => {
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

      this.log("INFO", [], "Step 2: FC7 dispense to reader...");
      const dispensed = await this.dispenseFC7();
      if (!dispensed) {
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

      this.log("INFO", [], "Step 3: FC0 eject out of mouth...");
      const fc0Result = await this.ejectFC0();
      if (!fc0Result.success) {
        if (!this.isConnected) {
          return { success: false, message: "Device disconnected during eject.", errorCode: "USB_DISCONNECTED" };
        }
        const errorCode: ErrorCode = fc0Result.resultCode === "CARD_JAM" ? "CARD_JAM"
          : fc0Result.resultCode === "CARD_OVERLAP" ? "CARD_OVERLAP"
          : fc0Result.resultCode === "CARD_EMPTY" ? "BOX_EMPTY"
          : fc0Result.resultCode === "DEVICE_ERROR" ? "ISSUE_ERROR"
          : fc0Result.resultCode === "NOT_CONNECTED" ? "NOT_CONNECTED"
          : fc0Result.resultCode === "TARGET_NOT_CONFIRMED" ? "TARGET_NOT_CONFIRMED"
          : fc0Result.resultCode === "MOVEMENT_TIMEOUT" ? "MOVEMENT_TIMEOUT"
          : "EJECT_TIMEOUT";
        return { success: false, message: fc0Result.message, errorCode };
      }

      this.log("INFO", [], "=== SUCCESS ===");
      const status = await this.queryAP();
      return { success: true, message: `Card issued for ${name} (${employeeId} — ${department}) — please collect the card.`, status: status ?? undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `FAILED: ${msg}`);
      if (msg.includes("disconnect") || msg.includes("device")) {
        return { success: false, message: "Device disconnected. Reconnect and try again.", errorCode: "USB_DISCONNECTED" };
      }
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    }
    });
  }
}
