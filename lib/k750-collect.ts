import type { K750Connection, DeviceStatus } from "./k750-connection";

export type ErrorCode =
  | "NOT_CONNECTED"
  | "DEVICE_BUSY"
  | "NAK_RECEIVED"
  | "CARD_JAM"
  | "CARD_OVERLAP"
  | "COLLECT_ERROR"
  | "FC7_TIMEOUT"
  | "FRONT_ENTRY_TIMEOUT"
  | "UNKNOWN_ERROR";

export interface CollectResult {
  success: boolean;
  message: string;
  errorCode?: ErrorCode;
  status?: DeviceStatus;
  /** Non-fatal problem to surface alongside a successful collect. */
  warning?: string;
}

export type FlowProgress = (step: number, total: number, message: string) => void;

export const CHECKOUT_STEP_LABELS = [
  "Enable entry",
  "Insert card",
  "Move to reader",
  "Recycle",
  "Disable entry",
  "Idle",
] as const;

const CHECKOUT_STEPS = CHECKOUT_STEP_LABELS.length;
const FRONT_ENTRY_TIMEOUT = 30000;

export class CollectService {
  private _flowBusy = false;
  get isFlowBusy() { return this._flowBusy; }

  constructor(private conn: K750Connection) {}

  async visitorCheckout(onStep?: FlowProgress): Promise<CollectResult> {
    if (!this.conn.isConnected) return { success: false, message: "Device not connected.", errorCode: "NOT_CONNECTED" };
    if (this._flowBusy) return { success: false, message: "Device busy.", errorCode: "DEVICE_BUSY" };

    this._flowBusy = true;
    let fd0Enabled = false;
    const step = (n: number, msg: string) => {
      onStep?.(n, CHECKOUT_STEPS, msg);
      this.conn.log("INFO", [], `Collect ${n}/${CHECKOUT_STEPS}: ${msg}`);
    };

    try {
      this.conn.log("INFO", [], "=== Collect flow ===");

      // Step 1: FD0 — enable front auto-sense entry
      step(1, "Enabling card entry...");
      if (!(await this.conn.sendCmdList2((await import("./k750-protocol")).buildFD0Packet()))) {
        return { success: false, message: "FD0 command failed.", errorCode: "NAK_RECEIVED" };
      }
      fd0Enabled = true;
      await this.conn.delay(300);

      // Step 2: Poll for front entry (30s)
      step(2, "Please insert the card...");
      let cardAtFront = false;
      const t1 = Date.now();
      while (Date.now() - t1 < FRONT_ENTRY_TIMEOUT) {
        await this.conn.delay(300);
        const st = await this.conn.queryAP();
        if (!st) continue;
        if (st.flags.cardJam) return { success: false, message: "Card jam detected.", errorCode: "CARD_JAM" };
        if (st.flags.cardOverlap) return { success: false, message: "Card overlap detected.", errorCode: "CARD_OVERLAP" };
        if (st.flags.collectError) return { success: false, message: "Collection error.", errorCode: "COLLECT_ERROR" };
        if (st.raw.byte4 & 0x07) {
          this.conn.log("INFO", [], "Card detected at front entry");
          cardAtFront = true;
          break;
        }
      }
      if (!cardAtFront) {
        return { success: false, message: "Front entry timeout — no card inserted.", errorCode: "FRONT_ENTRY_TIMEOUT" };
      }

      // Step 3: FC7 — move card to reader position
      step(3, "Moving card to reader...");
      if (!(await this.conn.dispenseFC7())) {
        return { success: false, message: "FC7 failed.", errorCode: "FC7_TIMEOUT" };
      }

      // Step 4: CP — recycle to recycling box
      step(4, "Recycling card...");
      if (!(await this.conn.recycleCP())) {
        return { success: false, message: "CP command failed.", errorCode: "NAK_RECEIVED" };
      }

      // Wait for card to clear channel
      const t3 = Date.now();
      while (Date.now() - t3 < 8000) {
        await this.conn.delay(300);
        const st = await this.conn.queryAP();
        if (st && (st.raw.byte4 & 0x07) === 0) {
          this.conn.log("INFO", [], "Card recycled to box");
          break;
        }
      }

      // Step 5: FD1 — disable front auto-sensing
      step(5, "Disabling card entry...");
      await this.conn.disableFrontAutoSense();

      this.conn.log("INFO", [], "=== COLLECT SUCCESS ===");
      return { success: true, message: "Card returned successfully." };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.conn.log("INFO", [], `Collect FAILED: ${msg}`);
      return { success: false, message: `Error: ${msg}`, errorCode: "UNKNOWN_ERROR" };
    } finally {
      this._flowBusy = false;
      if (fd0Enabled) {
        await this.conn.disableFrontAutoSense().catch(() => {});
      }
    }
  }
}
