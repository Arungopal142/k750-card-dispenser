"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { useK750, getK750Conn } from "../../../lib/k750-context";
import { getK750Dispense, ISSUE_STEP_LABELS } from "../../../lib/k750-dispense";
import { getK750Collect, CHECKOUT_STEP_LABELS } from "../../../lib/k750-collect";
import type { IssueResult } from "../../../lib/k750-dispense";
import type { LogEntry } from "../../../lib/k750-connection";
import { logActivity, subscribeIssuedCards, subscribeAllCardIssues, returnCard, logCardIssue, type CardIssue, formatDateTime } from "../../../lib/firestore-service";
import { useToast } from "../../../lib/toast-context";
import { Loader2, CreditCard, RotateCcw, AlertTriangle, CheckCircle, XCircle, Wifi, WifiOff, UserPlus, LogOut, Terminal, Clock } from "lucide-react";

type TabKey = "issue" | "exit";

export default function IssueCardPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { conn, dispense, collect, connState, status: deviceStatus, connect, disconnect } = useK750();
  const autoRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("issue");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // --- Issue Card state ---
  const [result, setResult] = useState<IssueResult | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueStep, setIssueStep] = useState(0);
  const [issueStepMsg, setIssueStepMsg] = useState("");
  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [empDept, setEmpDept] = useState("");

  // --- Visitor Exit state ---
  const [exitResult, setExitResult] = useState<IssueResult | null>(null);
  const [exitRunning, setExitRunning] = useState(false);
  const [exitStep, setExitStep] = useState(0);
  const [exitStepMsg, setExitStepMsg] = useState("");
  const [issuedCards, setIssuedCards] = useState<CardIssue[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardIssue | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [cardsLoading, setCardsLoading] = useState(true);

  // --- Recycle Bin ---
  const [recycleCount, setRecycleCount] = useState(0);
  const RECYCLE_MAX = 13;

  // --- Reset ---
  const [resetting, setResetting] = useState(false);

  // --- Logs ---
  const [commLog, setCommLog] = useState<LogEntry[]>([]);
  const [issueHistory, setIssueHistory] = useState<CardIssue[]>([]);
  const [logTab, setLogTab] = useState<"comm" | "history">("history");
  const commLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  // Subscribe to device comm log
  useEffect(() => {
    const svc = getK750Conn();
    if (!svc) return;
    const handler = (entry: LogEntry) => {
      setCommLog((prev) => [...prev.slice(-99), entry]);
    };
    svc.onLog = handler;
    return () => { svc.onLog = undefined; };
  }, []);

  // Subscribe to issue history from Firestore
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAllCardIssues(
      (all) => setIssueHistory(all.slice(0, 30)),
      (err) => console.error("Issue history error:", err)
    );
    return unsub;
  }, [user]);

  // Auto-scroll comm log
  useEffect(() => {
    commLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commLog]);

  const downloadLog = (log: LogEntry[], filename: string) => {
    const lines = log.map((e) => {
      const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${time} ${e.direction} ${e.hex}${e.text ? " — " + e.text : ""}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Live list of cards currently out with a visitor. Subscribed for the whole
  // page (not just the exit tab) so a card issued on the other tab is already
  // there when the operator switches over. Errors are shown instead of
  // swallowed — a missing composite index or a rules rejection used to look
  // exactly like "no issued cards".
  useEffect(() => {
    if (!user) return;
    // cardsLoading starts true; the snapshot/error callbacks clear it.
    const unsubscribe = subscribeIssuedCards(
      (cards) => {
        setIssuedCards(cards);
        setCardsError(null);
        setCardsLoading(false);
        // Keep the selection pointing at live data, and drop it if the card was
        // returned from another terminal.
        setSelectedCard((prev) => (prev ? cards.find((c) => c.id === prev.id) ?? null : null));
      },
      (err) => {
        const msg = err.message || String(err);
        setCardsLoading(false);
        // Keep the original message: Firestore's missing-index error carries a
        // console link that creates the index in one click.
        setCardsError(
          msg.includes("index")
            ? `Firestore is missing the index for this query. Run "firebase deploy --only firestore:indexes", or use the link in this error — ${msg}`
            : msg.includes("permission") || msg.includes("insufficient")
            ? `Not allowed to read card issues. Deploy the updated firestore.rules and check that your user document has active: true. (${msg})`
            : `Could not load issued cards: ${msg}`
        );
      }
    );
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeAllCardIssues(
      (all) => {
        const count = all.filter(c => c.status === "Collected" && c.returnedTo === "recycle").length;
        setRecycleCount(count);
      },
      (err) => console.error("Recycled cards error:", err)
    );
    return unsubscribe;
  }, [user]);

  // Self-scheduling poll: setInterval fired every second regardless of how long
  // Auto-refresh device status every second while connected and idle.
  useEffect(() => {
    if (!(autoRefresh && connState === "connected" && !issuing && !exitRunning)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try { await conn.queryAP(); } catch { /* */ }
      if (!cancelled) autoRefreshRef.current = setTimeout(tick, 1000);
    };
    autoRefreshRef.current = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      if (autoRefreshRef.current) clearTimeout(autoRefreshRef.current);
      autoRefreshRef.current = null;
    };
  }, [autoRefresh, connState, issuing, exitRunning, conn]);

  const handleConnect = async () => { try { await connect(); } catch { /* */ } };
  const handleDisconnect = async () => { await disconnect(); };

  const handleReset = async () => {
    setResetting(true);
    toast("Resetting device...", "info");
    const ok = await conn.resetDevice();
    await conn.queryAP();
    setResetting(false);
    toast(ok ? "Device reset successful" : "Reset failed — no response", ok ? "success" : "error");
  };

  // ===== Issue Card: pre-check → FC0 (auto-clear) → FC7 → FC0 → FD3 =====
  //
  // Nothing is written to Firestore until the card has physically been
  // delivered: the transaction is recorded as "Issued" only after the device
  // flow reports success, and as "Failed" (with the real error) otherwise.
  const handleIssue = async () => {
    if (!empId.trim() || !empName.trim() || !empDept.trim() || !profile || issuing) return;
    if (connState !== "connected") { toast("Connect to K750 device first", "error"); return; }
    setIssuing(true);
    setResult(null);
    setIssueStep(0);
    setIssueStepMsg("");
    const id = empId.trim();
    const name = empName.trim();
    const dept = empDept.trim();

    try {
      const res = await dispense.issueCard(id, name, dept, (step, _total, msg) => {
        setIssueStep(step);
        setIssueStepMsg(msg);
      });
      setResult(res);

      try {
        await logCardIssue({
          employeeId: id,
          employeeName: name,
          department: dept,
          issuedBy: profile.displayName || profile.email,
          issuedById: user?.uid ?? "",
          status: res.success ? "Issued" : "Failed",
          source: "K750",
          ...(res.success ? {} : { errorMessage: res.message }),
        });
        await logActivity({
          userId: user?.uid ?? "",
          userName: profile?.displayName || "Unknown",
          action: "Card Issued",
          details: `${name} - ${dept} - ${res.success ? "Success" : `Failed: ${res.message}`}`,
        });
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        if (res.success) {
          // The hardware and the database now disagree — say so instead of
          // reporting a clean success.
          const warning = `Card was dispensed, but the transaction could not be saved: ${msg}`;
          setResult({ success: false, message: warning });
          toast(warning, "error");
          setIssuing(false);
          setIssueStep(0);
          setIssueStepMsg("");
          return;
        }
      }

      if (res.warning) toast(res.warning, "warning");
      toast(res.success ? "Card issued — please collect the card." : res.message, res.success ? "success" : "error");
      if (res.success) {
        setTimeout(() => { setEmpId(""); setEmpName(""); setEmpDept(""); setResult(null); }, 3000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ success: false, message: `Error: ${msg}` });
      toast(`Error: ${msg}`, "error");
      await logCardIssue({
        employeeId: id, employeeName: name, department: dept,
        issuedBy: profile.displayName || profile.email,
        issuedById: user?.uid ?? "",
        status: "Failed", source: "K750", errorMessage: msg,
      }).catch(() => {});
    }
    setIssuing(false);
    setIssueStep(0);
    setIssueStepMsg("");
  };

  // ===== Card Return: FD0 → visitor inserts card → FC7 → CP → FD1 → FD3 → Firestore =====
  const handleVisitorExit = async () => {
    if (exitRunning || connState !== "connected" || !selectedCard || !profile) return;
    const card = selectedCard;
    setExitRunning(true);
    setExitResult(null);
    setExitStep(0);
    setExitStepMsg("");
    try {
      const res = await collect.visitorCheckout((step, _total, msg) => { setExitStep(step); setExitStepMsg(msg); });
      if (res) {
        if (res.success && card.id) {
          // The card is physically back in the machine. If this write fails the
          // database and the hardware disagree, so say so loudly rather than
          // reporting a clean success.
          try {
            await returnCard(card.id, profile.displayName || profile.email, "recycle");
            await logActivity({
              userId: user?.uid ?? "",
              userName: profile?.displayName || "Unknown",
              action: "Card Returned",
              details: `${card.employeeName}${card.companyName ? ` - ${card.companyName}` : ""} → recycle box`,
            });
          } catch (dbErr) {
            const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
            const warning = `Card was returned to the machine, but the record could not be updated: ${msg}`;
            setExitResult({ success: false, message: warning });
            toast(warning, "error");
            setExitRunning(false);
            setExitStep(0);
            setExitStepMsg("");
            return;
          }
        }
        setExitResult(res);
        if (res.warning) toast(res.warning, "warning");
        toast(res.message, res.success ? "success" : "error");
        // On success the live subscription drops the row and clears the selection.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExitResult({ success: false, message: `Error: ${msg}` });
      toast(`Error: ${msg}`, "error");
    }
    setExitRunning(false);
    setExitStep(0);
    setExitStepMsg("");
  };

  if (loading || !profile) return <div className="p-4 md:p-6 text-gray-500">Loading...</div>;

  const s = deviceStatus;
  const b4 = s?.raw.byte4 ?? 0;
  const hasCardInChannel = !!(b4 & 0x07);
  // Informational only on the Issue tab (the flow auto-clears it); the Card
  // Return tab still needs an empty channel before the visitor inserts a card.
  const channelNotice = hasCardInChannel
    ? activeTab === "issue"
      ? "A card is in the channel — it will be cleared automatically before dispensing."
      : "Card in channel — clear it before starting a return."
    : null;

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "issue", label: "Issue Card", icon: <CreditCard className="w-4 h-4" /> },
    { key: "exit", label: "Card Return", icon: <LogOut className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <img src="/images/card-issue-icon.svg" alt="Card" className="w-12 h-12" />
        <div>
          <h1 className="text-[26px] font-bold text-gray-900">Card Management</h1>
          <p className="text-[14px] text-gray-500">Issue or return cards</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-medium transition-all flex-1 justify-center ${activeTab === t.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Connection Bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white border border-gray-200 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${connState === "connected" ? "bg-green-500 animate-pulse-glow" : connState === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-gray-400"}`} />
          <span className="text-sm font-medium text-gray-900 capitalize">
            {connState === "connected" ? "Connected" : connState === "disconnected" ? "Disconnected" : connState === "connecting" ? "Connecting..." : "Error"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {connState === "disconnected" || connState === "error" ? (
            <button onClick={handleConnect} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" /> Connect
            </button>
          ) : (
            <button onClick={handleDisconnect} className="rounded-lg bg-gray-200 border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-300 transition-colors flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
          <button onClick={handleReset} disabled={connState !== "connected" || resetting}
            className="rounded-lg bg-gray-200 border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-300 transition-colors flex items-center gap-1.5 disabled:opacity-40">
            {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            {resetting ? "RS..." : "RS"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ===== LEFT PANEL ===== */}
        <div className="lg:col-span-2 space-y-4">

          {/* ===== ISSUE CARD TAB ===== */}
          {activeTab === "issue" && (
            <>
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 space-y-4">
                <h2 className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider" style={{ fontSize: "12px" }}>Card Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-gray-500 uppercase">Employee ID *</label>
                    <input value={empId} onChange={(e) => setEmpId(e.target.value.slice(0, 50))}
                      className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-[14px] text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors" style={{ height: "42px" }} placeholder="Employee ID" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-gray-500 uppercase">Name *</label>
                    <input value={empName} onChange={(e) => setEmpName(e.target.value.slice(0, 50))}
                      className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-[14px] text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors" style={{ height: "42px" }} placeholder="Full name" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-gray-500 uppercase">Department *</label>
                    <input value={empDept} onChange={(e) => setEmpDept(e.target.value.slice(0, 50))}
                      className="w-full rounded-[6px] border border-[#cbd5e1] bg-white px-4 text-[14px] text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors" style={{ height: "42px" }} placeholder="Department" />
                  </div>
                </div>
              </div>
              {issuing && (
                <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="font-mono font-bold text-blue-600">{issueStep}/{ISSUE_STEP_LABELS.length}</span>
                    <span>{issueStepMsg || "Starting..."}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {ISSUE_STEP_LABELS.map((_, i) => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i + 1 <= issueStep ? "bg-blue-500" : "bg-gray-200"}`} />
                    ))}
                  </div>
                  <div className="flex justify-between">
                    {ISSUE_STEP_LABELS.map((label, i) => (
                      <span key={label} className={`text-[9px] ${i + 1 <= issueStep ? "text-blue-600" : "text-gray-400"} ${i + 1 === issueStep ? "font-semibold" : ""}`}>{label}</span>
                    ))}
                  </div>
                </div>
              )}
              {result && (
                <div className={`rounded-xl p-4 text-sm font-medium flex items-start gap-3 animate-fade-in ${result.success ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                  {result.success ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
                  <span>
                    {result.message}
                    {result.warning && <span className="block text-xs font-normal text-amber-700 mt-1">{result.warning}</span>}
                  </span>
                </div>
              )}
              {/* A card sitting in the channel no longer blocks issuing — step 2
                  of the flow clears it with FC0 before dispensing. */}
              <button onClick={handleIssue}
                disabled={connState !== "connected" || issuing || !empId.trim() || !empName.trim() || !empDept.trim()}
                className="w-full rounded-xl px-6 py-3 text-[14px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2" style={{ height: "48px", backgroundColor: "#16a34a" }}>
                {issuing ? <><Loader2 className="animate-spin h-4 w-4" /> Issuing...</> : <><CreditCard className="w-5 h-5" /> Issue Card</>}
              </button>
            </>
          )}

          {/* ===== VISITOR EXIT TAB ===== */}
          {activeTab === "exit" && (
            <>
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider" style={{ fontSize: "12px" }}>Select Card to Return</h2>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setRecycleCount(0)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${recycleCount >= RECYCLE_MAX ? "bg-red-500 text-white hover:bg-red-600 animate-pulse" : recycleCount >= RECYCLE_MAX - 3 ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-green-500 text-white hover:bg-green-600"}`}>
                      <RotateCcw className="w-3.5 h-3.5" /> Recycle {recycleCount}/{RECYCLE_MAX}
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                      Live · {issuedCards.length} issued
                    </span>
                  </div>
                </div>

                <p className="text-sm text-gray-500">
                  Select the card below, then have the visitor insert it into the front bezel.
                  The card is collected into the <span className="font-medium text-gray-700">recycle box</span>.
                </p>

                {cardsError ? (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{cardsError}</span>
                  </div>
                ) : cardsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading issued cards...
                  </div>
                ) : issuedCards.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">
                    No issued cards to return
                    <span className="block text-xs text-gray-300 mt-1">Cards appear here as soon as they are issued</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {issuedCards.map((card) => (
                      <button key={card.id} onClick={() => setSelectedCard(card)} disabled={exitRunning}
                        className={`w-full text-left rounded-lg border p-3 transition-all disabled:opacity-60 ${selectedCard?.id === card.id ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500/20" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{card.employeeName}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {card.companyName || card.department}
                              {card.hostName ? ` • Host: ${card.hostName}` : ""}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Issued by {card.issuedBy}</p>
                          </div>
                          <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatDateTime(card.issuedAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {exitRunning && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-mono font-bold text-blue-600">{exitStep}/{CHECKOUT_STEP_LABELS.length}</span>
                      <span>{exitStepMsg}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {CHECKOUT_STEP_LABELS.map((_, i) => (
                        <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i + 1 <= exitStep ? "bg-blue-500" : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <div className="flex justify-between">
                      {CHECKOUT_STEP_LABELS.map((label, i) => (
                        <span key={label} className={`text-[9px] ${i + 1 <= exitStep ? "text-blue-600" : "text-gray-400"} ${i + 1 === exitStep ? "font-semibold" : ""}`}>{label}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {exitResult && (
                <div className={`rounded-xl p-4 text-sm font-medium flex items-start gap-3 animate-fade-in ${exitResult.success ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                  {exitResult.success ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
                  <span>
                    {exitResult.message}
                    {exitResult.warning && <span className="block text-xs font-normal text-amber-700 mt-1">{exitResult.warning}</span>}
                  </span>
                </div>
              )}
              <button onClick={handleVisitorExit}
                disabled={connState !== "connected" || exitRunning || hasCardInChannel || !selectedCard}
                className="w-full rounded-xl px-6 py-3 text-[14px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2" style={{ height: "48px", backgroundColor: "#2563eb" }}>
                {exitRunning ? <><Loader2 className="animate-spin h-4 w-4" /> Processing...</> : <><LogOut className="w-5 h-5" /> Check Out{selectedCard ? ` — ${selectedCard.employeeName}` : ""}</>}
              </button>
              {!selectedCard && !cardsError && issuedCards.length > 0 && (
                <p className="text-xs text-gray-400 text-center">Select a card above to enable check out</p>
              )}
            </>
          )}

          {channelNotice && (
            <div className={`text-xs flex items-center gap-1.5 ${activeTab === "issue" ? "text-amber-600" : "text-red-600"}`}>
              <AlertTriangle className="w-4 h-4" /> {channelNotice}
            </div>
          )}
        </div>

        {/* ===== RIGHT PANEL — Device Status ===== */}
        <div className="space-y-4">
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[12px] font-semibold text-gray-900 uppercase tracking-wider" style={{ fontSize: "12px" }}>K750 Device</h2>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 bg-white text-green-600 focus:ring-green-500" /> Auto
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className={`inline-block h-2 w-2 rounded-full ${connState === "connected" ? "bg-green-500" : connState === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-gray-400"}`} />
              <span className="capitalize">{connState}</span>
            </div>
            {!s && <p className="text-sm text-gray-400">Connect device to see status.</p>}
            {s && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 uppercase tracking-wider">Channel (b4)</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${b4 & 0x08 ? "bg-red-50 text-red-700 border border-red-200" : b4 & 0x04 ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                      {b4 & 0x08 ? "Box EMPTY" : b4 & 0x04 ? "Reader" : "Clear"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 uppercase tracking-wider">Machine (b1)</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${s.raw.byte1 === 0 ? "bg-green-50 text-green-700 border border-green-200" : "bg-yellow-50 text-yellow-700 border border-yellow-200"}`}>
                      {s.raw.byte1 === 0 ? "Idle" : "Busy"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 uppercase tracking-wider">Card Box (b3)</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${s.raw.byte3 === 0 ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                      {s.raw.byte3 === 0 ? "OK" : s.raw.byte3 & 0x04 ? "Overlap" : s.raw.byte3 & 0x02 ? "Jam" : "Error"}
                    </span>
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">Sensors</h4>
                  <div className="bg-gray-100 rounded-lg py-4 px-4">
                    <div className="flex items-center justify-center gap-0">
                      <span className="text-[9px] font-mono text-gray-500 mr-2">Stack</span>
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      {[{ label: "S1", bit: 0x01 }, { label: "S2", bit: 0x02 }, { label: "S3", bit: 0x04 }].map((sensor, idx) => (
                        <div key={sensor.label} className="flex items-center">
                          <div className="flex flex-col items-center mx-1">
                            <div className={`h-3 w-3 rounded-full border-2 transition-all ${!!(b4 & sensor.bit) ? "bg-green-400 border-green-300 shadow-[0_0_8px_rgba(74,222,128,0.6)]" : "bg-gray-300 border-gray-400"}`} />
                            <span className="text-[8px] font-mono text-gray-500 mt-1">{sensor.label}</span>
                          </div>
                          {idx < 2 && <><div className="h-px w-3 bg-gray-300" /><div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" /></>}
                        </div>
                      ))}
                      <div className="h-px w-3 bg-gray-300" />
                      <div className="h-0 w-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-gray-300" />
                      <span className="text-[9px] font-mono text-gray-500 ml-2">Bay</span>
                    </div>
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Raw Data (HEX)</div>
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

      {/* ===== LOGS SECTION ===== */}
      <div className="mt-6 space-y-4">
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button onClick={() => setLogTab("history")}
              className={`flex items-center gap-2 px-5 py-3 text-[13px] font-semibold transition-colors ${logTab === "history" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-gray-500 hover:text-gray-700"}`}>
              <Clock className="w-4 h-4" /> Issue History
              <span className="text-[10px] font-mono text-gray-400">({issueHistory.length})</span>
            </button>
            <button onClick={() => setLogTab("comm")}
              className={`flex items-center gap-2 px-5 py-3 text-[13px] font-semibold transition-colors ${logTab === "comm" ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50" : "text-gray-500 hover:text-gray-700"}`}>
              <Terminal className="w-4 h-4" /> Communication
              <span className="text-[10px] font-mono text-gray-400">({commLog.length})</span>
            </button>
            {logTab === "comm" && commLog.length > 0 && (
              <button onClick={() => downloadLog(commLog, `k750-comm-log-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`)}
                className="ml-auto flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
                Save Log
              </button>
            )}
          </div>

          {logTab === "history" && (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {issueHistory.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">No issue history yet</div>
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
                    {issueHistory.map((card) => (
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
          )}

          {logTab === "comm" && (
            <div style={{ maxHeight: 300, overflowY: "auto", backgroundColor: "#1e293b", padding: "8px 12px", fontFamily: "monospace", fontSize: 11, lineHeight: "18px" }}>
              {commLog.length === 0 ? (
                <div className="py-10 text-center text-sm italic" style={{ color: "#64748b" }}>No communication yet. Connect device and send commands.</div>
              ) : (
                commLog.map((entry, i) => {
                  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  const color = entry.direction === "TX" ? "#60a5fa" : entry.direction === "RX" ? "#4ade80" : "#fbbf24";
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
                })
              )}
              <div ref={commLogEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
