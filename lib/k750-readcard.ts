import type { K750Connection, LogEntry, NfcChipType } from "./k750-connection";

/**
 * Read Card — diagnostic POC.
 *
 * Deliberately isolated from DispenseService and CollectService: it shares the
 * one K750Connection (and therefore its transaction lock) but owns no state
 * they read, writes nothing to Firestore, and never ejects the card. Deleting
 * this file and its UI section removes the feature completely.
 */

export type ReadCardErrorCode =
  | "NOT_CONNECTED"
  | "DEVICE_BUSY"
  | "NO_RESPONSE"
  | "BOX_EMPTY"
  | "CARD_JAM"
  | "CARD_OVERLAP"
  | "FC7_TIMEOUT"
  | "NO_CARD_AT_READER"
  | "NO_CHIP_DETECTED"
  | "READER_NO_RESPONSE"
  | "UNKNOWN_ERROR";

export interface ReadCardResult {
  success: boolean;
  message: string;
  errorCode?: ReadCardErrorCode;
  /** Which vendor chip family answered. */
  cardType?: NfcChipType;
  /** Uppercase hex, no separators. */
  uid?: string;
  uidBytes?: number[];
  /** "OK" on success, otherwise the error code — the POC's return code. */
  returnCode: string;
  /** Whether FC7 was sent, or the card was already at the reader. */
  movedWithFC7: boolean;
  /** Every TX/RX/INFO line produced by this operation only. */
  log: LogEntry[];
}

export type ReadCardProgress = (step: number, total: number, message: string) => void;

export const READ_CARD_STEP_LABELS = [
  "Check machine",
  "Move to reader",
  "Wait at reader",
  "Read card",
] as const;

const STEPS = READ_CARD_STEP_LABELS.length;

export class ReadCardService {
  private _busy = false;
  get isBusy() { return this._busy; }

  constructor(private conn: K750Connection) {}

  /**
   * Move a card to the read position if it is not already there, then read it.
   *
   * The card is left at the reader on purpose — nothing here ejects, recycles
   * or returns it, so a diagnostic run cannot lose a card. Use the existing
   * Machine Commands buttons (FC0 / DC / CP / DB) to clear the channel.
   */
  async readCard(onStep?: ReadCardProgress): Promise<ReadCardResult> {
    const log: LogEntry[] = [];
    const unsubscribe = this.conn.addLogListener((entry) => { log.push(entry); });

    const fail = (
      message: string,
      errorCode: ReadCardErrorCode,
      movedWithFC7: boolean
    ): ReadCardResult => ({ success: false, message, errorCode, returnCode: errorCode, movedWithFC7, log });

    const step = (n: number, msg: string) => {
      onStep?.(n, STEPS, msg);
      this.conn.log("INFO", [], `[READ CARD] ${msg}`);
    };

    let movedWithFC7 = false;
    try {
      if (!this.conn.isConnected) {
        return fail("Device not connected.", "NOT_CONNECTED", false);
      }
      if (this._busy || this.conn.isFlowBusy) {
        return fail("Device busy — another operation is running.", "DEVICE_BUSY", false);
      }
      this._busy = true;
      this.conn.log("INFO", [], "=== Read Card (diagnostic) ===");

      // 1. Machine state
      step(1, "Checking machine...");
      const pre = await this.conn.queryAP();
      if (!pre) return fail("No response from device.", "NO_RESPONSE", false);
      if (pre.flags.cardJam) return fail("Card jam — press RS.", "CARD_JAM", false);
      if (pre.flags.cardOverlap) return fail("Card overlap — press RS.", "CARD_OVERLAP", false);

      // 2. FC7 only when the channel has no card at the reader already. A card
      //    sitting at S3 is read where it is rather than being disturbed.
      if (pre.flags.cardAtSensor3) {
        step(2, "Card already at reader — skipping FC7.");
      } else {
        if (pre.flags.boxEmpty) {
          return fail("Card box is empty and no card is at the reader.", "BOX_EMPTY", false);
        }
        step(2, "Moving card to reader (FC7)...");
        movedWithFC7 = true;
        if (!(await this.conn.dispenseFC7())) {
          return fail("FC7 failed — card did not reach the reader.", "FC7_TIMEOUT", true);
        }
      }

      // 3 + 4. readNfcCard waits for the transport to settle, then probes every
      //        family the vendor API supports: S50, S70, UL, ISO15693, TypeA.
      step(3, "Waiting for card at reader...");
      step(4, "Reading card...");
      const nfc = await this.conn.readNfcCard({ requireCardAtReader: true });

      if (nfc.success && nfc.uid) {
        this.conn.log("INFO", [], `[READ CARD] OK — ${nfc.chipType} ${nfc.uid}`);
        return {
          success: true,
          message: `${nfc.chipType} card read — UID ${nfc.uid}`,
          cardType: nfc.chipType,
          uid: nfc.uid,
          uidBytes: nfc.uidBytes,
          returnCode: "OK",
          movedWithFC7,
          log,
        };
      }

      const code: ReadCardErrorCode = nfc.message.includes("reader did not respond")
        ? "READER_NO_RESPONSE"
        : nfc.message.includes("No card at the reader")
        ? "NO_CARD_AT_READER"
        : "NO_CHIP_DETECTED";
      return fail(nfc.message, code, movedWithFC7);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.conn.log("INFO", [], `[READ CARD] FAILED: ${msg}`);
      return fail(`Error: ${msg}`, "UNKNOWN_ERROR", movedWithFC7);
    } finally {
      this._busy = false;
      unsubscribe();
    }
  }
}
