"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { useK750, getK750Service } from "../../../lib/k750-context";
import type { LogEntry } from "../../../lib/k750-service";
import { Loader2, RefreshCw, Wifi, WifiOff, CheckCircle2, XCircle, Info, ArrowDownFromLine, Hand, Terminal } from "lucide-react";

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
  const { profile, loading } = useAuth();
  const router = useRouter();
  const { service, connState, status, connect, disconnect } = useK750();
  const [firmware, setFirmware] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [collectStep, setCollectStep] = useState(0);
  const [collectStepMsg, setCollectStepMsg] = useState("");
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [commLog, setCommLog] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: ToastType = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    const svc = getK750Service();
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
    const st = await service?.queryAP();
    setActionLoading(null);
    if (st) showToast("Status refreshed", "success");
    else showToast("No response from device", "error");
  };
  const handleGetVersion = async () => {
    setActionLoading("version");
    const v = await service?.getVersion();
    setActionLoading(null);
    if (v) { setFirmware(v); showToast(`Firmware: ${v}`, "success"); }
    else showToast("Could not get version", "error");
  };
  const handleReset = async () => {
    setActionLoading("reset");
    showToast("Resetting device...", "info");
    const ok = await service?.resetDevice();
    await service?.queryAP();
    setActionLoading(null);
    showToast(ok ? "Device reset successful" : "Reset failed", ok ? "success" : "error");
  };
  const handleEject = async () => {
    if (service?.isFlowBusy) { showToast("Device busy — please wait.", "warning"); return; }
    setActionLoading("eject");
    showToast("Ejecting card...", "info");

    // Attempt 1: Direct DC eject
    let result = await service?.ejectDC();
    if (result?.success) {
      await service?.queryAP();
      setActionLoading(null);
      showToast("Card ejected", "success");
      return;
    }

    // Attempt 2: RS reset → retry DC
    showToast("Eject stuck — resetting device...", "info");
    await service?.resetDevice();
    await new Promise((r) => setTimeout(r, 3000));
    await service?.queryAP();

    showToast("Retrying eject...", "info");
    result = await service?.ejectDC();
    await service?.queryAP();
    setActionLoading(null);
    showToast(result?.success ? "Card ejected after reset" : "Eject failed — card may be jammed. Remove manually.", result?.success ? "success" : "error");
  };
  const handleCollectCard = async () => {
    if (actionLoading === "collect") return;
    if (service?.isFlowBusy) { showToast("Device busy — please wait.", "warning"); return; }
    setActionLoading("collect");
    setCollectStep(0);
    setCollectStepMsg("");
    try {
      const res = await service?.visitorCheckout((step, msg) => { setCollectStep(step); setCollectStepMsg(msg); });
      if (res?.success) showToast("Card returned to recycle box", "success");
      else showToast(res?.message || "Collect failed", "error");
    } catch { showToast("Collect error", "error"); }
    setActionLoading(null);
    setCollectStep(0);
    setCollectStepMsg("");
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
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>{collectStep}/4</span>
                    <span>{collectStepMsg}</span>
                  </div>
                  <div className="flex gap-1" style={{ marginTop: 6 }}>
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, backgroundColor: i <= collectStep ? "#2563eb" : "#e2e8f0", transition: "background-color 0.3s" }} />
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
                        <Badge label="Reader (S3)" color="green" />
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
                    <SensorDot label="S3" active={!!(b4 & 0x04)} />
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
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#2563eb" }}>{collectStep}/4</span>
              <span>{collectStepMsg}</span>
            </div>
            <div className="flex gap-1.5" style={{ marginTop: 8 }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} style={{ height: 5, flex: 1, borderRadius: 3, backgroundColor: i <= collectStep ? "#2563eb" : "#e2e8f0", transition: "background-color 0.3s" }} />
              ))}
            </div>
            <div className="flex justify-between" style={{ marginTop: 6 }}>
              {["Enable front", "Insert card", "Move to reader", "Return to box"].map((label, idx) => (
                <span key={idx} style={{ fontSize: 9, color: idx + 1 <= collectStep ? "#2563eb" : "#94a3b8", fontWeight: idx + 1 === collectStep ? 600 : 400 }}>{label}</span>
              ))}
            </div>
          </div>
        )}

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
                  { label: "DC — Eject to pickup", cmd: "dc", color: "#f97316" },
                  { label: "FC7 — Move to reader", cmd: "fc7", color: "#2563eb" },
                  { label: "FC6 — Move to sensor 2", cmd: "fc6", color: "#2563eb" },
                  { label: "FC4 — Move to hold position", cmd: "fc4", color: "#2563eb" },
                  { label: "FC0 — Drop from bayonet", cmd: "fc0", color: "#2563eb" },
                  { label: "FC8 — Enter from front", cmd: "fc8", color: "#2563eb" },
                  { label: "CP — Recycle to box", cmd: "cp", color: "#8b5cf6" },
                  { label: "DB — Return to issuing box", cmd: "db", color: "#8b5cf6" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      switch (cmd) {
                        case "dc": { const r = await service?.ejectDC(); ok = !!r?.success; break; }
                        case "fc7": ok = !!(await service?.dispenseFC7()); break;
                        case "fc6": ok = !!(await service?.moveFC6()); break;
                        case "fc4": ok = !!(await service?.moveFC4()); break;
                        case "fc0": { const r = await service?.ejectFC0(); ok = !!r?.success; break; }
                        case "fc8": ok = !!(await service?.enterFC8()); break;
                        case "cp": ok = !!(await service?.recycleCP()); break;
                        case "db": ok = !!(await service?.returnDB()); break;
                      }
                      await service?.queryAP();
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
                        case "rs": ok = !!(await service?.resetDevice()); break;
                        case "fd0": showToast("FD0 sent — front auto-sense enabled", "success"); ok = true; break;
                        case "fd1": showToast("FD1 sent — manual entry mode", "success"); ok = true; break;
                        case "fd2": ok = !!(await service?.resetFD2()); break;
                        case "fd3": ok = !!(await service?.resetFD3()); break;
                        case "fd4": ok = !!(await service?.resetFD4()); break;
                      }
                      await service?.queryAP();
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
                  { label: "AP — Query status", cmd: "ap", color: "#2563eb" },
                  { label: "FC1 — Card position", cmd: "fc1", color: "#2563eb" },
                  { label: "FR — Device settings", cmd: "fr", color: "#2563eb" },
                  { label: "GV — Get version", cmd: "gv", color: "#2563eb" },
                  { label: "BE — Buffer enable", cmd: "be", color: "#059669" },
                  { label: "BD — Buffer disable", cmd: "bd", color: "#059669" },
                ].map(({ label, cmd, color }) => (
                  <button
                    key={cmd}
                    onClick={async () => {
                      setActionLoading(cmd);
                      let ok = false;
                      let extra = "";
                      switch (cmd) {
                        case "ap": { const st = await service?.queryAP(); ok = !!st; extra = st ? `b1=0x${st.raw.byte1.toString(16).padStart(2,"0")} b2=0x${st.raw.byte2.toString(16).padStart(2,"0")} b3=0x${st.raw.byte3.toString(16).padStart(2,"0")} b4=0x${st.raw.byte4.toString(16).padStart(2,"0")}` : ""; break; }
                        case "fc1": {
                          const p = await service?.queryPosition();
                          ok = !!p;
                          extra = p ? `card=${p.transport} device=${p.device} box=${p.cardBox} retain=${p.retainBox}` : "not supported by this firmware";
                          break;
                        }
                        case "fr": {
                          const s2 = await service?.getDeviceSettings();
                          ok = !!s2;
                          extra = s2 ? `${s2.frontEntry}; ${s2.resetAction}` : "";
                          break;
                        }
                        case "gv": { const v = await service?.getVersion(); ok = !!v; extra = v || ""; break; }
                        case "be": ok = !!(await service?.bufferEnable()); break;
                        case "bd": ok = !!(await service?.bufferDisable()); break;
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
