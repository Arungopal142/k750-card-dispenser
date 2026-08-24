"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { useK750 } from "../../../lib/k750-context";
import { Loader2, RefreshCw, Wifi, WifiOff, CheckCircle2, XCircle, Info, ArrowDownFromLine, Nfc } from "lucide-react";

type ToastType = "success" | "error" | "info";

function Toast({ message, type, onClose }: { message: string; type: ToastType; onClose: () => void }) {
  const icons = { success: <CheckCircle2 className="w-4 h-4 text-green-500" />, error: <XCircle className="w-4 h-4 text-red-500" />, info: <Info className="w-4 h-4 text-blue-500" /> };
  const bg = { success: "bg-green-50 border-green-200", error: "bg-red-50 border-red-200", info: "bg-blue-50 border-blue-200" };
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
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-mono ${styles[color]}`}>
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
      <span className="text-[10px] font-mono text-gray-500">{label}</span>
    </div>
  );
}

export default function DevicePage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const { service, connState, status, connect, disconnect } = useK750();
  const [firmware, setFirmware] = useState<string | null>(null);
  const [nfcRead, setNfcRead] = useState<{ uid: string; chipType: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (message: string, type: ToastType = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

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
  const handleReadNfc = async () => {
    setActionLoading("nfc");
    const res = await service?.readNfcCard();
    setActionLoading(null);
    if (res?.success && res.uid) {
      setNfcRead({ uid: res.uid, chipType: res.chipType ?? "?" });
      showToast(`${res.chipType} card — UID ${res.uid}`, "success");
    } else {
      setNfcRead(null);
      showToast(res?.message ?? "NFC read failed", "error");
    }
  };
  const handleEject = async () => {
    setActionLoading("eject");
    showToast("Ejecting card...", "info");
    const ok = await service?.ejectFC0();
    await service?.queryAP();
    setActionLoading(null);
    showToast(ok ? "Card ejected" : "Eject failed or timed out", ok ? "success" : "error");
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
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh" }} className="p-6">
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
                <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>
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
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
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
              </div>

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
                    RS-485
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
                      ) : (
                        <>
                          {b1 & 0x08 && <Badge label="Recycle full" color="yellow" />}
                          {b1 & 0x04 && <Badge label="Cannot execute" color="red" />}
                          {b1 & 0x02 && <Badge label="Prep failed" color="red" />}
                          {b1 & 0x01 && <Badge label="Hopper pre-full" color="yellow" />}
                        </>
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
                      ) : (
                        <>
                          {b2 & 0x08 && <Badge label="Sending" color="yellow" />}
                          {b2 & 0x04 && <Badge label="Collecting" color="yellow" />}
                          {b2 & 0x02 && <Badge label="Issue error" color="red" />}
                          {b2 & 0x01 && <Badge label="Collect error" color="red" />}
                        </>
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
                      ) : (
                        <>
                          {b3 & 0x08 && <Badge label="Full" color="green" />}
                          {b3 & 0x04 && <Badge label="Overlap" color="red" />}
                          {b3 & 0x02 && <Badge label="Jam" color="red" />}
                          {b3 & 0x01 && <Badge label="Pre-empty" color="yellow" />}
                        </>
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
          className="flex flex-wrap gap-3"
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: 16,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <button
            onClick={handleReadNfc}
            disabled={connState !== "connected" || actionLoading === "nfc"}
            style={{
              backgroundColor: actionLoading === "nfc" ? "#818cf8" : "#6366f1",
              color: "#ffffff",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              opacity: connState !== "connected" ? 0.5 : 1,
            }}
            className="hover:opacity-90 transition-opacity flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {actionLoading === "nfc" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Nfc className="w-4 h-4" />}
            {actionLoading === "nfc" ? "Reading..." : "Read NFC"}
          </button>
          {nfcRead && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                {nfcRead.chipType}
              </span>
              <span className="font-mono text-xs text-indigo-900 break-all">{nfcRead.uid}</span>
            </div>
          )}
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
        </div>

      </div>
    </div>
  );
}
