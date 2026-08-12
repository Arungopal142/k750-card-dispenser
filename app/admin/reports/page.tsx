"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getAllCardIssues, type CardIssue, toDate, formatDateTime } from "../../../lib/firestore-service";
import { Loader2, Download, FileText } from "lucide-react";

type ReportType = "daily" | "weekly" | "monthly" | "department" | "user";

export default function ReportsPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<CardIssue[]>([]);
  const [reportType, setReportType] = useState<ReportType>("daily");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    if (profile?.role === "admin") {
      const fetchCards = async () => {
        try {
          const data = await getAllCardIssues();
          setCards(data);
        } catch { /* */ }
      };
      fetchCards();
      const interval = setInterval(fetchCards, 10000);
      return () => clearInterval(interval);
    }
  }, [profile]);

  const getDate = (c: CardIssue): Date | null => {
    return toDate(c.issuedAt);
  };

  const filtered = useMemo(() => {
    const now = new Date();
    return cards.filter((c) => {
      const d = getDate(c);
      if (!d) return false;
      let matchTime = true;
      if (reportType === "daily") matchTime = d.toDateString() === now.toDateString();
      else if (reportType === "weekly") matchTime = d >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      else if (reportType === "monthly")
        matchTime = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

      const matchStatus =
        !filterStatus ||
        c.status === filterStatus ||
        (filterStatus === "Collected" && c.checkoutAt);
      return matchTime && matchStatus;
    });
  }, [cards, reportType, filterStatus]);

  const summary = useMemo(
    () => ({
      total: filtered.length,
      issued: filtered.filter((c) => c.status === "Issued").length,
      collected: filtered.filter((c) => c.status === "Collected" || c.checkoutAt).length,
      failed: filtered.filter((c) => c.status === "Failed").length,
    }),
    [filtered]
  );

  const grouped = useMemo(() => {
    if (reportType === "department") {
      const map = new Map<string, CardIssue[]>();
      filtered.forEach((c) => {
        const arr = map.get(c.department) || [];
        arr.push(c);
        map.set(c.department, arr);
      });
      return Array.from(map.entries());
    }
    if (reportType === "user") {
      const map = new Map<string, CardIssue[]>();
      filtered.forEach((c) => {
        const arr = map.get(c.checkedOutBy || "Unknown") || [];
        arr.push(c);
        map.set(c.checkedOutBy || "Unknown", arr);
      });
      return Array.from(map.entries());
    }
    return [];
  }, [filtered, reportType]);

  const exportCSV = () => {
    const headers = [
      "Employee ID",
      "Name",
      "Department",
      "Issued By",
      "Issue Date",
      "Checkout Date",
      "Checked Out By",
      "Status",
    ];
    const rows = filtered.map((c) => [
      c.employeeId,
      c.employeeName,
      c.department,
      c.issuedBy,
      formatDateTime(c.issuedAt),
      formatDateTime(c.checkoutAt),
      c.checkedOutBy || "",
      c.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !profile)
    return (
      <div className="p-6 text-gray-500 flex items-center gap-2">
        <Loader2 className="animate-spin h-5 w-5" />
        Loading...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Card issuance analytics</p>
        </div>
        <button
          onClick={exportCSV}
          className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 transition-colors flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      <div className="flex gap-1 rounded-xl bg-white border border-gray-200 shadow-sm p-1">
        {(["daily", "weekly", "monthly", "department", "user"] as ReportType[]).map((t) => (
          <button
            key={t}
            onClick={() => setReportType(t)}
            className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-medium capitalize transition-colors ${
              reportType === t
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            {t === "user" ? "Operator-wise" : t === "department" ? "Dept-wise" : t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {["", "Issued", "Collected", "Failed"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatus === s
                ? "bg-blue-600 text-white"
                : "bg-gray-200 border border-gray-300 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
          <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Total</div>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{summary.issued}</div>
          <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Active (Issued)</div>
        </div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-center">
          <div className="text-2xl font-bold text-cyan-700">{summary.collected}</div>
          <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Collected</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
          <div className="text-2xl font-bold text-red-700">{summary.failed}</div>
          <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Failed</div>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
        {reportType === "department" || reportType === "user" ? (
          grouped.map(([group, items]) => (
            <div key={group} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                {group} <span className="text-gray-500 font-normal">({items.length} cards)</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                      <th className="text-left py-2.5 px-3">Employee</th>
                      <th className="text-left py-2.5 px-3">Date</th>
                      <th className="text-left py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 px-3 text-gray-900 font-medium">
                          {c.employeeName} <span className="text-gray-500">({c.employeeId})</span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-500">
                          {formatDateTime(c.issuedAt)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                              c.status === "Collected"
                                ? "bg-blue-50 text-blue-700"
                                : c.status === "Processing"
                                  ? "bg-yellow-50 text-yellow-700"
                                  : c.status === "Failed"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-green-50 text-green-700"
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="text-left py-2.5 px-3">Employee ID</th>
                  <th className="text-left py-2.5 px-3">Name</th>
                  <th className="text-left py-2.5 px-3 hidden sm:table-cell">Department</th>
                  <th className="text-left py-2.5 px-3 hidden md:table-cell">Issued By</th>
                  <th className="text-left py-2.5 px-3">Date</th>
                  <th className="text-left py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-mono text-gray-900">{c.employeeId}</td>
                    <td className="py-2.5 px-3 text-gray-900 font-medium">{c.employeeName}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden sm:table-cell">{c.department}</td>
                    <td className="py-2.5 px-3 text-gray-500 hidden md:table-cell">{c.issuedBy}</td>
                    <td className="py-2.5 px-3 text-gray-500">
                      {getDate(c)?.toLocaleString() || "N/A"}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                          c.status === "Collected"
                            ? "bg-blue-50 text-blue-700"
                            : c.status === "Processing"
                              ? "bg-yellow-50 text-yellow-700"
                              : c.status === "Failed"
                                ? "bg-red-50 text-red-700"
                                : "bg-green-50 text-green-700"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
