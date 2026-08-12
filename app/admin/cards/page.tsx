"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getAllCardIssues, type CardIssue, formatDateTime, toDate } from "../../../lib/firestore-service";
import { useK750 } from "../../../lib/k750-context";
import { Loader2, Search, Download, CreditCard, Wifi, WifiOff } from "lucide-react";

const COLORS = {
  bg: "#f8fafc",
  card: "#ffffff",
  borderSubtle: "#e2e8f0",
  borderDefault: "#cbd5e1",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textTertiary: "#64748b",
  accent: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  error: "#dc2626",
} as const;

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { dot: string; bg: string; text: string; label: string }> = {
    Issued: { dot: COLORS.success, bg: "#dcfce7", text: COLORS.success, label: "Issued" },
    Collected: { dot: COLORS.accent, bg: "#dbeafe", text: COLORS.accent, label: "Collected" },
    Processing: { dot: COLORS.warning, bg: "#fef3c7", text: COLORS.warning, label: "Processing" },
    Failed: { dot: COLORS.error, bg: "#fee2e2", text: COLORS.error, label: "Failed" },
  };
  const s = map[status] ?? map.Issued;
  return (
    <span
      style={{ backgroundColor: s.bg, color: s.text }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  );
}

export default function CardsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { connState, connect, disconnect } = useK750();
  const [cards, setCards] = useState<CardIssue[]>([]);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterDate, setFilterDate] = useState("");

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    const fetchCards = async () => {
      try {
        const cards = await getAllCardIssues();
        setCards(cards);
      } catch { /* */ }
    };
    fetchCards();
    const interval = setInterval(fetchCards, 10000);
    return () => clearInterval(interval);
  }, [profile]);

  const handleConnect = async () => { try { await connect(); } catch { /* */ } };
  const handleDisconnect = async () => { await disconnect(); };

  const departments = useMemo(() => [...new Set(cards.map((c) => c.department))], [cards]);

  const filtered = cards.filter((c) => {
    const matchSearch =
      !search ||
      c.employeeId.toLowerCase().includes(search.toLowerCase()) ||
      c.employeeName.toLowerCase().includes(search.toLowerCase());
    const matchDept = !filterDept || c.department === filterDept;
    let matchDate = true;
    if (filterDate && c.issuedAt) {
      const d = toDate(c.issuedAt);
      const filter = new Date(filterDate);
      matchDate = !!d && d.toDateString() === filter.toDateString();
    }
    return matchSearch && matchDept && matchDate;
  });

  const exportCSV = () => {
    const headers = ["Employee ID", "Name", "Department", "Issued By", "Date", "Status", "Checkout Time", "Checked Out By"];
    const rows = filtered.map((c) => [
      c.employeeId,
      c.employeeName,
      c.department,
      c.issuedBy,
      formatDateTime(c.issuedAt),
      c.status,
      formatDateTime(c.checkoutAt),
      c.checkedOutBy || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-issues-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !profile)
    return (
      <div style={{ backgroundColor: COLORS.bg }} className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2" style={{ color: COLORS.textTertiary }}>
          <Loader2 className="animate-spin h-5 w-5" />
          <span className="text-sm font-medium">Loading...</span>
        </div>
      </div>
    );

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: "100vh" }} className="p-6">
      <div className="max-w-[1280px] mx-auto space-y-5">

        {/* Header */}
        <div
          style={{ backgroundColor: COLORS.card, borderColor: COLORS.borderSubtle }}
          className="rounded-[8px] border px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div className="flex items-center gap-3.5">
            <div
              style={{ backgroundColor: "#eff6ff", color: COLORS.accent }}
              className="flex items-center justify-center w-10 h-10 rounded-[8px]"
            >
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h1 style={{ color: COLORS.textPrimary }} className="text-[24px] font-bold leading-tight">
                Card Issuance
              </h1>
              <p style={{ color: COLORS.textTertiary }} className="text-sm mt-0.5">
                {filtered.length} records found
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {connState === "connected" ? (
                <Wifi className="w-4 h-4" style={{ color: COLORS.success }} />
              ) : (
                <WifiOff className="w-4 h-4" style={{ color: COLORS.textTertiary }} />
              )}
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    connState === "connected"
                      ? COLORS.success
                      : connState === "connecting"
                        ? COLORS.warning
                        : COLORS.textTertiary,
                }}
              />
              <span style={{ color: COLORS.textTertiary }} className="text-xs capitalize">
                {connState}
              </span>
              {connState === "disconnected" || connState === "error" ? (
                <button
                  onClick={handleConnect}
                  style={{ backgroundColor: COLORS.accent, color: "#ffffff" }}
                  className="rounded-[8px] px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition-colors"
                >
                  Connect
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  style={{ backgroundColor: "#f1f5f9", border: `1px solid ${COLORS.borderDefault}`, color: COLORS.textSecondary }}
                  className="rounded-[8px] px-3.5 py-1.5 text-xs font-medium hover:bg-gray-200 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
            <button
              onClick={exportCSV}
              style={{ backgroundColor: COLORS.success, color: "#ffffff" }}
              className="rounded-[8px] px-4 py-2 text-xs font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div
          style={{ backgroundColor: COLORS.card, borderColor: COLORS.borderSubtle }}
          className="rounded-[8px] border px-5 py-4 flex flex-col sm:flex-row gap-3"
        >
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: COLORS.textTertiary }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                backgroundColor: COLORS.card,
                borderColor: COLORS.borderDefault,
                color: COLORS.textPrimary,
              }}
              className="w-full rounded-[8px] border pl-10 pr-4 py-2.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
              placeholder="Search by ID or name..."
            />
          </div>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            style={{
              backgroundColor: COLORS.card,
              borderColor: COLORS.borderDefault,
              color: COLORS.textPrimary,
            }}
            className="rounded-[8px] border px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{
              backgroundColor: COLORS.card,
              borderColor: COLORS.borderDefault,
              color: COLORS.textPrimary,
            }}
            className="rounded-[8px] border px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Main Table Card */}
        <div
          style={{ backgroundColor: COLORS.card, borderColor: COLORS.borderSubtle }}
          className="rounded-[8px] border shadow-sm"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider">
                    Employee ID
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider">
                    Name
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider hidden sm:table-cell">
                    Department
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider hidden md:table-cell">
                    Issued By
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider">
                    Date
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider hidden lg:table-cell">
                    Checkout
                  </th>
                  <th style={{ color: COLORS.textTertiary }} className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    style={{ borderBottom: `1px solid ${COLORS.borderSubtle}` }}
                    className="hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono" style={{ color: COLORS.textPrimary }}>
                      {c.employeeId}
                    </td>
                    <td className="py-3 px-4 font-medium" style={{ color: COLORS.textPrimary }}>
                      {c.employeeName}
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell" style={{ color: COLORS.textSecondary }}>
                      {c.department}
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell" style={{ color: COLORS.textSecondary }}>
                      {c.issuedBy}
                    </td>
                    <td className="py-3 px-4" style={{ color: COLORS.textTertiary }}>
                      {formatDateTime(c.issuedAt)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell" style={{ color: COLORS.textTertiary }}>
                      {c.checkoutAt
                        ? `${c.checkedOutBy ?? ""} \u2022 ${formatDateTime(c.checkoutAt)}`
                        : "\u2014"}
                    </td>
                    <td className="py-3 px-4">
                      <span style={{ color: "#94a3b8" }} className="text-[10px]">—</span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <CreditCard className="w-12 h-12" style={{ color: COLORS.borderDefault }} />
                        <p style={{ color: COLORS.textTertiary }} className="text-sm font-medium">
                          No card records found
                        </p>
                        <p style={{ color: COLORS.textTertiary }} className="text-xs">
                          Try adjusting your search or filter criteria.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filtered.length > 0 && (
            <div
              style={{ borderTop: `1px solid ${COLORS.borderSubtle}` }}
              className="px-5 py-3 flex items-center justify-between"
            >
              <p style={{ color: COLORS.textTertiary }} className="text-xs">
                Showing <span style={{ color: COLORS.textPrimary }} className="font-medium">{filtered.length}</span> of{" "}
                <span style={{ color: COLORS.textPrimary }} className="font-medium">{cards.length}</span> records
              </p>
              <p style={{ color: COLORS.textTertiary }} className="text-xs">
                {connState === "connected" ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS.success }} />
                    Device connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS.textTertiary }} />
                    Device disconnected
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
