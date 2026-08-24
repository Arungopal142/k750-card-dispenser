"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { useK750, getK750Conn, getK750Dispense, getK750Collect } from "../../../lib/k750-context";
import { ISSUE_STEP_LABELS } from "../../../lib/k750-dispense";
import { CHECKOUT_STEP_LABELS } from "../../../lib/k750-collect";
import type { LogEntry } from "../../../lib/k750-connection";
import { subscribeAllCardIssues, logCardIssue, updateCardIssue, logActivity, type CardIssue, formatDateTime } from "../../../lib/firestore-service";
import { Loader2, RefreshCw, Wifi, WifiOff, CheckCircle2, XCircle, Info, ArrowDownFromLine, Hand, Terminal, CreditCard, CreditCard as CardIcon } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

function Toast({ message, type, onClose }: { message: string; type: ToastType; onClose: () => void }) {
  const icons = { success: <CheckCircle2 className="w-4 h-4 text-green-500" />, error: <XCircle className="w-4 h-4 text-red-500" />, info: <Info className="w-4 h-4 text-blue-500" />, warning: <Info className="w-4 h-4 text-amber-500" /> };
  const bg = { success: "bg-green-50 border-green-200", error: "bg-red-50 border-red-200", info: "bg-blue-50 border-blue-200", warning: "bg-amber-50 border-amber-200" };
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg ${bg[type]}`} style={{ animation: "slideIn 0.3s ease" }}>
      {icons[type]}
      <span className="text-sm font-medium text-gray-800">{message}</span>
      <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600">✕</button>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: "green" | "yellow" | "red" | "gray" }) {
  const styles = {
    green: "bg-green-50 text-green-700 border-green-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[13px] font-mono ${styles[color]}`}>
      {label}
    </span>
  );
}

function SensorDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`h-4 w-4 rounded-full border-2 transition-colors ${
          active
            ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
            : "bg-gray-200 border-gray-300"
        }`}
      />
      <span className="text-[11px] font-mono text-gray-500">{label}</span>
    </div>
  );
}

export default function DevicePage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { conn, dispense, collect, connState, status, nfc, connect, disconnect } = useK750();
  const [firmware, setFirmware] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [collectStep, setCollectStep] = useState(0);
  const [collectStepMsg, setCollectStepMsg] = useState("");
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [commLog, setCommLog] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // --- Issue Card state ---
  const [issueEmpId, setIssueEmpId] = useState("");
  const [issueEmpName, setIssueEmpName] = useState("");
  const [issueEmpDept, setIssueEmpDept] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueStep, setIssueStep] = useState(0);
  const [issueStepMsg, setIssueStepMsg] = useState("");
  const [issueResult, setIssueResult] = useState<{ success: boolean; message: string } | null>(null);
  const [nfcResult, setNfcResult] = useState<{ label: string; value: string } | null>(null);

  // --- Issue Log ---
  const [issueLog, setIssueLog] = useState<CardIssue[]>([]);

  const showToast = (message: string, type: ToastType = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    const svc = getK750Conn();
    const handler = (entry: LogEntry) => {
      setCommLog((prev) => {
        const next = [...prev, entry];
        return next.length > 100 ? next.slice(-100) : next;
      });
    };
    svc.onLog = handler;
    return () => { svc.onLog = undefined; };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commLog]);

  const downloadLog = () => {
    const lines = commLog.map((e) => {
      const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${time} ${e.direction} ${e.hex}${e.text ? " — " + e.text : ""}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `k750-device-log-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Live issue log subscription
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAllCardIssues(
      (issues) => setIssueLog(issues.slice(0, 20)),
      (err) => console.error("Issue log error:", err)
    );
    return unsub;
  }, [user]);

  const handleConnect = async () => {
    setConnecting(true);
    try { await connect(); showToast("Device connected", "success"); } catch { showToast("Connection failed", "error"); }
    setConnecting(false);
  };
  const handleDisconnect = async () => {
    setConnecting(true);
    await disconnect();
    setConnecting(false);
    showToast("Device disconnected", "info");
  };
  const handleRefresh = async () => {
    setActionLoading("refresh");
    const st = await conn.queryAP();
    setActionLoading(null);
    if (st) showToast("Status refreshed", "success");
    else showToast("No response from device", "error");
  };
  const handleGetVersion = async () => {
    setActionLoading("version");
    const v = await conn.getVersion();
    setActionLoading(null);
    if (v) { setFirmware(v); showToast(`Firmware: ${v}`, "success"); }
    else showToast("Could not get version", "error");
  };
  const handleReset = async () => {
    setActionLoading("reset");
    showToast("Resetting device...", "info");
    const ok = await conn.resetDevice();
    await conn.queryAP();
    setActionLoading(null);
    showToast(ok ? "Device reset successful" : "Reset failed", ok ? "success" : "error");
  };
  const handleEject = async () => {
    setActionLoading("eject");
    showToast("Ejecting card...", "info");

    // Attempt 1: Direct DC eject
    let ejected = await conn.ejectDC();
    if (ejected) {
      await conn.queryAP();
      setActionLoading(null);
      showToast("Card ejected", "success");
      return;
    }

    // Attempt 2: RS reset → retry DC
    showToast("Eject stuck — resetting device...", "info");
    await conn.resetDevice();
    await new Promise((r) => setTimeout(r, 3000));
    await conn.queryAP();

    showToast("Retrying eject...", "info");
    ejected = await conn.ejectDC();
    await conn.queryAP();
    setActionLoading(null);
    showToast(ejected ? "Card ejected after reset" : "Eject failed — card may be jammed. Remove manually.", ejected ? "success" : "error");
  };
  const handleCollectCard = async () => {
    if (actionLoading === "collect") return;
    setActionLoading("collect");
    setCollectStep(0);
    setCollectStepMsg("");
    try {
      const res = await collect.visitorCheckout((step, _total, msg) => { setCollectStep(step); setCollectStepMsg(msg); });
      if (res?.success) {
        showToast(res.message, "success");
        if (res.warning) showToast(res.warning, "warning");
      } else {
        showToast(res?.message || "Collect failed", "error");
      }
    } catch { showToast("Collect error", "error"); }
    setActionLoading(null);
    setCollectStep(0);
    setCollectStepMsg("");
  };

  const handleIssueCard = async () => {
    if (!issueEmpId.trim() || !issueEmpName.trim() || !issueEmpDept.trim()) {
      showToast("Fill in all fields", "error");
      return;
    }
    if (connState !== "connected") { showToast("Connect to device first", "error"); return; }
    setIssuing(true);
    setIssueResult(null);
    setIssueStep(0);
    setIssueStepMsg("");

    let cardIssueId: string | null = null;
    try {
      cardIssueId = await logCardIssue({
        employeeId: issueEmpId.trim(),
        employeeName: issueEmpName.trim(),
        department: issueEmpDept.trim(),
        issuedBy: profile?.displayName || profile?.email || "Admin",
        issuedById: user?.uid ?? "",
        status: "Processing",
        source: "K750",
      });
    } catch { /* */ }

    try {
      const res = await dispense.issueCard(
        issueEmpId.trim(),
        issueEmpName.trim(),
        issueEmpDept.trim(),
        (step, _total, msg) => { setIssueStep(step); setIssueStepMsg(msg); }
      );
      if (res) {
        setIssueResult({ success: res.success, message: res.message });
        if (cardIssueId) {
          await updateCardIssue(cardIssueId, {
            status: res.success ? "Issued" : "Failed",
            ...(res.success ? {} : { errorMessage: res.message }),
          }).catch(() => {});
        }
        if (res.success) {
          await logActivity({ userId: user?.uid ?? "", userName: profile?.displayName || "Admin", action: "Card Issued", details: `${issueEmpName.trim()} - ${issueEmpDept.trim()} - Success` });
        }
        showToast(res.success ? "Card issued!" : res.message, res.success ? "success" : "error");
        if (res.success) {
          setTimeout(() => { setIssueEmpId(""); setIssueEmpName(""); setIssueEmpDept(""); setIssueResult(null); }, 3000);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIssueResult({ success: false, message: `Error: ${msg}` });
      showToast(`Error: ${msg}`, "error");
      if (cardIssueId) await updateCardIssue(cardIssueId, { status: "Failed", errorMessage: msg }).catch(() => {});
    }
    setIssuing(false);
  };
  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: "#f8fafc" }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: "#64748b" }}>
          <Loader2 className="animate-spin h-5 w-5" style={{ color: "#2563eb" }} />
          Loading...
        </div>
      </div>
    );
  }

  const s = status;
  const b1 = s?.raw.byte1 ?? 0;
  const b2 = s?.raw.byte2 ?? 0;
  const b3 = s?.raw.byte3 ?? 0;
  const b4 = s?.raw.byte4 ?? 0;

  const connectionDotColor =
    connState === "connected"
      ? "#16a34a"
      : connState === "connecting"
      ? "#d97706"
      : "#94a3b8";

  const connectionLabel =
    connState === "connected"
      ? "Connected"
      : connState === "connecting"
      ? "Connecting..."
      : connState === "error"
      ? "Error"
      : "Disconnected";

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh" }} className="p-4 md:p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div style={{ maxWidth: 1120, margin: "0 auto" }} className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/images/k750-product.jpg"
              alt="K750 Device"
              className="w-10 h-10 rounded-lg object-cover"
              style={{ border: "1px solid #e2e8f0" }}
            />
            <div>
              <div className="flex items-center gap-3">
                <h1 style={{ fontSize: 26, fontWeight: 700, color: "#0f172a" }}>
                  Device Status
                </h1>
                <span
                  className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-mono font-semibold"
                  style={{
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    border: "1px solid #bfdbfe",
                  }}
                >
                  K750-001
                </span>
              </div>
              <p style={{ fontSize: 14, color: "#64748b", marginTop: 2 }}>
                Real-time status and controls
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: connectionDotColor }}
            />
            <span
              style={{ fontSize: 13, fontWeight: 500, color: "#475569" }}
              className="capitalize"
            >
              {connectionLabel}
            </span>
            {connState === "connected" ? (
              <Wifi className="h-4 w-4" style={{ color: "#16a34a" }} />
            ) : (
              <WifiOff className="h-4 w-4" style={{ color: "#94a3b8" }} />
            )}
          </div>
        </div>

        {/* Grid: 2 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Left column: Connection + Device Info */}
          <div className="space-y-6">

            {/* Connection Card */}
            <div
              className="rounded-lg p-5 space-y-4"
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f172a",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Connection
              </h2>

              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: connectionDotColor }}
                />
                <span style={{ fontSize: 14, fontWeight: 500, color: "#0f172a" }}>
                  {connectionLabel}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {connState === "disconnected" || connState === "error" ? (
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    style={{
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      borderRadius: 8,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                    className="hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {connecting ? "Connecting..." : "Connect"}
                  </button>
                ) : (
                  <button
                    onClick={handleDisconnect}
                    disabled={connecting}
                    style={{
                      backgroundColor: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      color: "#475569",
                      borderRadius: 8,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                    className="hover:bg-gray-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {connecting ? "Disconnecting..." : "Disconnect"}
                  </button>
                )}
                <button
                  onClick={handleRefresh}
                  disabled={connState !== "connected"}
                  style={{
                    backgroundColor: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    color: "#475569",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: connState !== "connected" ? 0.4 : 1,
                  }}
                  className="hover:bg-gray-200 transition-colors flex items-center gap-1.5 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
                <button
                  onClick={handleGetVersion}
                  disabled={connState !== "connected"}
                  style={{
                    backgroundColor: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    color: "#475569",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: connState !== "connected" ? 0.4 : 1,
                  }}
                  className="hover:bg-gray-200 transition-colors disabled:cursor-not-allowed"
                >
                  Firmware
                </button>
                <button
                  onClick={handleReset}
                  disabled={connState !== "connected"}
                  style={{
                    backgroundColor: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    color: "#475569",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: connState !== "connected" ? 0.4 : 1,
                  }}
                  className="hover:bg-gray-200 transition-colors disabled:cursor-not-allowed"
                >
                  Reset
                </button>
                <button
                  onClick={handleCollectCard}
                  disabled={connState !== "connected" || actionLoading === "collect"}
                  style={{
                    backgroundColor: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    color: "#475569",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    opacity: connState !== "connected" ? 0.4 : 1,
                  }}
                  className="hover:bg-gray-200 transition-colors disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {actionLoading === "collect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hand className="w-3.5 h-3.5" />}
                  {actionLoading === "collect" ? "Collecting..." : "Collect Card"}
                </button>
              </div>

              {actionLoading === "collect" && (
                <div style={{ marginTop: 8 }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 11, color: "#64748b" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>{collectStep}/{CHECKOUT_STEP_LABELS.length}</span>
                    <span>{collectStepMsg}</span>
                  </div>
                  <div className="flex gap-1" style={{ marginTop: 6 }}>
                    {CHECKOUT_STEP_LABELS.map((label, i) => (
                      <div key={label} style={{ height: 4, flex: 1, borderRadius: 2, backgroundColor: i + 1 <= collectStep ? "#2563eb" : "#e2e8f0", transition: "background-color 0.3s" }} />
                    ))}
                  </div>
                </div>
              )}

              {firmware && (
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Firmware:{" "}
                  <span style={{ fontFamily: "monospace", color: "#0f172a" }}>
                    {firmware}
                  </span>
                </div>
              )}
            </div>

            {/* Device Info Card */}
            <div
              className="rounded-lg p-5 space-y-3"
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f172a",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Device Info
              </h2>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: 13, color: "#64748b" }}>Name</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", fontFamily: "monospace" }}>
                    K750-001
                  </span>
                </div>
                <div className="flex justify-between items-center" style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>Port</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", fontFamily: "monospace" }}>
                    COM3
                  </span>
                </div>
                <div className="flex justify-between items-center" style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>Baud Rate</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", fontFamily: "monospace" }}>
                    9600
                  </span>
                </div>
                <div className="flex justify-between items-center" style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>Protocol</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", fontFamily: "monospace" }}>
                    RS-232
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right column: Status Card */}
          <div
            className="rounded-lg p-5 space-y-5"
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Device Status
            </h2>

            {!s && (
              <p style={{ fontSize: 13, color: "#64748b" }}>
                No status data. Connect device first.
              </p>
            )}

            {s && (
              <div className="space-y-5">

                {/* Byte status grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                      }}
                    >
                      Channel (b4)
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {b4 & 0x08 ? (
                        <Badge label="Box EMPTY" color="red" />
                      ) : b4 & 0x04 ? (
                        <Badge label="At NFC reader (S3)" color="green" />
                      ) : (
                        <Badge label="Clear" color="green" />
                      )}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                      }}
                    >
                      Machine (b1)
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {b1 === 0 ? (
                        <Badge label="Idle" color="green" />
                      ) : b1 & 0x04 ? (
                        <Badge label="Cannot execute" color="red" />
                      ) : b1 & 0x02 ? (
                        <Badge label="Prep failed" color="red" />
                      ) : b1 & 0x08 ? (
                        <Badge label="Recycle full" color="yellow" />
                      ) : b1 & 0x01 ? (
                        <Badge label="Hopper pre-full" color="yellow" />
                      ) : (
                        <Badge label="Idle" color="green" />
                      )}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                      }}
                    >
                      Action (b2)
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {b2 === 0 ? (
                        <Badge label="Idle" color="green" />
                      ) : b2 & 0x02 ? (
                        <Badge label="Issue error" color="red" />
                      ) : b2 & 0x01 ? (
                        <Badge label="Collect error" color="red" />
                      ) : b2 & 0x04 ? (
                        <Badge label="Collecting" color="yellow" />
                      ) : b2 & 0x08 ? (
                        <Badge label="Sending" color="yellow" />
                      ) : (
                        <Badge label="Idle" color="green" />
                      )}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                      }}
                    >
                      Card Box (b3)
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {b3 === 0 ? (
                        <Badge label="OK" color="green" />
                      ) : b3 & 0x04 ? (
                        <Badge label="Overlap" color="red" />
                      ) : b3 & 0x02 ? (
                        <Badge label="Jam" color="red" />
                      ) : b3 & 0x08 ? (
                        <Badge label="Full" color="green" />
                      ) : b3 & 0x01 ? (
                        <Badge label="Pre-empty" color="yellow" />
                      ) : (
                        <Badge label="OK" color="green" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Sensor visualization */}
                <div
                  style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}
                >
                  <h4
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#64748b",
                      marginBottom: 12,
                    }}
                  >
                    Sensors
                  </h4>
                  <div
                    className="flex items-center justify-center gap-0 py-4 px-4"
                    style={{
                      backgroundColor: "#f1f5f9",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      className="mr-2"
                      style={{ fontSize: 9, fontFamily: "monospace", color: "#64748b" }}
                    >
                      Stack
                    </div>
                    <div
                      className="h-px w-3"
                      style={{ backgroundColor: "#cbd5e1" }}
                    />
                    <div
                      className="h-0 w-0"
                      style={{
                        borderTop: "3px solid transparent",
                        borderBottom: "3px solid transparent",
                        borderLeft: "5px solid #cbd5e1",
                      }}
                    />
                    <SensorDot label="S1" active={!!(b4 & 0x01)} />
                    <div
                      className="h-px w-3"
                      style={{ backgroundColor: "#cbd5e1" }}
                    />
                    <div
                      className="h-0 w-0"
                      style={{
                        borderTop: "3px solid transparent",
                        borderBottom: "3px solid transparent",
                        borderLeft: "5px solid #cbd5e1",
                      }}
                    />
                    <SensorDot label="S2" active={!!(b4 & 0x02)} />
                    <div
                      className="h-px w-3"
                      style={{ backgroundColor: "#cbd5e1" }}
                    />
                    <div
                      className="h-0 w-0"
                      style={{
                        borderTop: "3px solid transparent",
                        borderBottom: "3px solid transparent",
                        borderLeft: "5px solid #cbd5e1",
                      }}
                    />
                    <SensorDot label="S3 · NFC" active={!!(b4 & 0x04)} />
                    <div
                      className="h-px w-3"
                      style={{ backgroundColor: "#cbd5e1" }}
                    />
                    <div
                      className="h-0 w-0"
                      style={{
                        borderTop: "3px solid transparent",
                        borderBottom: "3px solid transparent",
                        borderLeft: "5px solid #cbd5e1",
                      }}
                    />
                    <div
                      className="ml-2"
                      style={{ fontSize: 9, fontFamily: "monospace", color: "#64748b" }}
                    >
                      Bay
                    </div>
                  </div>
                </div>

                {/* NFC reader */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                  <h4
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#64748b",
                      marginBottom: 12,
                    }}
                  >
                    NFC Reader (S3 position)
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontWeight: 600,
                        }}
                      >
                        NFC Reader
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {nfc.reader === "ready" ? (
                          <Badge label="Ready" color="green" />
                        ) : nfc.reader === "error" ? (
                          <Badge label="Error" color="red" />
                        ) : nfc.reader === "disconnected" ? (
                          <Badge label="Disconnected" color="gray" />
                        ) : (
                          <Badge label="Connected" color="green" />
                        )}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontWeight: 600,
                        }}
                      >
                        Card Status
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {nfc.card === "detected" ? (
                          <Badge label="Card Detected" color="green" />
                        ) : nfc.card === "unreadable" ? (
                          <Badge label="Unreadable" color="red" />
                        ) : nfc.card === "present" ? (
                          <Badge label="Reading..." color="yellow" />
                        ) : (
                          <Badge label="Waiting for Card" color="gray" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 600,
                      }}
                    >
                      Card UID
                    </div>
                    <div
                      className="mt-1.5"
                      style={{
                        backgroundColor: "#f1f5f9",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontFamily: "monospace",
                        fontSize: 13,
                        color: nfc.uid ? "#0f172a" : "#94a3b8",
                        wordBreak: "break-all",
                      }}
                    >
                      {nfc.uid ? `${nfc.uid}${nfc.chipType ? `  (${nfc.chipType})` : ""}` : "—"}
                    </div>
                  </div>

                  {nfc.message && (
                    <p style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
                      {nfc.message}
                    </p>
                  )}
                </div>

                {/* Raw Data */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: 600,
                      marginBottom: 8,
                    }}
                  >
                    Raw Data (HEX)
                  </div>
                  <div
                    style={{
                      backgroundColor: "#f1f5f9",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontFamily: "monospace",
                      fontSize: 13,
                      color: "#475569",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    {s.raw.byte1.toString(16).padStart(2, "0").toUpperCase()}{" "}
                    {s.raw.byte2.toString(16).padStart(2, "0").toUpperCase()}{" "}
                    {s.raw.byte3.toString(16).padStart(2, "0").toUpperCase()}{" "}
                    {s.raw.byte4.toString(16).padStart(2, "0").toUpperCase()}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Buttons */}
          <div
            className="flex flex-col sm:flex-row sm:flex-wrap gap-3"
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
          <button
            onClick={handleEject}
            disabled={connState !== "connected" || actionLoading === "eject"}
            style={{
              backgroundColor: actionLoading === "eject" ? "#fb923c" : "#f97316",
              color: "#ffffff",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:opacity-90 transition-opacity flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {actionLoading === "eject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownFromLine className="w-4 h-4" />}
            {actionLoading === "eject" ? "Ejecting..." : "Eject Card"}
          </button>
          <button
            onClick={handleRefresh}
            disabled={connState !== "connected" || actionLoading === "refresh"}
            style={{
              backgroundColor: actionLoading === "refresh" ? "#3b82f6" : "#2563eb",
              color: "#ffffff",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:opacity-90 transition-opacity flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {actionLoading === "refresh" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {actionLoading === "refresh" ? "Refreshing..." : "Refresh Status"}
          </button>
          <button
            onClick={handleGetVersion}
            disabled={connState !== "connected" || actionLoading === "version"}
            style={{
              backgroundColor: "#ffffff",
              color: "#0f172a",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid #cbd5e1",
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:bg-gray-50 transition-colors disabled:cursor-not-allowed flex items-center gap-2"
          >
            {actionLoading === "version" && <Loader2 className="w-4 h-4 animate-spin" />}
            {actionLoading === "version" ? "Getting..." : "Get Version"}
          </button>
          <button
            onClick={handleReset}
            disabled={connState !== "connected" || actionLoading === "reset"}
            style={{
              backgroundColor: "#ffffff",
              color: "#dc2626",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid #fecaca",
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:bg-red-50 transition-colors disabled:cursor-not-allowed flex items-center gap-2"
          >
            {actionLoading === "reset" && <Loader2 className="w-4 h-4 animate-spin text-red-500" />}
            {actionLoading === "reset" ? "Resetting..." : "Reset Device"}
          </button>
          <button
            onClick={handleCollectCard}
            disabled={connState !== "connected" || actionLoading === "collect"}
            style={{
              backgroundColor: actionLoading === "collect" ? "#f59e0b" : "#d97706",
              color: "#ffffff",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:opacity-90 transition-opacity flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {actionLoading === "collect" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hand className="w-4 h-4" />}
            {actionLoading === "collect" ? "Collecting..." : "Collect Card"}
          </button>
        </div>

        {actionLoading === "collect" && (
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div className="flex items-center gap-2" style={{ fontSize: 12, color: "#64748b" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>{collectStep}/{CHECKOUT_STEP_LABELS.length}</span>
              <span>{collectStepMsg}</span>
            </div>
            <div className="flex gap-1.5" style={{ marginTop: 8 }}>
              {CHECKOUT_STEP_LABELS.map((label, i) => (
                <div key={label} style={{ height: 5, flex: 1, borderRadius: 3, backgroundColor: i + 1 <= collectStep ? "#2563eb" : "#e2e8f0", transition: "background-color 0.3s" }} />
              ))}
            </div>
            <div className="flex justify-between" style={{ marginTop: 6 }}>
              {CHECKOUT_STEP_LABELS.map((label, idx) => (
                <span key={label} style={{ fontSize: 9, color: idx + 1 <= collectStep ? "#2563eb" : "#94a3b8", fontWeight: idx + 1 === collectStep ? 600 : 400 }}>{label}</span>
              ))}
            </div>
          </div>
        )}

        {/* ===== ISSUE CARD ===== */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
            <CreditCard className="w-4 h-4" style={{ color: "#2563eb" }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
              Issue Card
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Employee ID</label>
              <input
                value={issueEmpId}
                onChange={(e) => setIssueEmpId(e.target.value)}
                placeholder="e.g. EMP001"
                disabled={issuing}
                style={{
                  width: "100%", padding: "8px 12px", fontSize: 13, borderRadius: 6,
                  border: "1px solid #cbd5e1", outline: "none", fontFamily: "monospace",
                }}
                onFocus={(e) => e.target.style.borderColor = "#2563eb"}
                onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Name</label>
              <input
                value={issueEmpName}
                onChange={(e) => setIssueEmpName(e.target.value)}
                placeholder="e.g. John"
                disabled={issuing}
                style={{
                  width: "100%", padding: "8px 12px", fontSize: 13, borderRadius: 6,
                  border: "1px solid #cbd5e1", outline: "none",
                }}
                onFocus={(e) => e.target.style.borderColor = "#2563eb"}
                onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Department</label>
              <input
                value={issueEmpDept}
                onChange={(e) => setIssueEmpDept(e.target.value)}
                placeholder="e.g. IT"
                disabled={issuing}
                style={{
                  width: "100%", padding: "8px 12px", fontSize: 13, borderRadius: 6,
                  border: "1px solid #cbd5e1", outline: "none",
                }}
                onFocus={(e) => e.target.style.borderColor = "#2563eb"}
                onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
              />
            </div>
          </div>

          <button
            onClick={handleIssueCard}
            disabled={connState !== "connected" || issuing || !issueEmpId.trim() || !issueEmpName.trim() || !issueEmpDept.trim()}
            style={{
              backgroundColor: issuing ? "#3b82f6" : "#2563eb",
              color: "#ffffff",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              opacity: connState !== "connected" || !issueEmpId.trim() || !issueEmpName.trim() || !issueEmpDept.trim() ? 0.5 : 1,
            }}
            className="hover:opacity-90 transition-opacity flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {issuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {issuing ? "Issuing..." : "Issue Card"}
          </button>

          {issuing && (
            <div style={{ marginTop: 12 }}>
              <div className="flex items-center gap-2" style={{ fontSize: 11, color: "#64748b" }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>{issueStep}/{ISSUE_STEP_LABELS.length}</span>
                <span>{issueStepMsg}</span>
              </div>
              <div className="flex gap-1" style={{ marginTop: 6 }}>
                {ISSUE_STEP_LABELS.map((label, i) => (
                  <div key={label} style={{ height: 4, flex: 1, borderRadius: 2, backgroundColor: i + 1 <= issueStep ? "#2563eb" : "#e2e8f0", transition: "background-color 0.3s" }} />
                ))}
              </div>
              <div className="flex justify-between" style={{ marginTop: 4 }}>
                {ISSUE_STEP_LABELS.map((label, idx) => (
                  <span key={label} style={{ fontSize: 9, color: idx + 1 <= issueStep ? "#2563eb" : "#94a3b8", fontWeight: idx + 1 === issueStep ? 600 : 400 }}>{label}</span>
                ))}
              </div>
            </div>
          )}

          {issueResult && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              backgroundColor: issueResult.success ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${issueResult.success ? "#bbf7d0" : "#fecaca"}`,
              color: issueResult.success ? "#166534" : "#991b1b",
            }}>
              {issueResult.message}
            </div>
          )}
        </div>

        {/* ===== ISSUE LOG ===== */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
            <div className="flex items-center gap-2">
              <CardIcon className="w-4 h-4" style={{ color: "#64748b" }} />
              <h2 style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                Issue Log
              </h2>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
                ({issueLog.length})
              </span>
            </div>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {issueLog.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
                No card issues yet
              </div>
            ) : (
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11 }}>Time</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11 }}>Employee</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11 }}>Department</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11 }}>Issued By</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {issueLog.map((card) => (
                    <tr key={card.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#64748b", fontSize: 11 }}>{formatDateTime(card.issuedAt)}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500, color: "#0f172a" }}>{card.employeeName}</td>
                      <td style={{ padding: "8px 12px", color: "#475569" }}>{card.department}</td>
                      <td style={{ padding: "8px 12px", color: "#64748b" }}>{card.issuedBy}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                          backgroundColor: card.status === "Issued" ? "#dcfce7" : card.status === "Collected" ? "#dbeafe" : card.status === "Processing" ? "#fef3c7" : "#fee2e2",
                          color: card.status === "Issued" ? "#166534" : card.status === "Collected" ? "#1e40af" : card.status === "Processing" ? "#92400e" : "#991b1b",
                        }}>
                          {card.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ===== MACHINE COMMANDS (TESTING) ===== */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>
            Machine Commands (Testing)
          </h2>

          {/* Full Status Display */}
          {s && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Full Status (AP Response)
              </h3>
              <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Byte 1 — Machine Status */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                      Byte 1 — Machine
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      0x{s.raw.byte1.toString(16).padStart(2, "0").toUpperCase()}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {[
                        { bit: 0x08, label: "Recycle full" },
                        { bit: 0x04, label: "Cannot execute" },
                        { bit: 0x02, label: "Prep failed" },
                        { bit: 0x01, label: "Hopper pre-full" },
                      ].map(({ bit, label }) => (
                        <div key={bit} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: (s.raw.byte1 & bit) ? "#ef4444" : "#e2e8f0" }} />
                          <span style={{ fontFamily: "monospace", color: (s.raw.byte1 & bit) ? "#ef4444" : "#94a3b8" }}>
                            {bit.toString(2).padStart(4, "0")}
                          </span>
                          <span style={{ color: "#64748b" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Byte 2 — Action Status */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                      Byte 2 — Action
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      0x{s.raw.byte2.toString(16).padStart(2, "0").toUpperCase()}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {[
                        { bit: 0x08, label: "Sending" },
                        { bit: 0x04, label: "Collecting" },
                        { bit: 0x02, label: "Issue error" },
                        { bit: 0x01, label: "Collect error" },
                      ].map(({ bit, label }) => (
                        <div key={bit} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: (s.raw.byte2 & bit) ? "#ef4444" : "#e2e8f0" }} />
                          <span style={{ fontFamily: "monospace", color: (s.raw.byte2 & bit) ? "#ef4444" : "#94a3b8" }}>
                            {bit.toString(2).padStart(4, "0")}
                          </span>
                          <span style={{ color: "#64748b" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Byte 3 — Card Box */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                      Byte 3 — Card Box
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      0x{s.raw.byte3.toString(16).padStart(2, "0").toUpperCase()}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {[
                        { bit: 0x08, label: "Full (K750)" },
                        { bit: 0x04, label: "Overlap" },
                        { bit: 0x02, label: "Jam" },
                        { bit: 0x01, label: "Pre-empty" },
                      ].map(({ bit, label }) => (
                        <div key={bit} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: (s.raw.byte3 & bit) ? "#ef4444" : "#e2e8f0" }} />
                          <span style={{ fontFamily: "monospace", color: (s.raw.byte3 & bit) ? "#ef4444" : "#94a3b8" }}>
                            {bit.toString(2).padStart(4, "0")}
                          </span>
                          <span style={{ color: "#64748b" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Byte 4 — Channel/Sensors */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                      Byte 4 — Channel
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      0x{s.raw.byte4.toString(16).padStart(2, "0").toUpperCase()}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {[
                        { bit: 0x08, label: "Empty" },
                        { bit: 0x04, label: "S3 (Reader)" },
                        { bit: 0x02, label: "S2 (Middle)" },
                        { bit: 0x01, label: "S1 (Front)" },
                      ].map(({ bit, label }) => (
                        <div key={bit} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: (s.raw.byte4 & bit) ? "#22c55e" : "#e2e8f0" }} />
                          <span style={{ fontFamily: "monospace", color: (s.raw.byte4 & bit) ? "#22c55e" : "#94a3b8" }}>
                            {bit.toString(2).padStart(4, "0")}
                          </span>
                          <span style={{ color: "#64748b" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Command Buttons Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* Card Movement */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Card Movement
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  { label: "FC0 — Eject card", cmd: "fc0", color: "#f97316" },
                  { label: "FC7 — Move to reader", cmd: "fc7", color: "#2563eb" },
                  { label: "FC6 — Move to sensor 2", cmd: "fc6", color: "#2563eb" },
                  { label: "FC4 — Move to hold position", cmd: "fc4", color: "#2563eb" },
                  { label: "FC8 — Enter from front", cmd: "fc8", color: "#2563eb" },
                  { label: "DC — Move to pickup slot", cmd: "dc", color: "#f97316" },
                  { label: "BF — Accept card at front", cmd: "bf", color: "#2563eb" },
                  { label: "BG — Block front entry", cmd: "bg", color: "#dc2626" },
                  { label: "CP — Recycle to box", cmd: "cp", color: "#8b5cf6" },
                  { label: "DB — Return to issuing box", cmd: "db", color: "#8b5cf6" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      switch (cmd) {
                        case "fc7": ok = !!(await conn.dispenseFC7()); break;
                        case "fc6": ok = !!(await conn.moveFC6()); break;
                        case "fc4": ok = !!(await conn.moveFC4()); break;
                        case "fc0": ok = !!(await conn.ejectFC0()); break;
                        case "fc8": ok = !!(await conn.enterFC8()); break;
                        case "dc": ok = !!(await conn.ejectDC()); break;
                        case "bf": ok = !!(await conn.acceptFrontBF()); break;
                        case "bg": ok = !!(await conn.blockFrontBG()); break;
                        case "cp": ok = !!(await conn.recycleCP()); break;
                        case "db": ok = !!(await conn.returnDB()); break;
                      }
                      await conn.queryAP();
                      setActionLoading(null);
                      showToast(ok ? `${label.split("—")[0].trim()} OK` : `${label.split("—")[0].trim()} failed`, ok ? "success" : "error");
                    }}
                    disabled={connState !== "connected" || actionLoading !== null}
                    style={{
                      backgroundColor: "#ffffff",
                      color,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: `1px solid ${color}30`,
                      opacity: connState !== "connected" ? 0.4 : 1,
                      textAlign: "left",
                    }}
                    className="hover:opacity-80 transition-opacity disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {actionLoading === cmd ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset / FD Commands */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Reset &amp; FD Commands
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  { label: "RS — Reset device", cmd: "rs", color: "#dc2626" },
                  { label: "FD0 — Auto-sense enable", cmd: "fd0", color: "#059669" },
                  { label: "FD1 — Manual entry mode", cmd: "fd1", color: "#059669" },
                  { label: "FD2 — Reset, no action", cmd: "fd2", color: "#dc2626" },
                  { label: "FD3 — Reset → issuing box", cmd: "fd3", color: "#dc2626" },
                  { label: "FD4 — Reset → recycle box", cmd: "fd4", color: "#dc2626" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      switch (cmd) {
                        case "rs": ok = !!(await conn.resetDevice()); break;
                        case "fd0": ok = !!(await conn.enableFrontAutoSense()); break;
                        case "fd1": ok = !!(await conn.disableFrontAutoSense()); break;
                        case "fd2": ok = !!(await conn.resetFD2()); break;
                        case "fd3": ok = !!(await conn.resetFD3()); break;
                        case "fd4": ok = !!(await conn.resetFD4()); break;
                      }
                      await conn.queryAP();
                      setActionLoading(null);
                      showToast(ok ? `${label.split("—")[0].trim()} OK` : `${label.split("—")[0].trim()} failed`, ok ? "success" : "error");
                    }}
                    disabled={connState !== "connected" || actionLoading !== null}
                    style={{
                      backgroundColor: "#ffffff",
                      color,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: `1px solid ${color}30`,
                      opacity: connState !== "connected" ? 0.4 : 1,
                      textAlign: "left",
                    }}
                    className="hover:opacity-80 transition-opacity disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {actionLoading === cmd ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Query & Utility */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Query &amp; Utility
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  { label: "AP — Query status (4 bytes)", cmd: "ap", color: "#2563eb" },
                  { label: "RF — Query status (3 bytes)", cmd: "rf", color: "#2563eb" },
                  { label: "FC1 — Card position", cmd: "fc1", color: "#2563eb" },
                  { label: "FC2 — Sensor status", cmd: "fc2", color: "#2563eb" },
                  { label: "FR — Device settings", cmd: "fr", color: "#2563eb" },
                  { label: "GV — Get version", cmd: "gv", color: "#2563eb" },
                  { label: "BE — Buzzer on", cmd: "be", color: "#059669" },
                  { label: "BD — Buzzer off", cmd: "bd", color: "#059669" },
                  { label: "LP — LED steady on", cmd: "lp0", color: "#059669" },
                  { label: "LP — LED blink 1/sec", cmd: "lp1", color: "#059669" },
                  { label: "LP — LED blink 5/sec", cmd: "lp5", color: "#059669" },
                  { label: "LF — LED off", cmd: "lf", color: "#059669" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      let extra = "";
                      switch (cmd) {
                        case "ap": { const st = await conn.queryAP(); ok = !!st; extra = st ? `b1=0x${st.raw.byte1.toString(16).padStart(2,"0")} b2=0x${st.raw.byte2.toString(16).padStart(2,"0")} b3=0x${st.raw.byte3.toString(16).padStart(2,"0")} b4=0x${st.raw.byte4.toString(16).padStart(2,"0")}` : ""; break; }
                        case "fc1": {
                          const p = await conn.queryPosition();
                          ok = !!p;
                          extra = p ? `card=${p.transport} device=${p.device} box=${p.cardBox} retain=${p.retainBox}` : "not supported by this firmware";
                          break;
                        }
                        case "fr": {
                          const s2 = await conn.getDeviceSettings();
                          ok = !!s2;
                          extra = s2 ? `${s2.frontEntry}; ${s2.resetAction}` : "";
                          break;
                        }
                        case "gv": { const v = await conn.getVersion(); ok = !!v; extra = v || ""; break; }
                        case "rf": { const st = await conn.queryRF(); ok = !!st; extra = st ? `b1=0x${st.raw.byte1.toString(16).padStart(2,"0")} b2=0x${st.raw.byte2.toString(16).padStart(2,"0")} b3=0x${st.raw.byte3.toString(16).padStart(2,"0")}` : ""; break; }
                        case "fc2": {
                          const p2 = await conn.querySensors();
                          ok = !!p2;
                          extra = p2 ? `card=${p2.transport} device=${p2.device} box=${p2.cardBox} retain=${p2.retainBox}` : "not supported by this firmware";
                          break;
                        }
                        case "be": ok = !!(await conn.bufferEnable()); break;
                        case "bd": ok = !!(await conn.bufferDisable()); break;
                        case "lp0": ok = !!(await conn.ledOn(0x00)); break;
                        case "lp1": ok = !!(await conn.ledOn(0x01)); break;
                        case "lp5": ok = !!(await conn.ledOn(0x05)); break;
                        case "lf": ok = !!(await conn.ledOff()); break;
                      }
                      setActionLoading(null);
                      showToast(ok ? `${label.split("—")[0].trim()} OK${extra ? ": " + extra : ""}` : `${label.split("—")[0].trim()} failed`, ok ? "success" : "error");
                    }}
                    disabled={connState !== "connected" || actionLoading !== null}
                    style={{
                      backgroundColor: "#ffffff",
                      color,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: `1px solid ${color}30`,
                      opacity: connState !== "connected" ? 0.4 : 1,
                      textAlign: "left",
                    }}
                    className="hover:opacity-80 transition-opacity disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {actionLoading === cmd ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contactless (NFC) */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Contactless (NFC)
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  { label: "UID — Read card serial", cmd: "nfcuid", color: "#6366f1" },
                  { label: "S50 — Read block 4", cmd: "nfcs50", color: "#6366f1" },
                  { label: "UL — Read page 4", cmd: "nfcul", color: "#6366f1" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      let extra = "";
                      switch (cmd) {
                        case "nfcuid": {
                          const r = await conn.readNfcCard();
                          ok = r.success;
                          extra = r.success ? `${r.chipType} ${r.uid}` : r.message;
                          setNfcResult(ok ? { label: `${r.chipType} UID`, value: r.uid ?? "" } : null);
                          break;
                        }
                        case "nfcs50": {
                          const r = await conn.readNfcBlock("S50", 4);
                          ok = r.success;
                          extra = r.success ? (r.hex ?? "") : r.message;
                          setNfcResult(ok ? { label: "S50 block 4", value: r.hex ?? "" } : null);
                          break;
                        }
                        case "nfcul": {
                          const r = await conn.readNfcBlock("UL", 4);
                          ok = r.success;
                          extra = r.success ? (r.hex ?? "") : r.message;
                          setNfcResult(ok ? { label: "UL page 4", value: r.hex ?? "" } : null);
                          break;
                        }
                      }
                      setActionLoading(null);
                      showToast(ok ? `${label.split("—")[0].trim()} OK${extra ? ": " + extra : ""}` : extra || `${label.split("—")[0].trim()} failed`, ok ? "success" : "error");
                    }}
                    disabled={connState !== "connected" || actionLoading !== null}
                    style={{
                      backgroundColor: "#ffffff",
                      color,
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: `1px solid ${color}30`,
                      opacity: connState !== "connected" ? 0.4 : 1,
                      textAlign: "left",
                    }}
                    className="hover:opacity-80 transition-opacity disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {actionLoading === cmd ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {label}
                  </button>
                ))}
                {nfcResult && (
                  <div style={{ marginTop: 4, borderRadius: 6, border: "1px solid #6366f130", backgroundColor: "#eef2ff", padding: "6px 10px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {nfcResult.label}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#1e1b4b", wordBreak: "break-all" }}>
                      {nfcResult.value}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Baud rate — changes a persistent device setting */}
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Baud Rate
              </h3>
              <p style={{ fontSize: 11, color: "#b45309", backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
                Changes a stored device setting. The serial port stays open at the
                old rate, so the link goes silent until you disconnect and
                reconnect. The app opens ports at 9600.
              </p>
              <div className="flex flex-col gap-2">
                {([4800, 9600, 19200, 38400] as const).map((baud) => (
                  <button
                    key={baud}
                    onClick={async () => {
                      const cmd = `cs${baud}`;
                      setActionLoading(cmd);
                      const ok = await conn.setBaudRate(baud);
                      setActionLoading(null);
                      showToast(
                        ok
                          ? `Baud rate set to ${baud} — disconnect and reconnect to keep talking to the device`
                          : `Set baud ${baud} failed`,
                        ok ? "success" : "error"
                      );
                    }}
                    disabled={connState !== "connected" || actionLoading !== null}
                    style={{
                      backgroundColor: "#ffffff",
                      color: "#b45309",
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      border: "1px solid #b4530930",
                      opacity: connState !== "connected" ? 0.4 : 1,
                      textAlign: "left",
                    }}
                    className="hover:opacity-80 transition-opacity disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {actionLoading === `cs${baud}` ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {`CS${{ 4800: 2, 9600: 3, 19200: 4, 38400: 5 }[baud]} — ${baud} baud`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ===== COMMUNICATION LOG ===== */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4" style={{ color: "#64748b" }} />
              <h2 style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                Communication Log
              </h2>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>
                ({commLog.length})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadLog}
                disabled={commLog.length === 0}
                style={{
                  fontSize: 11,
                  color: commLog.length === 0 ? "#cbd5e1" : "#2563eb",
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #e2e8f0",
                }}
                className="hover:bg-gray-50 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setCommLog([])}
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #e2e8f0",
                }}
                className="hover:bg-gray-50 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <div
            style={{
              maxHeight: 300,
              overflowY: "auto",
              backgroundColor: "#1e293b",
              borderRadius: "0 0 8px 8px",
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: "18px",
            }}
          >
            {commLog.length === 0 && (
              <div style={{ color: "#64748b", fontStyle: "italic" }}>No communication yet. Connect device and send commands.</div>
            )}
            {commLog.map((entry, i) => {
              const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const isTX = entry.direction === "TX";
              const isRX = entry.direction === "RX";
              const color = isTX ? "#60a5fa" : isRX ? "#4ade80" : "#fbbf24";
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "#64748b", flexShrink: 0 }}>{time}</span>
                  <span style={{ color, fontWeight: 600, flexShrink: 0, width: 20 }}>{entry.direction}</span>
                  <span style={{ color: "#e2e8f0", wordBreak: "break-all" }}>
                    {entry.hex}
                    {entry.text && <span style={{ color: "#94a3b8" }}> — {entry.text}</span>}
                  </span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}
