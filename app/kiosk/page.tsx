"use client";

import { useState, useRef, useEffect } from "react";
import { useK750 } from "../../lib/k750-context";
import { ISSUE_STEP_LABELS, type IssueResult } from "../../lib/k750-service";
import { logCardIssue } from "../../lib/firestore-service";
import { useToast } from "../../lib/toast-context";
import { useAuth } from "../../lib/auth-context";
import { Loader2, CreditCard, CheckCircle, XCircle, Wifi, WifiOff, RotateCcw, AlertTriangle } from "lucide-react";

export default function KioskPage() {
  const { toast } = useToast();
  const { service, connState, status: deviceStatus, connect } = useK750();
  const { user, loginAnonymously, loading: authLoading, authError } = useAuth();
  const [authRetrying, setAuthRetrying] = useState(false);
  const triedAnonymous = useRef(false);

  useEffect(() => {
    if (!authLoading && !user && !authError && !triedAnonymous.current) {
      triedAnonymous.current = true;
      loginAnonymously().catch(() => {});
    }
  }, [authLoading, user, loginAnonymously, authError]);

  const handleRetryAuth = async () => {
    setAuthRetrying(true);
    try {
      await loginAnonymously();
    } catch { /* */ }
    setAuthRetrying(false);
  };

  const [result, setResult] = useState<IssueResult | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(false);
  const [issueStep, setIssueStep] = useState(0);
  const [issueStepMsg, setIssueStepMsg] = useState("");

  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [empDept, setEmpDept] = useState("");
  const empIdRef = useRef<HTMLInputElement>(null);

  const handleConnect = async () => {
    try { await connect(); } catch { /* */ }
  };

  // Issue: pre-check → FC0 (auto-clear) → FC7 → FC0 → FD3, then Firestore.
  // The transaction is recorded only after the card has physically come out.
  const handleIssue = async () => {
    if (!empId.trim() || !empName.trim() || !empDept.trim()) return;
    if (issuing || connState !== "connected" || !user) return;
    setIssuing(true);
    setResult(null);
    setIssued(false);
    setIssueStep(0);
    setIssueStepMsg("");
    const id = empId.trim();
    const nm = empName.trim();
    const dp = empDept.trim();
    try {
      const res = await service.issueCard(id, nm, dp, (step, _total, msg) => {
        setIssueStep(step);
        setIssueStepMsg(msg);
      });
      setResult(res);

      try {
        await logCardIssue({
          employeeId: id, employeeName: nm, department: dp,
          issuedBy: "Self-Service", issuedById: user.uid,
          status: res.success ? "Issued" : "Failed",
          source: "K750",
          ...(res.success ? {} : { errorMessage: res.message }),
        });
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        if (res.success) {
          const warning = `Card was dispensed, but the transaction could not be saved: ${msg}`;
          setResult({ success: false, message: warning });
          toast(warning, "error");
          setIssuing(false);
          setIssueStep(0);
          setIssueStepMsg("");
          return;
        }
      }

      if (res.success) {
        setIssued(true);
        toast("Card issued! Please collect.", "success");
        setEmpId(""); setEmpName(""); setEmpDept("");
        setTimeout(() => { setIssued(false); empIdRef.current?.focus(); }, 5000);
      } else {
        toast(res.message, "error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ success: false, message: `Error: ${msg}` });
      toast(`Error: ${msg}`, "error");
      await logCardIssue({
        employeeId: id, employeeName: nm, department: dp,
        issuedBy: "Self-Service", issuedById: user.uid,
        status: "Failed", source: "K750", errorMessage: msg,
      }).catch(() => {});
    }
    setIssuing(false);
    setIssueStep(0);
    setIssueStepMsg("");
  };

  const s = deviceStatus;
  const b4 = s?.raw.byte4 ?? 0;
  const hasCardInChannel = !!(b4 & 0x07);
  // Informational: step 2 of the issue flow clears the channel with FC0, so a
  // card sitting in the channel no longer blocks the button.
  const channelNotice = hasCardInChannel ? "A card is in the channel — it will be cleared automatically." : null;
  const issueDisabled =
    connState !== "connected" || issuing || !empId.trim() || !empName.trim() || !empDept.trim() || !user || authLoading;

  const connColor = connState === "connected" ? "bg-green-500" : connState === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-gray-400";
  const connLabel = connState === "connected" ? "CONNECTED" : connState === "connecting" ? "CONNECTING" : "OFFLINE";

  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>

      {/* TOP BAR — 56px */}
      <div style={{ height: 56, minHeight: 56, borderBottom: "1px solid #e2e8f0" }} className="flex items-center justify-between px-6 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <span className="text-[15px] font-bold tracking-wide text-gray-900" style={{ letterSpacing: "0.08em" }}>K750 CARD SERVICES</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${connColor}`} />
            <span className="text-xs font-semibold tracking-wide" style={{ color: connState === "connected" ? "#16a34a" : "#94a3b8" }}>{connLabel}</span>
          </div>
          {connState === "disconnected" || connState === "error" ? (
            <button
              onClick={handleConnect}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-2 active:scale-95 transition-transform"
            >
              <Wifi className="w-3.5 h-3.5" /> Connect
            </button>
          ) : (
            <button
              onClick={() => service?.disconnect()}
              className="h-9 px-4 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 text-xs font-bold flex items-center gap-2 active:scale-95 transition-transform"
            >
              <WifiOff className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
        </div>
      </div>

      {/* MAIN CONTENT — flex-1, vertically centered */}
      <div className="flex-1 flex items-center justify-center" style={{ overflow: "auto" }}>
        <div style={{ maxWidth: 600, width: "100%", padding: "24px 24px" }}>

          {/* ========== AUTH LOADING STATE ========== */}
          {authLoading && (
            <div className="flex flex-col items-center text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p style={{ fontSize: 14, color: "#64748b" }}>Initializing kiosk...</p>
            </div>
          )}

          {/* ========== AUTH ERROR STATE ========== */}
          {!authLoading && authError && !user && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700 }} className="text-gray-900">Authentication Failed</h2>
              <p style={{ fontSize: 13, color: "#64748b" }}>{authError}</p>
              <button
                onClick={handleRetryAuth}
                disabled={authRetrying}
                style={{
                  height: 48, width: "100%", borderRadius: 8,
                  backgroundColor: "#2563eb", color: "#fff",
                  fontWeight: 600, fontSize: 14,
                  opacity: authRetrying ? 0.6 : 1,
                }}
                className="flex items-center justify-center gap-2"
              >
                {authRetrying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {authRetrying ? "Retrying..." : "Retry"}
              </button>
            </div>
          )}

          {/* ========== IDLE STATE ========== */}
          {!authLoading && user && !issued && !issuing && !(result && !issued) && (
            <div className="flex flex-col items-center text-center space-y-6">
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700 }} className="text-gray-900">ENTER YOUR DETAILS</h2>
                <p style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>Fill in the form to receive your ID card</p>
              </div>

              <div className="w-full space-y-4">
                <input
                  ref={empIdRef}
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  autoFocus
                  placeholder="Employee ID"
                  style={{ height: 56, fontSize: 17, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  className="w-full bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all px-4"
                />
                <input
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  placeholder="Full Name"
                  style={{ height: 56, fontSize: 17, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  className="w-full bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all px-4"
                />
                <input
                  value={empDept}
                  onChange={(e) => setEmpDept(e.target.value)}
                  placeholder="Department"
                  style={{ height: 56, fontSize: 17, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  className="w-full bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all px-4"
                />
              </div>

              <button
                onClick={handleIssue}
                disabled={issueDisabled}
                style={{
                  height: 56, width: "100%", borderRadius: 8,
                  backgroundColor: "#16a34a", color: "#fff",
                  fontWeight: 700, fontSize: 17,
                  opacity: issueDisabled ? 0.4 : 1,
                  cursor: issueDisabled ? "not-allowed" : "pointer",
                }}
                className="flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
              >
                <CreditCard className="w-5 h-5" /> GET MY CARD
              </button>

              {channelNotice && (
                <div className="flex items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium" style={{ backgroundColor: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>
                  <AlertTriangle className="w-4 h-4" /> {channelNotice}
                </div>
              )}
            </div>
          )}

          {/* ========== PROCESSING STATE ========== */}
          {issuing && (
            <div className="flex flex-col items-center text-center space-y-6">
              <h2 style={{ fontSize: 22, fontWeight: 700 }} className="text-gray-900">PREPARING CARD...</h2>

              <div className="w-32 h-32 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center">
                <CreditCard className="w-16 h-16 text-blue-400" />
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span>{issueStepMsg || "Checking machine..."}</span>
              </div>

              {/* Real per-step progress, driven by the K750 flow callback. */}
              <div className="w-full max-w-xs mx-auto flex gap-1.5">
                {ISSUE_STEP_LABELS.map((label, i) => (
                  <div
                    key={label}
                    style={{
                      height: 6,
                      flex: 1,
                      borderRadius: 3,
                      backgroundColor: i + 1 <= issueStep ? "#3b82f6" : "#e2e8f0",
                      transition: "background-color 0.3s",
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                Step {Math.max(issueStep, 1)} of {ISSUE_STEP_LABELS.length}
              </span>
            </div>
          )}

          {/* ========== SUCCESS STATE ========== */}
          {issued && (
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center" style={{ animation: "fadeInScale 0.5s ease-out" }}>
                <CheckCircle className="w-12 h-12 text-green-500" />
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>CARD ISSUED SUCCESSFULLY</h2>
              <p style={{ fontSize: 14, color: "#64748b" }}>Please collect your card from the dispenser</p>
              <button
                onClick={() => { setIssued(false); setResult(null); empIdRef.current?.focus(); }}
                style={{ height: 56, width: "100%", borderRadius: 8, backgroundColor: "#f1f5f9", border: "1px solid #e2e8f0", fontWeight: 600, fontSize: 15, color: "#334155" }}
                className="flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <RotateCcw className="w-4 h-4" /> Issue Another Card
              </button>
            </div>
          )}

          {/* ========== RESULT STATE (failed) ========== */}
          {result && !issued && (
            <div className="flex flex-col items-center text-center space-y-6">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center ${result.success ? "bg-green-100" : "bg-red-100"}`} style={{ animation: "fadeInScale 0.5s ease-out" }}>
                {result.success ? <CheckCircle className="w-12 h-12 text-green-500" /> : <XCircle className="w-12 h-12 text-red-500" />}
              </div>
              <div
                className={`w-full rounded-lg p-4 text-sm font-medium flex items-center justify-center gap-3 ${result.success ? "text-green-700" : "text-red-700"}`}
                style={{ backgroundColor: result.success ? "#f0fdf4" : "#fef2f2", border: `1px solid ${result.success ? "#bbf7d0" : "#fecaca"}` }}
              >
                {result.success ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                {result.message}
              </div>
              <button
                onClick={() => { setResult(null); setIssued(false); empIdRef.current?.focus(); }}
                style={{ height: 56, width: "100%", borderRadius: 8, backgroundColor: "#f1f5f9", border: "1px solid #e2e8f0", fontWeight: 600, fontSize: 15, color: "#334155" }}
                className="flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <RotateCcw className="w-4 h-4" /> Try Again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM BAR — 48px */}
      <div style={{ height: 48, minHeight: 48, borderTop: "1px solid #e2e8f0" }} className="flex items-center justify-center px-6 bg-white">
        <div className="flex items-center gap-2">
          <span style={{ color: connState === "connected" ? "#16a34a" : "#94a3b8" }}>●</span>
          <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>
            {connState === "connected" ? "MACHINE READY" : connState === "connecting" ? "CONNECTING..." : "MACHINE OFFLINE"}
            {" · K750-001"}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { width: 30%; }
          50% { width: 85%; }
        }
        @keyframes fadeInScale {
          0% { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
