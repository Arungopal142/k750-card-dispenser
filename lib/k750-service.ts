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
  | "COLLECT_ERROR"
  | "COMMAND_REJECTED"
  | "FRONT_ENTRY_TIMEOUT"
  | "RECYCLE_TIMEOUT"
  | "RECYCLE_BOX_FULL"
  | "UNKNOWN_ERROR";

/** Outcome of one movement step inside a flow (FC7 / CP / front-entry wait). */
interface StepResult {
  ok: boolean;
  message: string;
  errorCode?: ErrorCode;
  status?: DeviceStatus;
}

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
  /** Set when the card physically moved but a non-critical step (e.g. FD3) failed. */
  warning?: string;
}

/**
 * Per-step progress for the issue / return flows.
 * `total` is passed so the UI never has to hard-code the number of steps.
 */
export type FlowProgress = (step: number, total: number, message: string) => void;

/** Short labels for the issue flow progress bar (one per step). */
export const ISSUE_STEP_LABELS = [
  "Check machine",
  "Clear channel",
  "Dispense",
  "Deliver",
  "Idle",
] as const;

/** Short labels for the card-return flow progress bar (one per step). */
export const CHECKOUT_STEP_LABELS = [
  "Enable entry",
  "Insert card",
  "Move to reader",
  "Recycle",
  "Disable entry",
  "Idle",
] as const;

const ISSUE_STEPS = ISSUE_STEP_LABELS.length;
const CHECKOUT_STEPS = CHECKOUT_STEP_LABELS.length;

/** How long the front bezel stays armed waiting for the visitor to insert a card. */
const FRONT_ENTRY_TIMEOUT = 30000;

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
  /** FC7 — move a card to the reader position and wait for confirmation. */
  async dispenseFC7(): Promise<boolean> {
    if (!this.isConnected) return false;
    const result = await this.moveToReader("FC7");
    if (!result.ok) this.log("INFO", [], `FC7 failed: ${result.message}`);
    return result.ok;
  }

  /**
   * Public DC eject. Refuses while an issue/return flow owns the device.
   * Flow code must call `runDCEject` instead — `_flowBusy` is set for the whole
   * flow, so going through this wrapper would make the flow reject itself.
   */
  async ejectDC(): Promise<DCResult> {
    if (this._flowBusy) {
      return {
        success: false, confirmed: false, resultCode: "DEVICE_BUSY",
        message: "Device busy — an operation is already running.",
        pollCount: 0, elapsed: 0,
      };
    }
    return this.runDCEject();
  }

  private async runDCEject(): Promise<DCResult> {
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
  /** Public FC0 eject. See `ejectDC` for why flows use `runFC0Eject` instead. */
  async ejectFC0(): Promise<DCResult> {
    if (this._flowBusy) {
      return {
        success: false, confirmed: false, resultCode: "DEVICE_BUSY",
        message: "Device busy — an operation is already running.",
        pollCount: 0, elapsed: 0,
      };
    }
    return this.runFC0Eject();
  }

  private async runFC0Eject(): Promise<DCResult> {
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

  // ---- Fault classification ------------------------------------------------

  /**
   * Faults that must stop a flow before it drives any card. Returns null when
   * the machine is safe to command.
   */
  private criticalFault(status: DeviceStatus): { message: string; errorCode: ErrorCode } | null {
    const { flags } = status;
    if (flags.cardJam) return { message: "Card jam detected — clear the channel and press RS.", errorCode: "CARD_JAM" };
    if (flags.cardOverlap) return { message: "Card overlap detected — clear the channel and press RS.", errorCode: "CARD_OVERLAP" };
    if (flags.issueError) return { message: "Device reported a card issuing error — press RS to reset.", errorCode: "ISSUE_ERROR" };
    if (flags.collectError) return { message: "Device reported a card collection error — press RS to reset.", errorCode: "COLLECT_ERROR" };
    if (flags.commandCannotExecute) return { message: "Device cannot execute commands right now — press RS to reset.", errorCode: "COMMAND_REJECTED" };
    return null;
  }

  /** Translate a DC/FC0 movement result into the flow-level error code. */
  private dcErrorCode(result: DCResult): ErrorCode {
    switch (result.resultCode) {
      case "CARD_JAM": return "CARD_JAM";
      case "CARD_OVERLAP": return "CARD_OVERLAP";
      case "CARD_EMPTY":
      case "CARD_PRE_EMPTY": return "BOX_EMPTY";
      case "DEVICE_ERROR": return "ISSUE_ERROR";
      case "NOT_CONNECTED": return "NOT_CONNECTED";
      case "DEVICE_BUSY": return "DEVICE_BUSY";
      case "TARGET_NOT_CONFIRMED": return "TARGET_NOT_CONFIRMED";
      case "MOVEMENT_TIMEOUT": return "MOVEMENT_TIMEOUT";
      case "ACK_TIMEOUT": return "NAK_RECEIVED";
      case "COMMUNICATION_TIMEOUT": return "NO_RESPONSE";
      default: return "EJECT_TIMEOUT";
    }
  }

  // ---- Shared movement steps ----------------------------------------------

  /**
   * FC7 → poll AP until the card is confirmed at the reader position
   * (sensor 3). Used by both the issue flow (card from the stacker) and the
   * return flow (card inserted at the front bezel).
   */
  private async moveToReader(tag: string): Promise<StepResult> {
    this.log("INFO", [], `${tag}: FC7 — move card to reader position...`);
    if (!(await this.sendCmdList2(buildFC7Packet(this.addH, this.addL)))) {
      return { ok: false, message: "The machine did not accept the dispense command (FC7).", errorCode: "NAK_RECEIVED" };
    }

    const t0 = Date.now();
    let last: DeviceStatus | null = null;
    let n = 0;
    while (Date.now() - t0 < FC7_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      n++;
      const st = await this.queryAP();
      if (!st) { this.log("INFO", [], `${tag}: poll #${n} — no AP response`); continue; }
      last = st;
      this.log("INFO", [], `${tag}: poll #${n} b4=0x${st.raw.byte4.toString(16).padStart(2, "0")} reader=${!!(st.raw.byte4 & READER_SENSOR_MASK)}`);

      if (await this.confirmAtReader(st)) {
        this.log("INFO", [], `${tag}: card confirmed at reader position (sensor 3)`);
        return { ok: true, message: "Card at reader position.", status: st };
      }
      const fault = this.criticalFault(st);
      if (fault) {
        this.log("INFO", [], `${tag}: aborting — ${fault.message}`);
        return { ok: false, message: fault.message, errorCode: fault.errorCode, status: st };
      }
      // Hopper empty *and* nothing moving means no card was ever picked.
      if (st.flags.boxEmpty && !(st.raw.byte4 & 0x07) && !st.flags.cardIssuing) {
        this.log("INFO", [], `${tag}: aborting — hopper empty and nothing moving`);
        return { ok: false, message: "Card box is empty — refill the card stacker.", errorCode: "BOX_EMPTY", status: st };
      }
      if (!this.isConnected) {
        return { ok: false, message: "Device disconnected while moving the card.", errorCode: "USB_DISCONNECTED" };
      }
    }
    this.log("INFO", [], `${tag}: timeout after ${n} polls`);
    return {
      ok: false,
      message: `The card did not reach the reader position within ${FC7_TIMEOUT / 1000}s.`,
      errorCode: "FC7_TIMEOUT",
      status: last ?? undefined,
    };
  }

  /**
   * Poll the channel until a card shows up at the front bezel, or give up after
   * `timeoutMs`. FD0 must already have been enabled by the caller.
   */
  private async waitForFrontCard(timeoutMs: number): Promise<StepResult> {
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < timeoutMs) {
      await this.delay(POLL_INTERVAL);
      n++;
      if (!this.isConnected) {
        return { ok: false, message: "Device disconnected while waiting for the card.", errorCode: "USB_DISCONNECTED" };
      }
      const st = await this.queryAP();
      if (!st) continue;

      const fault = this.criticalFault(st);
      if (fault) {
        this.log("INFO", [], `Front entry: aborting — ${fault.message}`);
        return { ok: false, message: fault.message, errorCode: fault.errorCode, status: st };
      }
      if (st.raw.byte4 & 0x07) {
        // Any channel sensor means something was inserted; FC1 (when the
        // firmware supports it) says definitively where it is.
        const pos = await this.queryPosition();
        if (!pos || pos.transport === "AT_FRONT" || pos.transport === "AT_READER") {
          this.log("INFO", [], `Front entry: card detected after ${n} polls${pos ? ` (${pos.transport})` : ""}`);
          return { ok: true, message: "Card detected.", status: st };
        }
      }
    }
    this.log("INFO", [], `Front entry: timeout after ${n} polls`);
    return {
      ok: false,
      message: `No card was inserted within ${Math.round(timeoutMs / 1000)} seconds — the return was cancelled.`,
      errorCode: "FRONT_ENTRY_TIMEOUT",
    };
  }

  /** CP → poll AP until the channel is clear, i.e. the card is in the recycle box. */
  private async recycleToBox(): Promise<StepResult> {
    this.log("INFO", [], "CP: move card into the recycle box...");
    if (!(await this.sendCmdList2(buildCPPacket(this.addH, this.addL)))) {
      return { ok: false, message: "The machine did not accept the recycle command (CP).", errorCode: "NAK_RECEIVED" };
    }

    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < EJECT_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      n++;
      const st = await this.queryAP();
      if (!st) { this.log("INFO", [], `CP: poll #${n} — no AP response`); continue; }

      if (st.flags.collectError) {
        return { ok: false, message: "Card collection error — check the channel and press RS.", errorCode: "COLLECT_ERROR", status: st };
      }
      if (st.flags.cardJam) {
        return { ok: false, message: "Card jam while recycling — clear the channel and press RS.", errorCode: "CARD_JAM", status: st };
      }
      if ((st.raw.byte4 & 0x07) === 0) {
        this.log("INFO", [], `CP: channel clear after ${n} polls — card is in the recycle box`);
        return { ok: true, message: "Card recycled.", status: st };
      }
    }
    this.log("INFO", [], `CP: timeout after ${n} polls`);
    return {
      ok: false,
      message: "The card did not reach the recycle box in time — it may still be in the channel.",
      errorCode: "RECYCLE_TIMEOUT",
    };
  }

  // ---- Pre-issue check ----
  async preIssueCheck(): Promise<string | null> {
    const status = await this.queryAP();
    if (!status) return "Cannot read device status.";
    const { raw, flags } = status;
    if (flags.boxEmpty) return "Card box is empty.";
    if (raw.byte4 & 0x07) return "Card in channel — eject first.";
    const fault = this.criticalFault(status);
    if (fault) return fault.message;
    if (flags.cardIssuing || flags.cardCollecting) return "Device busy — wait for current operation.";
    return null;
  }

  // ---- Issue flow: pre-check → auto-clear (FC0) → FC7 → FC0 → FD3 ----------
  //
  // Nothing here writes to the database. The caller persists the transaction
  // only after this resolves with success:true, so a failed dispense can never
  // be recorded as an issued card.
  private async runIssueFlow(successMessage: string, onStep?: FlowProgress): Promise<IssueResult> {
    const step = (n: number, msg: string) => {
      onStep?.(n, ISSUE_STEPS, msg);
      this.log("INFO", [], `Issue ${n}/${ISSUE_STEPS}: ${msg}`);
    };

    try {
      this.log("INFO", [], "=== Issue Card flow ===");

      // --- Step 1: pre-check ----------------------------------------------
      step(1, "Checking machine...");
      const pre = await this.queryAP();
      if (!pre) {
        return { success: false, message: "Cannot read the machine status — no response from the K750.", errorCode: "NO_RESPONSE" };
      }
      const preFault = this.criticalFault(pre);
      if (preFault) {
        return { success: false, message: preFault.message, errorCode: preFault.errorCode, status: pre };
      }
      if (pre.flags.boxEmpty) {
        return { success: false, message: "Card box is empty — refill the card stacker.", errorCode: "BOX_EMPTY", status: pre };
      }
      // A full recycle box only blocks card *returns*, never issuing.
      if (pre.flags.recycleBoxFull) this.log("INFO", [], "Note: recycle box is full (does not block issuing).");

      // --- Step 2: auto-clear a card already in the channel -----------------
      if (pre.raw.byte4 & 0x07) {
        step(2, "Clearing existing card...");
        // Try DC first (eject to front bezel), then FC0 (drop from bayonet)
        let clear = await this.ejectDC();
        if (!clear.success) {
          this.log("INFO", [], "DC clear failed, trying FC0...");
          clear = await this.runFC0Eject();
        }
        if (!clear.success) {
          return {
            success: false,
            message: `Could not clear the card already in the channel: ${clear.message}`,
            errorCode: this.dcErrorCode(clear),
            status: clear.finalStatus,
          };
        }
        await this.delay(CMD_DELAY);
        const after = await this.queryAP();
        if (!after) {
          return { success: false, message: "Cannot read the machine status after clearing the channel.", errorCode: "NO_RESPONSE" };
        }
        if (after.raw.byte4 & 0x07) {
          return { success: false, message: "A card is still in the channel — remove it and try again.", errorCode: "CARD_IN_CHANNEL", status: after };
        }
      } else {
        onStep?.(2, ISSUE_STEPS, "Channel clear.");
      }

      // --- Step 3: FC7 — stacker → reader position (sensor 3) ---------------
      step(3, "Dispensing card...");
      const move = await this.moveToReader("FC7");
      if (!move.ok) {
        if (!this.isConnected) {
          return { success: false, message: "Device disconnected during dispense.", errorCode: "USB_DISCONNECTED" };
        }
        return { success: false, message: move.message, errorCode: move.errorCode ?? "DISPENSE_FAILED", status: move.status };
      }

      await this.delay(CMD_DELAY);

      // --- Step 4: FC0 — reader → front bayonet -----------------------------
      step(4, "Delivering card...");
      const drop = await this.runFC0Eject();
      if (!drop.success) {
        if (!this.isConnected) {
          return { success: false, message: "Device disconnected while delivering the card.", errorCode: "USB_DISCONNECTED" };
        }
        return { success: false, message: drop.message, errorCode: this.dcErrorCode(drop), status: drop.finalStatus };
      }
      onStep?.(4, ISSUE_STEPS, "Card ready for collection.");

      // --- Step 5: FD3 — back to the idle/rest state ------------------------
      // The card is physically out from here on, so nothing below may turn this
      // into a failure — a failed reset is reported as a warning instead.
      step(5, "Returning machine to idle...");
      const idle = await this.resetFD3();
      const warning = idle
        ? undefined
        : "The card was delivered, but the machine did not confirm the reset to idle (FD3). Press RS if the next operation fails.";
      if (!idle) this.log("INFO", [], "FD3 not acknowledged — machine may not be in the idle state");

      await this.delay(CMD_DELAY);
      const finalStatus = await this.queryAP();
      onStep?.(ISSUE_STEPS, ISSUE_STEPS, warning ?? "Machine ready.");
      this.log("INFO", [], "=== ISSUE SUCCESS — card ready for collection ===");
      return { success: true, message: successMessage, status: finalStatus ?? undefined, warning };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `Issue flow FAILED: ${msg}`);
      if (msg.includes("disconnect") || msg.includes("device")) {
        return { success: false, message: "Device disconnected. Reconnect and try again.", errorCode: "USB_DISCONNECTED" };
      }
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    }
  }

  /**
   * Issue a card to an employee.
   * Sequence: pre-check → FC0 (auto-clear) → FC7 → FC0 → FD3.
   * Concurrent calls are rejected with DEVICE_BUSY.
   */
  async issueCard(employeeId: string, name: string, department: string, onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(() =>
      this.runIssueFlow(`Card issued for ${name} (${employeeId} — ${department}) — please collect the card.`, onStep)
    );
  }

  /** Same hardware sequence as issueCard, with visitor-shaped wording. */
  async issueVisitorCard(visitorName: string, company: string, host: string, onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(() =>
      this.runIssueFlow(`Card ready for: ${visitorName} - ${company} - ${host}`, onStep)
    );
  }

  // ---- Card return / check-out: FD0 → wait 30s → FC7 → CP → FD1 → FD3 ------
  //
  // The returned card always goes to the recycle box (CP), never back into the
  // issuing hopper (DB). The caller updates Firestore only on success:true.
  async visitorCheckout(onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    return this.runFlow(async () => {
      let autoSenseOn = false;
      const step = (n: number, msg: string) => {
        onStep?.(n, CHECKOUT_STEPS, msg);
        this.log("INFO", [], `Return ${n}/${CHECKOUT_STEPS}: ${msg}`);
      };

      try {
        this.log("INFO", [], "=== Card Return flow ===");

        // --- Step 1: FD0 — enable front auto-sensing ------------------------
        step(1, "Checking machine...");
        const pre = await this.queryAP();
        if (!pre) {
          return { success: false, message: "Cannot read the machine status — no response from the K750.", errorCode: "NO_RESPONSE" };
        }
        const preFault = this.criticalFault(pre);
        if (preFault) {
          return { success: false, message: preFault.message, errorCode: preFault.errorCode, status: pre };
        }
        // Refuse rather than jam: the device already told us the box is full.
        if (pre.flags.recycleBoxFull) {
          return { success: false, message: "Recycle box is full — empty it before returning more cards.", errorCode: "RECYCLE_BOX_FULL", status: pre };
        }

        onStep?.(1, CHECKOUT_STEPS, "Enabling card entry...");
        if (!(await this.sendCmdList2(buildFD0Packet(this.addH, this.addL)))) {
          return { success: false, message: "The machine did not accept the front-entry command (FD0).", errorCode: "NAK_RECEIVED" };
        }
        autoSenseOn = true;
        await this.delay(CMD_DELAY);

        // --- Step 2: wait up to 30s for the visitor to insert the card -------
        step(2, "Please insert the card...");
        const inserted = await this.waitForFrontCard(FRONT_ENTRY_TIMEOUT);
        if (!inserted.ok) {
          return { success: false, message: inserted.message, errorCode: inserted.errorCode ?? "FRONT_ENTRY_TIMEOUT", status: inserted.status };
        }
        onStep?.(2, CHECKOUT_STEPS, "Card detected.");

        // --- Step 3: FC7 — move the card to the reader position -------------
        step(3, "Moving card to reader...");
        const move = await this.moveToReader("FC7 (return)");
        if (!move.ok) {
          return { success: false, message: move.message, errorCode: move.errorCode ?? "FC7_TIMEOUT", status: move.status };
        }

        // --- Step 4: CP — drop the card into the recycle box -----------------
        step(4, "Recycling card...");
        const recycled = await this.recycleToBox();
        if (!recycled.ok) {
          return { success: false, message: recycled.message, errorCode: recycled.errorCode ?? "RECYCLE_TIMEOUT", status: recycled.status };
        }

        // The card is physically in the recycle box from here on — the return
        // has succeeded, so the two cleanup steps below only produce warnings.
        const warnings: string[] = [];

        // --- Step 5: FD1 — disable front auto-sensing ------------------------
        step(5, "Disabling card entry...");
        if (await this.sendCmdList2(buildFD1Packet(this.addH, this.addL))) {
          autoSenseOn = false;
        } else {
          warnings.push("front auto-sensing could not be disabled (FD1)");
          this.log("INFO", [], "FD1 not acknowledged — the finally block will retry");
        }

        // --- Step 6: FD3 — back to the idle/rest state ------------------------
        step(6, "Returning machine to idle...");
        if (!(await this.resetFD3())) {
          warnings.push("the machine did not confirm the reset to idle (FD3)");
          this.log("INFO", [], "FD3 not acknowledged — machine may not be in the idle state");
        }

        await this.delay(CMD_DELAY);
        const finalStatus = await this.queryAP();
        const warning = warnings.length
          ? `The card was recycled, but ${warnings.join(" and ")}. Press RS if the next operation fails.`
          : undefined;
        onStep?.(CHECKOUT_STEPS, CHECKOUT_STEPS, warning ?? "Machine ready.");
        this.log("INFO", [], "=== CARD RETURN SUCCESS ===");
        return {
          success: true,
          message: "Card returned successfully.",
          status: finalStatus ?? recycled.status,
          warning,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("INFO", [], `Card return FAILED: ${msg}`);
        return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
      } finally {
        // Never leave the front bezel armed after a failed or aborted return.
        if (autoSenseOn) {
          this.log("INFO", [], "FD1: disabling front auto-sense after an incomplete return...");
          await this.sendCmdList2(buildFD1Packet(this.addH, this.addL)).catch(() => {});
        }
      }
    });
  }
}
