"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { getAllCardIssues, toDate, type CardIssue, formatDateTime } from "../../lib/firestore-service";
import {
  CreditCard,
  Calendar,
  CheckCircle,
  Loader2,
  ArrowRight,
  Package,
  AlertTriangle,
} from "lucide-react";

export default function UserDashboard() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [totalIssued, setTotalIssued] = useState(0);
  const [todayIssued, setTodayIssued] = useState(0);
  const [collected, setCollected] = useState(0);
  const [recent, setRecent] = useState<CardIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    // Unguarded before: a rejected read (e.g. Firestore rules) became an
    // unhandled rejection and took the whole page down with a runtime overlay.
    const fetchStats = async () => {
      try {
        const cardIssues = await getAllCardIssues();
        if (cancelled) return;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayIssues = cardIssues.filter((c) => {
          const d = toDate(c.issuedAt);
          return d !== null && d >= todayStart;
        });
        setTotalIssued(cardIssues.filter((c) => c.status === "Issued").length);
        setTodayIssued(todayIssues.filter((c) => c.status === "Issued").length);
        setCollected(
          cardIssues.filter((c) => c.status === "Collected" || c.checkoutAt).length
        );
        setRecent(cardIssues.slice(0, 5));
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(
          msg.includes("permission") || msg.includes("insufficient")
            ? `Not allowed to read card records. Deploy the updated firestore.rules, and check that your user document has active: true. (${msg})`
            : msg.includes("index")
            ? `Firestore is missing an index for this query. Run "firebase deploy --only firestore:indexes", or use the link in this error — ${msg}`
            : `Could not load dashboard data: ${msg}`
        );
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [profile]);

  if (loading || !profile)
    return (
      <div className="p-6 text-gray-500 flex items-center gap-2">
        <Loader2 className="animate-spin h-5 w-5" />
        Loading...
      </div>
    );

  const statCards = [
    {
      label: "TOTAL ISSUED",
      value: totalIssued,
      icon: <CreditCard className="w-5 h-5 text-blue-600" />,
      color: "text-blue-600",
    },
    {
      label: "TODAY'S CARDS",
      value: todayIssued,
      icon: <Calendar className="w-5 h-5 text-green-600" />,
      color: "text-green-600",
    },
    {
      label: "COLLECTED",
      value: collected,
      icon: <CheckCircle className="w-5 h-5 text-cyan-600" />,
      color: "text-cyan-600",
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {loadError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-gray-900">Dashboard</h1>
          <p className="text-[14px] text-[#64748b] mt-1">
            Welcome back, {profile.displayName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/issue")}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            Issue Card
          </button>
          <button
            onClick={() => router.push("/dashboard/my-cards")}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 border border-[#e2e8f0] shadow-sm hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <Package className="w-4 h-4" />
            My Cards
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        {statCards.map((c) => (
          <div
            key={c.label}
            className="bg-white border border-[#e2e8f0] rounded-lg p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-50">
                {c.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-gray-300" />
            </div>
            <div className={`text-3xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-[12px] text-gray-500 mt-1 tracking-wide font-medium">
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-[#e2e8f0] rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-gray-900">Recent Activity</h2>
        </div>
        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <CreditCard className="w-10 h-10 mb-3" />
            <p className="text-sm">No cards issued yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-gray-50 text-gray-500">
                  <th className="text-left py-3 px-4 font-semibold">Employee</th>
                  <th className="text-left py-3 px-4 font-semibold hidden sm:table-cell">
                    Department
                  </th>
                  <th className="text-left py-3 px-4 font-semibold">Date / Time</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-gray-900 font-medium">
                      {c.employeeName}
                    </td>
                    <td className="py-3 px-4 text-gray-600 hidden sm:table-cell">
                      {c.department}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {c.issuedAt
                        ? formatDateTime(c.issuedAt)
                        : "N/A"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          c.status === "Collected"
                            ? "bg-blue-50 text-blue-700"
                            : c.status === "Failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-green-50 text-green-700"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            c.status === "Collected"
                              ? "bg-blue-500"
                              : c.status === "Failed"
                                ? "bg-red-500"
                                : "bg-green-500"
                          }`}
                        />
                        {c.status === "Collected" ? "Collected" : c.status}
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
