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
  warning?: string;
}

export type FlowProgress = (step: number, total: number, message: string) => void;

export const ISSUE_STEP_LABELS = [
  "Check machine",
  "Dispense",
  "Deliver",
] as const;

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

const FRONT_ENTRY_TIMEOUT = 30000;

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
const POLL_INTERVAL = 300;
const FC7_TIMEOUT = 12000;
const EJECT_TIMEOUT = 4000;
const ACK_TIMEOUT = 1000;
const RESPONSE_TIMEOUT = 2000;
const READER_SENSOR_MASK = 0x04;

function decodeB4Channel(b4: number): string {
  const sensors: string[] = [];
  if (b4 & 0x01) sensors.push("S1");
  if (b4 & 0x02) sensors.push("S2");
  if (b4 & 0x04) sensors.push("S3");
  return sensors.length > 0 ? sensors.join("+") : "EMPTY";
}

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
  private disconnectHandler?: (event: { port: SerialPort }) => void;
  private lastAPQueryTime = 0;
  private lastCommandTime = 0;
  private consecutiveFailures = 0;
  private _reconnecting = false;
  private _deviceAddress = 0;
  private _fc1Supported: boolean | null = null;

  get isBusy() { return this._busy; }
  get isFlowBusy() { return false; }

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

  private runFlow<T>(fn: () => Promise<T>): Promise<T | { success: false; message: string; errorCode: "UNKNOWN_ERROR" }> {
    return new Promise<T | { success: false; message: string; errorCode: "UNKNOWN_ERROR" }>((resolve) => {
      fn().then(
        (result) => { resolve(result); },
        (error) => { resolve({ success: false, message: String(error), errorCode: "UNKNOWN_ERROR" as const }); }
      );
    });
  }

  private log(direction: "TX" | "RX" | "INFO", data: Uint8Array | number[], text?: string) {
    const hex = typeof data === "object" && "length" in data ? bytesToHex(data) : String(data);
    this.onLog?.({ timestamp: Date.now(), direction, hex, text });
  }

  private delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
  get isConnected(): boolean { return this._connected; }

  async getAvailablePorts(): Promise<SerialPort[]> {
    try {
      if (navigator.serial) {
        return await navigator.serial.getPorts();
      }
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
      this.onConnectionChange?.("connected");
      this.log("INFO", [], "Connected - reader loop started");

      this.log("INFO", [], "Health check: querying AP...");
      let status = await this.queryAP();
      if (!status) {
        this.log("INFO", [], "Health check: no answer at current address, scanning 0-15...");
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

    const maxAttempts = 10;
    const delayMs = 2000;

    try {
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

  private checkAutoReconnect(): void {
    if (this.consecutiveFailures >= 5 && this._connected && !this._manualDisconnect) {
      this.log("INFO", [], `5 consecutive failures — triggering auto-reconnect`);
      this.consecutiveFailures = 0;
      this.onAutoReconnect?.();
      this.attemptReconnect();
    }
  }

  async queryAP(): Promise<DeviceStatus | null> {
    if (!this.isConnected) return null;
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

  get deviceAddress(): number { return this._deviceAddress; }

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
      if (!settings) { this.log("INFO", [], "FR: no/!invalid settings response"); return null; }
      this.log("INFO", [], `FR: ${settings.frontEntry}; ${settings.resetAction}`);
      return settings;
    } catch { return null; }
  }

  private parseAPResponse(response: number[]): DeviceStatus | null {
    const statusBytes = parseAPStatusFromResponse(response);
    if (!statusBytes) return null;
    this.log("INFO", [], `AP parse: B1=0x${statusBytes.byte1.toString(16).padStart(2, "0")} B2=0x${statusBytes.byte2.toString(16).padStart(2, "0")} B3=0x${statusBytes.byte3.toString(16).padStart(2, "0")} B4=0x${statusBytes.byte4.toString(16).padStart(2, "0")}`);
    const deviceStatus: DeviceStatus = { raw: statusBytes, flags: getStatusFlags(statusBytes), hex: bytesToHex(response) };
    this.onStatusChange?.(deviceStatus);
    return deviceStatus;
  }

  // ---- FC7: dispense to reader (matching working reference) ----
  async dispenseFC7(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConnected) return { ok: false, error: "NOT_CONNECTED" };
    this.log("INFO", [], "FC7: dispense...");
    const sent = await this.sendCmdList2(buildFC7Packet(this.addH, this.addL));
    if (!sent) { this.log("INFO", [], "FC7: NAK"); return { ok: false, error: "NAK" }; }

    this.log("INFO", [], "FC7: polling for sensor3...");
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < FC7_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      n++;
      const st = await this.queryAP();
      if (st) {
        const { flags, raw } = st;
        const channelLabel = decodeB4Channel(raw.byte4);
        this.log("INFO", [], `FC7 #${n}: B4=0x${raw.byte4.toString(16).padStart(2, "0")} channel=[${channelLabel}] S3=${flags.cardAtSensor3}`);

        if (flags.cardAtSensor3) {
          this.log("INFO", [], "FC7: card at reader, waiting for motor to settle...");
          await this.delay(500);
          return { ok: true };
        }
        if (flags.boxEmpty) {
          this.log("INFO", [], "FC7: BOX EMPTY");
          return { ok: false, error: "BOX_EMPTY" };
        }
        if (flags.cardJam) {
          this.log("INFO", [], "FC7: CARD JAM");
          return { ok: false, error: "CARD_JAM" };
        }
        if (flags.cardOverlap) {
          this.log("INFO", [], "FC7: CARD OVERLAP");
          return { ok: false, error: "CARD_OVERLAP" };
        }
        if (flags.issueError) {
          this.log("INFO", [], "FC7: ISSUE ERROR");
          return { ok: false, error: "ISSUE_ERROR" };
        }
        if (flags.commandCannotExecute) {
          this.log("INFO", [], "FC7: CANNOT EXECUTE");
          return { ok: false, error: "CANNOT_EXECUTE" };
        }
      }
    }
    this.log("INFO", [], `FC7: timeout after ${n} polls`);
    return { ok: false, error: "FC7_TIMEOUT" };
  }

  // ---- FC0: eject out of mouth (matching working reference — sensor transition) ----
  async ejectFC0(): Promise<DCResult> {
    const result: DCResult = {
      success: false, confirmed: false, resultCode: "MOVEMENT_TIMEOUT",
      message: "", pollCount: 0, elapsed: 0,
    };

    if (!this.isConnected) {
      result.resultCode = "NOT_CONNECTED";
      result.message = "Device not connected.";
      return result;
    }

    this.log("INFO", [], "FC0: sending eject command...");
    const ok = await this.sendCmdList2(buildFC0Packet(this.addH, this.addL));
    if (!ok) {
      result.resultCode = "ACK_TIMEOUT";
      result.message = "FC0 command not acknowledged.";
      return result;
    }

    await this.delay(100);

    let sawSensorsActive = false;
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
        if (Date.now() - t0 >= EJECT_TIMEOUT) break;
        if (retry < 1) await this.delay(200);
      }

      if (!st) continue;

      const { flags } = st;
      const anySensorActive = (st.raw.byte4 & 0x07) !== 0;

      this.log("INFO", [], [
        `FC0: #${pollCount}`,
        `B4=0x${st.raw.byte4.toString(16).padStart(2, "0")}`,
        `S3=${flags.cardAtSensor3} S2=${flags.cardAtSensor2} S1=${flags.cardAtSensor1}`,
      ].join(" "));

      if (flags.commandCannotExecute) {
        result.resultCode = "DEVICE_ERROR";
        result.message = "Device cannot execute command.";
        result.finalStatus = st;
        return result;
      }
      if (flags.cardJam) {
        result.resultCode = "CARD_JAM";
        result.message = "Card jam detected.";
        result.finalStatus = st;
        return result;
      }
      if (flags.cardOverlap) {
        result.resultCode = "CARD_OVERLAP";
        result.message = "Card overlap detected.";
        result.finalStatus = st;
        return result;
      }

      if (anySensorActive) {
        sawSensorsActive = true;
      } else if (sawSensorsActive) {
        sawTransition = true;
      }

      if (sawTransition) {
        result.success = true;
        result.confirmed = true;
        result.resultCode = "SUCCESS";
        result.message = "Card ejected.";
        result.finalStatus = st;
        result.elapsed = Date.now() - t0;
        this.log("INFO", [], `FC0: SUCCESS — card ejected in ${result.elapsed}ms`);
        return result;
      }
    }

    result.elapsed = Date.now() - t0;
    result.resultCode = sawSensorsActive ? "MOVEMENT_TIMEOUT" : "TARGET_NOT_CONFIRMED";
    result.message = sawSensorsActive
      ? `Card stuck — sensors active after ${result.elapsed}ms`
      : `No sensor activity within ${result.elapsed}ms`;
    this.log("INFO", [], `FC0: ${result.resultCode} (${pollCount} polls, ${result.elapsed}ms)`);
    return result;
  }

  // ---- DC eject ----
  async ejectDC(): Promise<DCResult> {
    const result: DCResult = {
      success: false, confirmed: false, resultCode: "MOVEMENT_TIMEOUT",
      message: "", pollCount: 0, elapsed: 0,
    };
    if (!this.isConnected) {
      result.resultCode = "NOT_CONNECTED";
      result.message = "Device not connected.";
      return result;
    }
    const ok = await this.sendCmdList2(buildDCPacket(this.addH, this.addL));
    if (!ok) {
      result.resultCode = "ACK_TIMEOUT";
      result.message = "DC command not acknowledged.";
      return result;
    }
    await this.delay(100);
    let sawSensorsActive = false;
    let sawTransition = false;
    const t0 = Date.now();
    let pollCount = 0;
    while (Date.now() - t0 < EJECT_TIMEOUT) {
      await this.delay(POLL_INTERVAL);
      pollCount++;
      result.pollCount = pollCount;
      const st = await this.queryAP();
      if (!st) continue;
      const { flags } = st;
      const anySensorActive = (st.raw.byte4 & 0x07) !== 0;
      if (flags.commandCannotExecute) { result.resultCode = "DEVICE_ERROR"; result.message = "Device cannot execute command."; result.finalStatus = st; return result; }
      if (flags.cardJam) { result.resultCode = "CARD_JAM"; result.message = "Card jam detected."; result.finalStatus = st; return result; }
      if (flags.cardOverlap) { result.resultCode = "CARD_OVERLAP"; result.message = "Card overlap detected."; result.finalStatus = st; return result; }
      if (anySensorActive) { sawSensorsActive = true; }
      else if (sawSensorsActive) { sawTransition = true; }
      if (sawTransition) {
        result.success = true; result.confirmed = true; result.resultCode = "SUCCESS";
        result.message = "Card ejected."; result.finalStatus = st; result.elapsed = Date.now() - t0;
        return result;
      }
    }
    result.elapsed = Date.now() - t0;
    result.resultCode = sawSensorsActive ? "MOVEMENT_TIMEOUT" : "TARGET_NOT_CONFIRMED";
    result.message = sawSensorsActive ? `Card stuck after ${result.elapsed}ms` : `No sensor activity within ${result.elapsed}ms`;
    return result;
  }

  // ---- Individual commands (used by admin device page) ----
  async returnDB(): Promise<boolean> {
    if (!this.isConnected) return false;
    this.log("INFO", [], "DB: return to issuing box...");
    return await this.sendCmdList2(buildDBPacket(this.addH, this.addL));
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

  // ---- Issue card (matching working reference) ----
  async issueCard(employeeId: string, name: string, department: string, onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected. Please connect first.", errorCode: "NOT_CONNECTED" };

    const step = (n: number, msg: string) => {
      onStep?.(n, ISSUE_STEPS, msg);
      this.log("INFO", [], `[ISSUE] ${msg}`);
    };

    return this.runFlow(async () => {
      try {
        this.log("INFO", [], "=== Issue flow ===");

        // Step 1: Pre-check
        step(1, "Checking machine...");
        const pre = await this.queryAP();
        if (!pre) {
          return { success: false, message: "Cannot read the machine status — no response from the K750.", errorCode: "NO_RESPONSE" };
        }
        const { flags } = pre;
        if (flags.boxEmpty) return { success: false, message: "Card box is empty.", errorCode: "BOX_EMPTY", status: pre };
        if (pre.raw.byte4 & 0x07) return { success: false, message: "Card in channel — eject first.", errorCode: "CARD_IN_CHANNEL", status: pre };
        if (flags.cardJam) return { success: false, message: "Card jam — press RS.", errorCode: "CARD_JAM", status: pre };
        if (flags.cardOverlap) return { success: false, message: "Card overlap — press RS.", errorCode: "CARD_OVERLAP", status: pre };
        if (flags.issueError) return { success: false, message: "Issue error — press RS.", errorCode: "ISSUE_ERROR", status: pre };
        if (flags.collectError) return { success: false, message: "Collection error — press RS.", errorCode: "COLLECT_ERROR", status: pre };
        if (flags.commandCannotExecute) return { success: false, message: "Command cannot execute.", errorCode: "COMMAND_REJECTED", status: pre };

        // Step 2: FC7 dispense to reader
        step(2, "Dispensing card...");
        const fc7 = await this.dispenseFC7();
        if (!fc7.ok) {
          const errorCode = fc7.error === "BOX_EMPTY" ? "BOX_EMPTY"
            : fc7.error === "CARD_JAM" ? "CARD_JAM"
            : fc7.error === "CARD_OVERLAP" ? "CARD_OVERLAP"
            : "FC7_TIMEOUT";
          const errorMsg = fc7.error === "BOX_EMPTY" ? "Card box is empty."
            : fc7.error === "CARD_JAM" ? "Card jam. Press RS."
            : fc7.error === "CARD_OVERLAP" ? "Card overlap. Press RS."
            : "Dispense failed — card did not reach reader.";
          return { success: false, message: errorMsg, errorCode };
        }

        // Step 3: FC0 eject out of mouth
        step(3, "Delivering card...");
        this.log("INFO", [], "FC0: eject...");
        const fc0Result = await this.ejectFC0();
        if (!fc0Result.success) {
          const errorCode = fc0Result.resultCode === "CARD_JAM" ? "CARD_JAM"
            : fc0Result.resultCode === "CARD_OVERLAP" ? "CARD_OVERLAP"
            : fc0Result.resultCode === "DEVICE_ERROR" ? "ISSUE_ERROR"
            : "EJECT_TIMEOUT";
          return { success: false, message: fc0Result.message, errorCode };
        }

        this.log("INFO", [], "=== SUCCESS ===");
        return { success: true, message: `Card issued for ${name} (${employeeId} — ${department}) — please collect the card.` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("INFO", [], `[ISSUE] FAILED: ${msg}`);
        return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
      }
    });
  }

  async issueVisitorCard(visitorName: string, company: string, host: string, onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    return this.issueCard(visitorName, company, host, onStep);
  }

  // ---- Card return (matching working reference) ----
  async visitorCheckout(onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };

    let fd0Enabled = false;
    const step = (n: number, msg: string) => {
      onStep?.(n, CHECKOUT_STEPS, msg);
      this.log("INFO", [], `Return ${n}/${CHECKOUT_STEPS}: ${msg}`);
    };

    try {
      this.log("INFO", [], "=== Card Return flow ===");

      // Step 1: FD0 — enable front auto-sense entry
      step(1, "Enabling card entry...");
      const fd0 = await this.sendCmdList2(buildFD0Packet(this.addH, this.addL));
      if (!fd0) return { success: false, message: "FD0 command failed.", errorCode: "NAK_RECEIVED" };
      fd0Enabled = true;
      await this.delay(CMD_DELAY);

      // Step 2: Poll for front entry (30s)
      step(2, "Please insert the card...");
      this.log("INFO", [], "Polling for front entry...");
      let cardAtFront = false;
      const t1 = Date.now();
      while (Date.now() - t1 < FRONT_ENTRY_TIMEOUT) {
        await this.delay(POLL_INTERVAL);
        const st = await this.queryAP();
        if (!st) continue;
        if (st.flags.cardJam) return { success: false, message: "Card jam detected.", errorCode: "CARD_JAM", status: st };
        if (st.flags.cardOverlap) return { success: false, message: "Card overlap detected.", errorCode: "CARD_OVERLAP", status: st };
        if (st.flags.collectError) return { success: false, message: "Collection error.", errorCode: "COLLECT_ERROR", status: st };
        if (st.raw.byte4 & 0x07) {
          this.log("INFO", [], "Card detected at front entry");
          cardAtFront = true;
          break;
        }
      }
      if (!cardAtFront) {
        return { success: false, message: "Front entry timeout — no card inserted.", errorCode: "FRONT_ENTRY_TIMEOUT" };
      }

      // Step 3: FC7 — move card to reader position
      step(3, "Moving card to reader...");
      const fc7 = await this.dispenseFC7();
      if (!fc7.ok) {
        return { success: false, message: `FC7 failed: ${fc7.error}`, errorCode: fc7.error as ErrorCode || "FC7_TIMEOUT" };
      }

      // Step 4: CP — recycle to recycling box
      step(4, "Recycling card...");
      this.log("INFO", [], "CP: recycle to box...");
      const cp = await this.sendCmdList2(buildCPPacket(this.addH, this.addL));
      if (!cp) return { success: false, message: "CP command failed.", errorCode: "NAK_RECEIVED" };

      // Wait for card to clear channel
      const t3 = Date.now();
      while (Date.now() - t3 < EJECT_TIMEOUT) {
        await this.delay(POLL_INTERVAL);
        const st = await this.queryAP();
        if (st && (st.raw.byte4 & 0x07) === 0) {
          this.log("INFO", [], "Card recycled to box");
          break;
        }
      }

      // Step 5: FD1 — disable front auto-sensing
      step(5, "Disabling card entry...");
      await this.sendCmdList2(buildFD1Packet(this.addH, this.addL));

      this.log("INFO", [], "=== CARD RETURN SUCCESS ===");
      return { success: true, message: "Card returned successfully." };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("INFO", [], `Card return FAILED: ${msg}`);
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    } finally {
      if (fd0Enabled) {
        await this.sendCmdList2(buildFD1Packet(this.addH, this.addL)).catch(() => {});
      }
    }
  }
}
