"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import {
  getStats,
  getAllCardIssues,
  getEmployees,
  getAllUsers,
  type CardIssue,
  toDate,
} from "../../lib/firestore-service";
import {
  Users,
  CreditCard,

  Wifi,
  Activity,
  ArrowRight,
  Eye,
  Calendar,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export default function AdminDashboard() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalEmployees: 0,
    totalCardsIssued: 0,
    todayCardsIssued: 0,
    failedTransactions: 0,
    collectedCards: 0,
  });
  const [recent, setRecent] = useState<CardIssue[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) {
      router.replace("/login");
    }
  }, [profile, loading, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    const fetchStats = async () => {
      try {
        const [statsData, cards, employees, users] = await Promise.all([
          getStats(),
          getAllCardIssues(),
          getEmployees(),
          getAllUsers(),
        ]);
        const totalCards = cards.length;
        const today = new Date().toDateString();
        const todayCards = cards.filter(
          (c) =>
            c.issuedAt && toDate(c.issuedAt)?.toDateString() === today
        ).length;
        const failedCards = cards.filter((c) => c.status === "Failed").length;
        const collectedCards = cards.filter(
          (c) => c.status === "Collected" || c.checkoutAt
        ).length;
        setStats({
          totalUsers: users.length,
          totalEmployees: employees.length,
          totalCardsIssued: totalCards,
          todayCardsIssued: todayCards,
          failedTransactions: failedCards,
          collectedCards,
        });
        const myCards = cards.filter((c) => c.issuedById === profile?.uid);
        setRecent(myCards.slice(0, 8));
      } catch {
        /* */
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [profile]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading || !profile)
    return (
      <div className="p-6 text-gray-500 flex items-center gap-2">
        <Loader2 className="animate-spin h-5 w-5" />
        Loading...
      </div>
    );

  const cardsAvailable = 450 - stats.totalCardsIssued;
  const inventoryPercent = Math.round((stats.totalCardsIssued / 450) * 100);

  const kpis = [
    {
      label: "TOTAL EMPLOYEES",
      value: stats.totalEmployees,
      icon: Users,
      color: "text-purple-600",
      bg: "bg-purple-600/10",
      ring: "ring-purple-500/10",
    },
    {
      label: "CARDS ISSUED",
      value: stats.totalCardsIssued,
      icon: CreditCard,
      color: "text-blue-600",
      bg: "bg-blue-600/10",
      ring: "ring-blue-500/10",
    },
    {
      label: "DEVICE STATUS",
      value: "ONLINE",
      icon: Wifi,
      color: "text-emerald-600",
      bg: "bg-emerald-600/10",
      ring: "ring-emerald-500/10",
      isOnline: true,
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Issued":
        return "bg-green-50 text-green-700 border-green-200";
      case "Collected":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Failed":
        return "bg-red-50 text-red-700 border-red-200";
      case "Processing":
        return "bg-yellow-50 text-yellow-700 border-yellow-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">
              Dashboard
            </h1>
            <p className="text-[13px] text-[#64748b] mt-0.5">
              K750 Card Management Overview
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <span className="font-medium">
              {currentTime.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="text-gray-300">|</span>
            <span className="font-mono tabular-nums text-gray-600">
              {currentTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              })}
            </span>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="bg-white rounded-lg border border-[#e2e8f0] p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-4">
                  <div
                    className={`w-10 h-10 rounded-full ${kpi.bg} flex items-center justify-center ring-1 ${kpi.ring}`}
                  >
                    <Icon className={`w-5 h-5 ${kpi.color}`} />
                  </div>
                  {kpi.isOnline && (
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-[28px] font-bold text-[#0f172a] leading-none">
                  {kpi.value}
                </div>
                <div className="text-[11px] uppercase text-[#64748b] tracking-[0.05em] mt-2 font-semibold">
                  {kpi.label}
                </div>

              </div>
            );
          })}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity Panel */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-[#e2e8f0] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#e2e8f0]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#0f172a]">
                    Recent Activity
                  </h2>
                  <p className="text-[12px] text-[#64748b]">
                    Latest card issue transactions
                  </p>
                </div>
              </div>
              <a
                href="/admin/logs"
                className="flex items-center gap-1.5 text-[13px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                View All
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
            {recent.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Activity className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No recent activity</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] bg-gray-50/50">
                      <th className="text-left py-3 px-5 text-[11px] font-semibold text-[#64748b] uppercase tracking-[0.05em]">
                        Employee
                      </th>
                      <th className="text-left py-3 px-5 text-[11px] font-semibold text-[#64748b] uppercase tracking-[0.05em] hidden sm:table-cell">
                        Department
                      </th>
                      <th className="text-left py-3 px-5 text-[11px] font-semibold text-[#64748b] uppercase tracking-[0.05em] hidden md:table-cell">
                        Issued By
                      </th>
                      <th className="text-left py-3 px-5 text-[11px] font-semibold text-[#64748b] uppercase tracking-[0.05em]">
                        Time
                      </th>
                      <th className="text-left py-3 px-5 text-[11px] font-semibold text-[#64748b] uppercase tracking-[0.05em]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="py-3 px-5">
                          <span className="font-semibold text-[#0f172a]">
                            {r.employeeName}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-gray-500 hidden sm:table-cell">
                          {r.department}
                        </td>
                        <td className="py-3 px-5 text-gray-500 hidden md:table-cell">
                          {r.issuedBy}
                        </td>
                        <td className="py-3 px-5 text-gray-500 font-mono text-[12px]">
                          {(() => {
                            const d = toDate(r.issuedAt);
                            return d
                              ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
                              : "N/A";
                          })()}
                        </td>
                        <td className="py-3 px-5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadge(
                              r.status
                            )}`}
                          >
                            {r.status === "Issued" && (
                              <CheckCircle className="w-3 h-3" />
                            )}
                            {r.status === "Failed" && (
                              <AlertTriangle className="w-3 h-3" />
                            )}
                            {r.status === "Processing" && (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            )}
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Device Status Panel */}
          <div className="bg-white rounded-lg border border-[#e2e8f0] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-5 border-b border-[#e2e8f0]">
              <div className="w-8 h-8 rounded-full bg-emerald-600/10 flex items-center justify-center">
                <Wifi className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-[#0f172a]">
                  Device Status
                </h2>
                <p className="text-[12px] text-[#64748b]">
                  K750 Card Dispenser
                </p>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Device Name & Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-600/10 flex items-center justify-center">
                    <Wifi className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-[#0f172a]">
                      K750-001
                    </p>
                    <p className="text-[12px] text-[#64748b]">
                      Primary Dispenser
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[11px] font-bold text-emerald-700">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  ONLINE
                </span>
              </div>

              {/* Device Details */}
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-[12px] text-[#64748b] font-medium">
                    Connection
                  </span>
                  <span className="text-[13px] font-semibold text-[#0f172a]">
                    USB Serial
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-[12px] text-[#64748b] font-medium">
                    Last Response
                  </span>
                  <span className="text-[13px] font-semibold text-emerald-600">
                    1.2s ago
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[12px] text-[#64748b] font-medium">
                    Firmware
                  </span>
                  <span className="text-[13px] font-semibold text-[#0f172a]">
                    v2.4.1
                  </span>
                </div>
              </div>

              {/* Card Inventory */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] text-[#64748b] font-medium">
                    Card Inventory
                  </span>
                  <span className="text-[13px] font-bold text-[#0f172a]">
                    {stats.totalCardsIssued}/450
                  </span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      inventoryPercent > 90
                        ? "bg-red-500"
                        : inventoryPercent > 70
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${inventoryPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[11px] text-gray-400">
                    {inventoryPercent}% utilized
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {cardsAvailable} remaining
                  </p>
                </div>
              </div>

              {/* View Device Link */}
              <a
                href="/admin/device"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-[#e2e8f0] text-[13px] font-semibold text-[#0f172a] hover:bg-gray-50 hover:border-gray-300 transition-all"
              >
                <Eye className="w-4 h-4" />
                View Device
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
