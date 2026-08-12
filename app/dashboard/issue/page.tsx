"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { useK750 } from "../../../lib/k750-context";
import type { IssueResult } from "../../../lib/k750-service";
import { logCardIssue, logActivity, updateCardIssue } from "../../../lib/firestore-service";
import { useToast } from "../../../lib/toast-context";
import { Loader2, CreditCard, RotateCcw, AlertTriangle, CheckCircle, XCircle, Wifi, WifiOff } from "lucide-react";

function SensorDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`h-3 w-3 sm:h-4 sm:w-4 rounded-full border-2 transition-colors ${
          active
            ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
            : "bg-gray-300 border-gray-400"
        }`}
      />
      <span className="text-[9px] sm:text-[10px] font-mono text-gray-500">{label}</span>
    </div>
  );
}

export default function IssueCardPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { service, connState, status: deviceStatus, connect, disconnect } = useK750();
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [result, setResult] = useState<IssueResult | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cardIssueId, setCardIssueId] = useState<string | null>(null);

  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [empDept, setEmpDept] = useState("");
  const empIdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (autoRefresh && connState === "connected" && !issuing) {
      autoRefreshRef.current = setInterval(() => {
        service?.queryAP();
      }, 1000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, connState, issuing]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch {
      /* */
    }
  };
  const handleDisconnect = async () => {
    await disconnect();
  };

  const handleIssue = async () => {
    if (!empId.trim() || !empName.trim() || !empDept.trim() || !profile) return;
    if (issuing) return;
    setIssuing(true);
    setResult(null);
    const id = empId.trim();
    const nm = empName.trim();
    const dp = empDept.trim();
    let cardIssueId: string | null = null;
    try {
      const issueRes = await logCardIssue({
        employeeId: id,
        employeeName: nm,
        department: dp,
        issuedBy: profile.displayName || profile.email,
        issuedById: user?.uid ?? "",
        status: "Processing",
        source: "K750",
      });
      cardIssueId = issueRes;
      setCardIssueId(issueRes);
      const res = await service?.issueCard(id, nm, dp);
      if (res) {
        setResult(res);
        await updateCardIssue(cardIssueId, {
          status: res.success ? "Issued" : "Failed",
          ...(res.success ? {} : { errorMessage: res.message }),
        });
        await logActivity({
          userId: user?.uid ?? "",
          userName: profile?.displayName || "Unknown",
          action: "Issued Card",
          details: `${nm} (${id}) - ${res.success ? "Success" : "Failed"}${res.errorCode ? ` [${res.errorCode}]` : ""}`,
        });
        toast(
          res.success ? `Card issued for ${nm}` : res.message,
          res.success ? "success" : "error"
        );
        setEmpId("");
        setEmpName("");
        setEmpDept("");
        setTimeout(() => empIdRef.current?.focus(), 100);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ success: false, message: `Error: ${msg}` });
      toast(`Error: ${msg}`, "error");
      if (cardIssueId) {
        await updateCardIssue(cardIssueId, { status: "Failed", errorMessage: msg });
      }
    }
    setIssuing(false);
  };

  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    toast("Resetting device...", "info");
    const ok = await service?.resetDevice();
    await service?.queryAP();
    setResetting(false);
    toast(ok ? "Device reset successful" : "Reset failed — no response", ok ? "success" : "error");
  };
  const handleEject = async () => {
    await service?.ejectFC0();
    await service?.queryAP();
  };

  if (loading || !profile)
    return (
      <div className="p-4 md:p-6 text-gray-500">Loading...</div>
    );

  const s = deviceStatus;
  const b1 = s?.raw.byte1 ?? 0;
  const b2 = s?.raw.byte2 ?? 0;
  const b3 = s?.raw.byte3 ?? 0;
  const b4 = s?.raw.byte4 ?? 0;
  const hasCardInChannel = !!(b4 & 0x07);
  const blocking = b4 & 0x07
    ? "Card in channel - eject first"
    : s && s.raw.byte3 & 0x04
    ? "Card overlap"
    : s && s.raw.byte3 & 0x02
    ? "Card jam"
    : s && s.raw.byte2 & 0x02
    ? "Issue error"
    : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <img src="/images/card-issue-icon.svg" alt="Issue Card" className="w-12 h-12" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Issue Card</h1>
          <p className="text-sm text-gray-500">
            Dispense a new card to an employee
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ===== LEFT PANEL (col-span-2) ===== */}
        <div className="lg:col-span-2 space-y-4">
          {/* Connection Status Bar */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                  connState === "connected"
                    ? "bg-green-500 animate-pulse-glow"
                    : connState === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-gray-400"
                }`}
              />
              <span className="text-sm font-medium text-gray-900 capitalize">
                {connState === "connected"
                  ? "Connected"
                  : connState === "disconnected"
                  ? "Disconnected"
                  : connState === "connecting"
                  ? "Connecting..."
                  : "Error"}
              </span>
            </div>
            <div className="ml-auto">
              {connState === "disconnected" || connState === "error" ? (
                <button
                  onClick={handleConnect}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors btn-primary flex items-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5" /> Connect
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="rounded-lg bg-gray-200 border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-300 transition-colors flex items-center gap-1.5"
                >
                  <WifiOff className="w-3.5 h-3.5" /> Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Employee Details Card */}
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 space-y-4">
            <h2
              className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider"
              style={{ fontSize: "11px" }}
            >
              Employee Details
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-gray-500 uppercase">
                  Employee ID
                </label>
                <input
                  ref={empIdRef}
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                  style={{ height: "40px" }}
                  placeholder="Enter employee ID"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-gray-500 uppercase">
                  Name
                </label>
                <input
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                  style={{ height: "40px" }}
                  placeholder="Enter employee name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-gray-500 uppercase">
                  Department
                </label>
                <input
                  value={empDept}
                  onChange={(e) => setEmpDept(e.target.value)}
                  className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                  style={{ height: "40px" }}
                  placeholder="Enter department"
                />
              </div>
            </div>
          </div>

          {/* Result Banner */}
          {result && (
            <div
              className={`rounded-xl p-4 text-sm font-medium flex items-center gap-3 animate-fade-in ${
                result.success
                  ? "bg-green-50 border border-green-200 text-green-700"
                  : "bg-red-50 border border-red-200 text-red-700"
              }`}
            >
              {result.success ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              {result.message}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleIssue}
              disabled={
                connState !== "connected" ||
                issuing ||
                !!blocking ||
                hasCardInChannel ||
                !empId.trim() ||
                !empName.trim() ||
                !empDept.trim()
              }
              className="flex-1 rounded-xl px-6 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all btn-primary flex items-center justify-center gap-2"
              style={{
                height: "48px",
                backgroundColor: "#16a34a",
              }}
            >
              {issuing ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" /> Issuing...
                </>
              ) : (
                <>
                  <CreditCard className="w-5 h-5" /> Issue Card
                </>
              )}
            </button>
            <button
              onClick={handleReset}
              disabled={connState !== "connected" || resetting}
              className="rounded-xl px-5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition-colors flex items-center gap-1.5"
              style={{
                height: "48px",
                border: "none",
                background: "transparent",
              }}
            >
              {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {resetting ? "RS..." : "RS"}
            </button>
          </div>

          {/* Blocking Warning */}
          {blocking && (
            <div className="text-xs text-red-600 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {blocking}
            </div>
          )}
        </div>

        {/* ===== RIGHT PANEL (col-span-1) ===== */}
        <div className="space-y-4">
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 space-y-5">
            {/* Device Header */}
            <div className="flex items-center justify-between">
              <h2
                className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider"
                style={{ fontSize: "11px" }}
              >
                K750 Device
              </h2>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 bg-white text-green-600 focus:ring-green-500"
                />
                Auto
              </label>
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  connState === "connected"
                    ? "bg-green-500"
                    : connState === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-gray-400"
                }`}
              />
              <span className="capitalize">{connState}</span>
            </div>

            {!s && (
              <p className="text-sm text-gray-400">
                Connect device to see status.
              </p>
            )}

            {s && (
              <div className="space-y-4">
                {/* Status Bytes */}
                <div className="space-y-2">
                  {/* Channel (b4) */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Channel (b4)
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        b4 & 0x08
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : b4 & 0x04
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-green-50 text-green-700 border border-green-200"
                      }`}
                    >
                      {b4 & 0x08
                        ? "Box EMPTY"
                        : b4 & 0x04
                        ? "Reader"
                        : "Clear"}
                    </span>
                  </div>

                  {/* Machine (b1) */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Machine (b1)
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        b1 === 0
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}
                    >
                      {b1 === 0 ? "Idle" : "Busy"}
                    </span>
                  </div>

                  {/* Action (b2) */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Action (b2)
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        b2 === 0
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                      }`}
                    >
                      {b2 === 0 ? "Ready" : "Busy"}
                    </span>
                  </div>

                  {/* Card Box (b3) */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Card Box (b3)
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        b3 === 0
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {b3 === 0
                        ? "OK"
                        : b3 & 0x04
                        ? "Overlap"
                        : b3 & 0x02
                        ? "Jam"
                        : "Error"}
                    </span>
                  </div>
                </div>

                {/* Sensor Visualization */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                    Sensors
                  </h4>
                  <div className="bg-gray-100 rounded-lg py-4 px-4">
                    <div className="flex items-center justify-center gap-0">
                      <span className="text-[9px] font-mono text-gray-500 mr-2">
                        Stack
                      </span>
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      <div className="flex flex-col items-center mx-1">
                        <div
                          className={`h-3 w-3 rounded-full border-2 transition-all ${
                            !!(b4 & 0x01)
                              ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                              : "bg-gray-300 border-gray-400"
                          }`}
                        />
                        <span className="text-[8px] font-mono text-gray-500 mt-1">
                          S1
                        </span>
                      </div>
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      <div className="flex flex-col items-center mx-1">
                        <div
                          className={`h-3 w-3 rounded-full border-2 transition-all ${
                            !!(b4 & 0x02)
                              ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                              : "bg-gray-300 border-gray-400"
                          }`}
                        />
                        <span className="text-[8px] font-mono text-gray-500 mt-1">
                          S2
                        </span>
                      </div>
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      <div className="flex flex-col items-center mx-1">
                        <div
                          className={`h-3 w-3 rounded-full border-2 transition-all ${
                            !!(b4 & 0x04)
                              ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                              : "bg-gray-300 border-gray-400"
                          }`}
                        />
                        <span className="text-[8px] font-mono text-gray-500 mt-1">
                          S3
                        </span>
                      </div>
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      <span className="text-[9px] font-mono text-gray-500 ml-2">
                        Bay
                      </span>
                    </div>
                  </div>
                </div>

                {/* Raw Hex Data */}
                <div className="border-t border-gray-200 pt-4">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Raw Data (HEX)
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 font-mono text-xs text-gray-700 break-all">
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
      </div>
    </div>
  );
}
