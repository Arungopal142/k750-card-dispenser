export const STX = 0x02;
const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
const ENQ = 0x05;

export const DEFAULT_ADDH = 0x30;
export const DEFAULT_ADDL = 0x30;

/**
 * Device address (DIP switch 0–15) as the two ASCII decimal digits the device
 * expects: address 0 → "00" (0x30 0x30), address 10 → "10" (0x31 0x30).
 * Matches the vendor Android SDK, which builds it as
 *   buf[1] = mac >= 10 ? '1' : '0';  buf[2] = '0' + mac % 10;
 */
export function addressBytes(addr: number): { addH: number; addL: number } {
  if (!Number.isInteger(addr) || addr < 0 || addr > 15) {
    throw new Error(`device address must be 0-15, got ${addr}`);
  }
  return { addH: 0x30 + Math.floor(addr / 10), addL: 0x30 + (addr % 10) };
}

export interface StatusBytes {
  byte1: number;
  byte2: number;
  byte3: number;
  byte4: number;
}

export interface StatusFlags {
  // B1 — Machine status (lower nibble of first ASCII hex char)
  recycleBoxFull: boolean;        // B1 bit3 (0x08)
  commandCannotExecute: boolean;  // B1 bit2 (0x04)
  cardPrepareFailed: boolean;     // B1 bit1 (0x02) — K720 only
  cardHopperPreFull: boolean;     // B1 bit0 (0x01) — K750 card box pre-full
  // B2 — Machine action status (lower nibble of second ASCII hex char)
  cardIssuing: boolean;           // B2 bit3 (0x08) — "Sending card"
  cardCollecting: boolean;        // B2 bit2 (0x04) — "Collecting card"
  issueError: boolean;            // B2 bit1 (0x02) — "Error of issuing card"
  collectError: boolean;          // B2 bit0 (0x01) — "Error of recycling card"
  // B3 — Card box status (lower nibble of third ASCII hex char)
  cardHopperFull: boolean;        // B3 bit3 (0x08) — K750 only
  cardOverlap: boolean;           // B3 bit2 (0x04)
  cardJam: boolean;               // B3 bit1 (0x02)
  cardPreEmpty: boolean;          // B3 bit0 (0x01)
  // B4 — Channel status (lower nibble of fourth ASCII hex char)
  boxEmpty: boolean;              // B4 bit3 (0x08) — card box empty
  cardAtSensor3: boolean;         // B4 bit2 (0x04) — card at reader position
  cardAtSensor2: boolean;         // B4 bit1 (0x02) — card at middle position
  cardAtSensor1: boolean;         // B4 bit0 (0x01) — card at front/entry position
}

function computeBCC(data: number[]): number {
  let bcc = 0;
  for (const byte of data) {
    bcc ^= byte;
  }
  return bcc;
}

/*
 * buildPacket — raw payload version (matches vendor spec exactly).
 * payload = everything after SELEN and before ETX.
 *
 * Self-test BCC vectors (all verified):
 *   AP:  payload=[41,50]       → 02 30 30 00 02 41 50 03 12
 *   FC7: payload=[46,43,37]    → 02 30 30 00 03 46 43 37 03 30
 *   FC0: payload=[46,43,30]    → 02 30 30 00 03 46 43 30 03 37
 *   CP:  payload=[43,50]       → 02 30 30 00 02 43 50 03 10
 *   DB:  payload=[44,42]       → 02 30 30 00 02 44 42 03 05
 */
function buildPacket(
  payload: number[],
  addH: number = DEFAULT_ADDH,
  addL: number = DEFAULT_ADDL
): Uint8Array {
  const seLen = payload.length;
  const seLenH = (seLen >> 8) & 0xff;
  const seLenL = seLen & 0xff;

  const body: number[] = [STX, addH, addL, seLenH, seLenL, ...payload, ETX];
  const bcc = computeBCC(body);

  const packet = new Uint8Array(body.length + 1);
  packet.set(body);
  packet[body.length] = bcc;
  return packet;
}

export function buildENQ(addH: number = DEFAULT_ADDH, addL: number = DEFAULT_ADDL): Uint8Array {
  return new Uint8Array([ENQ, addH, addL]);
}

// Movement commands
export function buildAPPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x41, 0x50], addH, addL); // "AP"
}

// Runtime self-test: verify AP packet matches vendor spec
(function assertAPPacket() {
  const pkt = buildAPPacket();
  const expected = [0x02, 0x30, 0x30, 0x00, 0x02, 0x41, 0x50, 0x03, 0x12];
  const ok = pkt.length === expected.length && pkt.every((b, i) => b === expected[i]);
  if (!ok) {
    console.error(
      "[K750 PROTOCOL BUG] AP packet mismatch!",
      "got:", Array.from(pkt).map((b) => b.toString(16).padStart(2, "0")).join(" "),
      "expected:", expected.map((b) => b.toString(16).padStart(2, "0")).join(" ")
    );
  }
})();

export function buildFC7Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x37], addH, addL); // "FC7"
}

export function buildDCPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x44, 0x43], addH, addL); // "DC" — move to pickup location (eject)
}

export function buildFC0Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x30], addH, addL); // "FC0" — drop from bayonet
}

export function buildFD0Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x44, 0x30], addH, addL); // "FD0" — enable front auto-sense entry
}

export function buildFD1Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x44, 0x31], addH, addL); // "FD1" — disable front auto-sense entry
}

export function buildDBPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x44, 0x42], addH, addL); // "DB"
}

export function buildRSPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x52, 0x53], addH, addL); // "RS"
}

export function buildGVPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x47, 0x56], addH, addL); // "GV"
}

// ---------------------------------------------------------------------------
// Commands taken from the vendor Android SDK (k7x0_dll.jar / ttce_dll.jar).
// They are not in the protocol PDF, but the SDK is the authority on the wire:
//   K7X0_CheckCardPosition  → CM='F' PM='C' data='1'  → "FC1"
//   K7X0_CheckSensorStatus  → CM='F' PM='C' data='2'  → "FC2"
//   K7X0_CheckSetting       → CM='F' PM='R'           → "FR"
//
// buildCheckSettingPacket() used to send the literal ASCII string "CheckSetting"
// as the payload, which is not a command at all — the device answered NAK.
// ---------------------------------------------------------------------------

/** FC1 — card position / device state, already decoded by the firmware. */
export function buildFC1Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x31], addH, addL);
}

/** FR — parameter settings (front-entry mode, reset behaviour). */
export function buildFRPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x52], addH, addL);
}

// CP — Recycle card to recycling box
export function buildCPPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x43, 0x50], addH, addL);
}

// FC0 — Dispense card out of card mouth (drop from bayonet)
// (already exists as buildFC0Packet)

// FC4 — Move to hold card position (requires force to pull out)
export function buildFC4Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x34], addH, addL);
}

// FC6 — Move to sensor 2 position
export function buildFC6Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x36], addH, addL);
}

// FC7 — Move to card reading position (already exists)

// FC8 — Enter card to read position from front-side
export function buildFC8Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x38], addH, addL);
}

// FD0 — Front-end auto-sense card entry (already exists)

// FD1 — Front-end manual entry via BF/FC8 (already exists)

// FD2 — Reset without action (channel card stays)
export function buildFD2Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x44, 0x32], addH, addL);
}

// FD3 — Reset, return channel card to issuing box
export function buildFD3Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x44, 0x33], addH, addL);
}

// FD4 — Reset, return channel card to recycling box
export function buildFD4Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x44, 0x34], addH, addL);
}

// BE — Buffer enable (buzzer on)
export function buildBEPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x42, 0x45], addH, addL);
}

// BD — Buffer disable (buzzer off)
export function buildBDPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x42, 0x44], addH, addL);
}

// --- Response parsing ---

/** Parse one AP status nibble from an ASCII hex character byte (0x30–0x39, 0x41–0x46). */
function parseAPStatusNibble(byte: number): number {
  const ch = String.fromCharCode(byte);
  if (/^[0-9A-Fa-f]$/.test(ch)) return parseInt(ch, 16);
  return byte & 0x0f;
}

/** Parse 4 AP status bytes (ASCII hex chars) into StatusBytes per vendor protocol. */
function parseAPStatusBytes(raw: number[]): StatusBytes {
  const b0 = raw[0] ?? 0;
  const b1 = raw[1] ?? 0;
  const b2 = raw[2] ?? 0;
  const b3 = raw[3] ?? 0;
  return {
    byte1: parseAPStatusNibble(b0),
    byte2: parseAPStatusNibble(b1),
    byte3: parseAPStatusNibble(b2),
    byte4: parseAPStatusNibble(b3),
  };
}

/**
 * Extract status bytes from an AP/RF response packet.
 * AP payload: "SF" + 4 status bytes (RELEN=6).
 * RF payload: "SF" + 3 status bytes (RELEN=5) — the channel byte is absent, so
 * it is reported as 0 rather than rejecting the frame.
 */
export function parseAPStatusFromResponse(response: number[]): StatusBytes | null {
  if (response.length < 7 || response[0] !== STX) return null;
  const len = (response[3] << 8) | response[4];
  if (len < 3) return null;

  let dataStart = 5;
  if (response[5] === 0x53 && response[6] === 0x46) {
    dataStart = 7; // skip the "SF" marker
  }

  // Never read past the payload — trailing ETX/BCC bytes are not status.
  const payloadEnd = Math.min(5 + len, response.length);
  const statusRaw = response.slice(dataStart, Math.min(dataStart + 4, payloadEnd));
  if (statusRaw.length < 3) return null;
  return parseAPStatusBytes(statusRaw);
}

export function getStatusFlags(status: StatusBytes): StatusFlags {
  return {
    // B1 — Machine status
    recycleBoxFull: !!(status.byte1 & 0x08),
    commandCannotExecute: !!(status.byte1 & 0x04),
    cardPrepareFailed: !!(status.byte1 & 0x02),
    cardHopperPreFull: !!(status.byte1 & 0x01),
    // B2 — Machine action status
    cardIssuing: !!(status.byte2 & 0x08),
    cardCollecting: !!(status.byte2 & 0x04),
    issueError: !!(status.byte2 & 0x02),
    collectError: !!(status.byte2 & 0x01),
    // B3 — Card box status
    cardHopperFull: !!(status.byte3 & 0x08),
    cardOverlap: !!(status.byte3 & 0x04),
    cardJam: !!(status.byte3 & 0x02),
    cardPreEmpty: !!(status.byte3 & 0x01),
    // B4 — Channel status
    boxEmpty: !!(status.byte4 & 0x08),
    cardAtSensor3: !!(status.byte4 & 0x04),
    cardAtSensor2: !!(status.byte4 & 0x02),
    cardAtSensor1: !!(status.byte4 & 0x01),
  };
}

// --- FC1 (card position) ---

type CardPosition =
  | "OVERLAP" | "JAM" | "AT_READER" | "NO_CARD" | "AT_FRONT" | "UNKNOWN";

export interface DevicePosition {
  /** Raw four decoded bytes as returned by the firmware. */
  raw: number[];
  device: "IDLE" | "FAULT" | "PREPARE_FAILED" | "ISSUING" | "COLLECTING" | "ISSUE_ERROR" | "COLLECT_ERROR" | "UNKNOWN";
  transport: CardPosition;
  cardBox: "EMPTY" | "PRE_EMPTY" | "OK" | "PRE_FULL" | "FULL" | "UNKNOWN";
  retainBox: "NOT_FULL" | "FULL" | "UNKNOWN";
}

const DEVICE_STATE: Record<number, DevicePosition["device"]> = {
  0x30: "IDLE", 0x31: "FAULT", 0x32: "PREPARE_FAILED", 0x33: "ISSUING",
  0x34: "COLLECTING", 0x35: "ISSUE_ERROR", 0x36: "COLLECT_ERROR",
};
const TRANSPORT_STATE: Record<number, CardPosition> = {
  0x30: "OVERLAP", 0x31: "JAM", 0x32: "AT_READER", 0x33: "NO_CARD", 0x34: "AT_FRONT",
};
const CARDBOX_STATE: Record<number, DevicePosition["cardBox"]> = {
  0x30: "EMPTY", 0x31: "PRE_EMPTY", 0x32: "OK", 0x33: "PRE_FULL", 0x34: "FULL",
};
const RETAINBOX_STATE: Record<number, DevicePosition["retainBox"]> = {
  0x30: "NOT_FULL", 0x31: "FULL",
};

/**
 * Parse an FC1 response.
 *
 * Frame: STX ADDH ADDL LENH LENL 'P' 'F' 'C' '1' D0 D1 D2 D3 ETX BCC
 * The vendor SDK copies the payload from frame offset 9 for any FC* command
 * (it skips 'P' + CM + PM + the echoed sub-command byte), which is where these
 * four decoded status bytes live.
 */
export function parseFC1Response(response: number[]): DevicePosition | null {
  if (response.length < 11 || response[0] !== STX) return null;
  const len = (response[3] << 8) | response[4];
  const payloadEnd = Math.min(5 + len, response.length);
  const data = response.slice(9, Math.min(13, payloadEnd));
  if (data.length < 4) return null;
  return {
    raw: data,
    device: DEVICE_STATE[data[0]] ?? "UNKNOWN",
    transport: TRANSPORT_STATE[data[1]] ?? "UNKNOWN",
    cardBox: CARDBOX_STATE[data[2]] ?? "UNKNOWN",
    retainBox: RETAINBOX_STATE[data[3]] ?? "UNKNOWN",
  };
}

/**
 * Parse an FR (CheckSetting) response into the two documented settings bytes.
 * Frame: STX ADDH ADDL LENH LENL 'F' 'R' S0 S1 ETX BCC — the SDK reads the
 * payload from offset 7 for FR (no 'P' prefix, same shape as the AP "SF" reply).
 */
export function parseFRResponse(response: number[]): { frontEntry: string; resetAction: string; raw: number[] } | null {
  if (response.length < 9 || response[0] !== STX) return null;
  const len = (response[3] << 8) | response[4];
  const payloadEnd = Math.min(5 + len, response.length);
  const data = response.slice(7, payloadEnd);
  if (data.length < 2) return null;
  const frontEntry =
    data[0] === 0x01 ? "Front entry requires BF/FC8"
    : data[0] === 0x02 ? "Front entry auto-sensing"
    : `Unknown (0x${data[0].toString(16).padStart(2, "0")})`;
  const resetAction =
    data[1] === 0x01 ? "Reset: no action"
    : data[1] === 0x02 ? "Reset: channel card → issuing box"
    : data[1] === 0x03 ? "Reset: channel card → recycle box"
    : `Unknown (0x${data[1].toString(16).padStart(2, "0")})`;
  return { frontEntry, resetAction, raw: data };
}

function decodeErrorCode(code: number): string {
  const map: Record<number, string> = {
    0x00: "Undefined command",
    0x01: "Parameter error",
    0x02: "Data error",
    0x03: "Not executable",
    0x04: "Execution failed",
    0xC7: "Dispense failed (card pick/sensor issue)",
  };
  return map[code] ?? `Unknown error (0x${code.toString(16).padStart(2, "0")})`;
}

/**
 * Parse an error frame: STX ADDH ADDL LENH LENL 'N' CM PM ERR_CD ETX BCC.
 *
 * Two bugs fixed against the vendor SDK, which does `if (recv[5] != 'P')
 * return recv[8]`:
 *   - the old code only matched frames whose CM was 'F' (it tested for the
 *     literal bytes "NF"), so an error on AP/GV/S50/… was reported as "no error";
 *   - it read the code from frame offset 7 (that is PM) instead of offset 8.
 */
export function parseNFResponse(response: number[]): { isNF: boolean; errorCode: number; errorName: string } | null {
  if (response.length < 7 || response[0] !== STX) return null;
  const len = (response[3] << 8) | response[4];
  if (len < 4) return null;
  const payload = response.slice(5, 5 + len);
  if (payload.length < 4 || payload[0] !== 0x4e) return null; // 'N'
  const code = payload[3] ?? 0;
  return { isNF: true, errorCode: code, errorName: decodeErrorCode(code) };
}

export function bytesToHex(data: Uint8Array | number[]): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
