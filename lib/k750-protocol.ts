export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
export const ENQ = 0x05;

export const DEFAULT_ADDH = 0x30;
export const DEFAULT_ADDL = 0x30;

export interface CardMapping {
  employeeId: string;
  name: string;
  department: string;
  issuedAt: string;
}

export interface StatusBytes {
  byte1: number;
  byte2: number;
  byte3: number;
  byte4: number;
}

export interface StatusFlags {
  commandCannotExecute: boolean;
  issueError: boolean;
  collectError: boolean;
  cardOverlap: boolean;
  cardJam: boolean;
  boxEmpty: boolean;
  cardAtSensor3: boolean;
  cardAtSensor2: boolean;
  cardAtSensor1: boolean;
}

export function computeBCC(data: number[]): number {
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
export function buildPacket(
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

// Movement commands
export function buildAPPacket(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x41, 0x50], addH, addL); // "AP"
}

export function buildFC7Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x37], addH, addL); // "FC7"
}

export function buildFC0Packet(addH = DEFAULT_ADDH, addL = DEFAULT_ADDL): Uint8Array {
  return buildPacket([0x46, 0x43, 0x30], addH, addL); // "FC0"
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

// --- Response parsing ---

export function getStatusFlags(status: StatusBytes): StatusFlags {
  return {
    commandCannotExecute: !!(status.byte1 & 0x04),
    issueError: !!(status.byte2 & 0x02),
    collectError: !!(status.byte2 & 0x01),
    cardOverlap: !!(status.byte3 & 0x04),
    cardJam: !!(status.byte3 & 0x02),
    boxEmpty: !!(status.byte4 & 0x08),
    cardAtSensor3: !!(status.byte4 & 0x04),
    cardAtSensor2: !!(status.byte4 & 0x02),
    cardAtSensor1: !!(status.byte4 & 0x01),
  };
}

export function decodeErrorCode(code: number): string {
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

export function parseNFResponse(response: number[]): { isNF: boolean; errorCode: number; errorName: string } | null {
  if (response.length < 7 || response[0] !== STX) return null;
  const len = (response[3] << 8) | response[4];
  if (len < 4) return null;
  const payload = response.slice(5, 5 + len);
  if (payload.length < 2 || payload[0] !== 0x4e || payload[1] !== 0x46) return null;
  const code = payload[2] ?? 0;
  return { isNF: true, errorCode: code, errorName: decodeErrorCode(code) };
}

export function bytesToHex(data: Uint8Array | number[]): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
