import type { K750Connection, DeviceStatus } from "./k750-connection";

export type ErrorCode =
  | "NOT_CONNECTED"
  | "BOX_EMPTY"
  | "CARD_JAM"
  | "CARD_OVERLAP"
  | "CARD_IN_CHANNEL"
  | "ISSUE_ERROR"
  | "EJECT_TIMEOUT"
  | "FC7_TIMEOUT"
  | "NO_RESPONSE"
  | "NAK_RECEIVED"
  | "DEVICE_BUSY"
  | "COLLECT_ERROR"
  | "COMMAND_REJECTED"
  | "UNKNOWN_ERROR";

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

const ISSUE_STEPS = ISSUE_STEP_LABELS.length;

export class DispenseService {
  private _flowBusy = false;
  get isFlowBusy() { return this._flowBusy; }

  constructor(private conn: K750Connection) {}

  async issueCard(employeeId: string, name: string, department: string, onStep?: FlowProgress): Promise<IssueResult> {
    if (!this.conn.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    if (this._flowBusy) return { success: false, message: "Device busy.", errorCode: "DEVICE_BUSY" };

    this._flowBusy = true;
    const step = (n: number, msg: string) => {
      onStep?.(n, ISSUE_STEPS, msg);
      this.conn.log("INFO", [], `[DISPENSE] ${msg}`);
    };

    try {
      this.conn.log("INFO", [], "=== Dispense flow ===");

      // Pre-check
      step(1, "Checking machine...");
      const pre = await this.conn.queryAP();
      if (!pre) return { success: false, message: "No response from device.", errorCode: "NO_RESPONSE" };
      const { flags } = pre;
      if (flags.boxEmpty) return { success: false, message: "Card box is empty.", errorCode: "BOX_EMPTY" };
      if (flags.cardJam) return { success: false, message: "Card jam — press RS.", errorCode: "CARD_JAM" };
      if (flags.cardOverlap) return { success: false, message: "Card overlap — press RS.", errorCode: "CARD_OVERLAP" };
      if (flags.issueError) return { success: false, message: "Issue error — press RS.", errorCode: "ISSUE_ERROR" };
      if (flags.collectError) return { success: false, message: "Collect error — press RS.", errorCode: "COLLECT_ERROR" };
      if (flags.commandCannotExecute) return { success: false, message: "Command cannot execute.", errorCode: "COMMAND_REJECTED" };

      // Auto-eject if card stuck in channel
      if (pre.raw.byte4 & 0x07) {
        this.conn.log("INFO", [], "Card in channel — auto ejecting...");
        step(1, "Clearing channel...");
        if (!(await this.conn.ejectFC0())) {
          return { success: false, message: "Card stuck — eject failed. Press RS.", errorCode: "CARD_IN_CHANNEL" };
        }
        await this.conn.delay(500);
      }

      // FC7 dispense to reader
      step(2, "Dispensing card...");
      if (!(await this.conn.dispenseFC7())) {
        return { success: false, message: "Dispense failed — card did not reach reader.", errorCode: "FC7_TIMEOUT" };
      }

      // FC0 eject out of mouth
      step(3, "Delivering card...");
      if (!(await this.conn.ejectFC0())) {
        return { success: false, message: "Card not ejected — timeout.", errorCode: "EJECT_TIMEOUT" };
      }

      this.conn.log("INFO", [], "=== DISPENSE SUCCESS ===");
      return { success: true, message: `Card issued for ${name} (${employeeId} — ${department}) — please collect the card.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.conn.log("INFO", [], `[DISPENSE] FAILED: ${msg}`);
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    } finally {
      this._flowBusy = false;
    }
  }
}
