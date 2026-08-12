"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getActivityLogs, type ActivityLog, toDate as toDateFirestore, formatDateTime } from "../../../lib/firestore-service";
import { Loader2, Download, RefreshCw, FileText, Search } from "lucide-react";

function toDate(value: unknown): Date {
  const d = toDateFirestore(value);
  return d ?? new Date();
}

const PAGE_SIZE = 20;

export default function LogsPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    if (profile?.role === "admin") {
      const fetchLogs = async () => {
        try {
          const data = await getActivityLogs();
          setLogs(data);
        } catch {
          /* */
        }
      };
      fetchLogs();
      const interval = setInterval(fetchLogs, 10000);
      return () => clearInterval(interval);
    }
  }, [profile]);

  const handleRefresh = () => {
    getActivityLogs()
      .then((data) => setLogs(data))
      .catch(() => {});
  };

  const users = useMemo(() => [...new Set(logs.map((l) => l.userId).filter(Boolean))], [logs]);
  const actions = useMemo(() => [...new Set(logs.map((l) => l.action))], [logs]);

  const filtered = logs.filter((l) => {
    const matchUser = !filterUser || l.userId === filterUser;
    const matchAction = !filterAction || l.action === filterAction;
    let matchDate = true;
    if (filterDate && l.timestamp) {
      const d = toDate(l.timestamp);
      const filter = new Date(filterDate);
      matchDate = d.toDateString() === filter.toDateString();
    }
    const matchSearch =
      !search ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      (l.details || "").toLowerCase().includes(search.toLowerCase()) ||
      l.userId.toLowerCase().includes(search.toLowerCase());
    return matchUser && matchAction && matchDate && matchSearch;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportCSV = () => {
    const headers = ["Time", "User", "Action", "Details"];
    const rows = filtered.map((l) => [
      l.timestamp ? toDate(l.timestamp).toLocaleString() : "",
      l.userId || "",
      l.action,
      l.details || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !profile)
    return (
      <div style={{ padding: 24, color: "#64748b" }} className="flex items-center gap-2">
        <Loader2 className="animate-spin" style={{ width: 20, height: 20 }} />
        Loading...
      </div>
    );

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", margin: 0 }}>Activity Logs</h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: 0, marginTop: 2 }}>
                {filtered.length} record{filtered.length !== 1 ? "s" : ""} found
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={exportCSV}
                style={{
                  background: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#15803d")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#16a34a")}
              >
                <Download style={{ width: 14, height: 14 }} />
                Export CSV
              </button>
              <button
                onClick={handleRefresh}
                style={{
                  background: "#fff",
                  color: "#475569",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <RefreshCw style={{ width: 14, height: 14 }} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 20,
            alignItems: "center",
          }}
        >
          <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 280 }}>
            <Search
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                width: 16,
                height: 16,
                color: "#64748b",
                pointerEvents: "none",
              }}
            />
            <input
              placeholder="Search logs..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              style={{
                width: "100%",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "8px 12px 8px 32px",
                fontSize: 13,
                color: "#0f172a",
                outline: "none",
                height: 36,
                boxSizing: "border-box",
              }}
            />
          </div>
          <select
            value={filterUser}
            onChange={(e) => {
              setFilterUser(e.target.value);
              setPage(0);
            }}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0f172a",
              outline: "none",
              height: 36,
              minWidth: 160,
            }}
          >
            <option value="">All Users</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value);
              setPage(0);
            }}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0f172a",
              outline: "none",
              height: 36,
              minWidth: 160,
            }}
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => {
              setFilterDate(e.target.value);
              setPage(0);
            }}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0f172a",
              outline: "none",
              height: 36,
              minWidth: 160,
            }}
          />
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 24px" }}>
              <FileText style={{ width: 48, height: 48, color: "#cbd5e1", margin: "0 auto 12px" }} />
              <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>No activity logs</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <th style={{ textAlign: "left", padding: "12px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Time
                    </th>
                    <th style={{ textAlign: "left", padding: "12px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      User
                    </th>
                    <th style={{ textAlign: "left", padding: "12px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Action
                    </th>
                    <th style={{ textAlign: "left", padding: "12px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Details
                    </th>
                    <th style={{ textAlign: "left", padding: "12px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((l) => {
                    const isFailed = l.action.toLowerCase().includes("failed");
                    const isCheckout = l.action.toLowerCase().includes("checkout") || l.action.toLowerCase().includes("checked out");
                    const actionColor = isFailed
                      ? { bg: "rgba(220,38,38,0.1)", text: "#dc2626", dot: "#dc2626" }
                      : isCheckout
                      ? { bg: "rgba(37,99,235,0.1)", text: "#2563eb", dot: "#2563eb" }
                      : { bg: "rgba(22,163,74,0.1)", text: "#16a34a", dot: "#16a34a" };
                    const statusColor = isFailed ? "#dc2626" : "#16a34a";
                    return (
                      <tr
                        key={l.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
                          {l.timestamp ? toDate(l.timestamp).toLocaleString() : "N/A"}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#0f172a", fontWeight: 500 }}>{l.userId || "—"}</td>
                        <td style={{ padding: "14px 16px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "3px 10px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 600,
                              background: actionColor.bg,
                              color: actionColor.text,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: actionColor.dot,
                                flexShrink: 0,
                              }}
                            />
                            {l.action}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", color: "#475569", fontSize: 12 }}>{l.details || "—"}</td>
                        <td style={{ padding: "14px 16px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "3px 10px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 600,
                              background: isFailed ? "rgba(220,38,38,0.1)" : "rgba(22,163,74,0.1)",
                              color: statusColor,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: statusColor,
                                flexShrink: 0,
                              }}
                            />
                            {isFailed ? "Failed" : "Success"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 16,
              padding: "0 4px",
            }}
          >
            <span style={{ fontSize: 13, color: "#64748b" }}>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 13,
                  color: page === 0 ? "#cbd5e1" : "#475569",
                  cursor: page === 0 ? "not-allowed" : "pointer",
                  fontWeight: 500,
                }}
              >
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = page < 3 ? i : page - 2 + i;
                if (p >= totalPages) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    style={{
                      background: p === page ? "#2563eb" : "#fff",
                      border: p === page ? "1px solid #2563eb" : "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 13,
                      color: p === page ? "#fff" : "#475569",
                      cursor: "pointer",
                      fontWeight: 600,
                      minWidth: 36,
                    }}
                  >
                    {p + 1}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 13,
                  color: page >= totalPages - 1 ? "#cbd5e1" : "#475569",
                  cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                  fontWeight: 500,
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
