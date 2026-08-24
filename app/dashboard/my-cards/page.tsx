"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getMyCardIssues, type CardIssue, formatDateTime } from "../../../lib/firestore-service";
import { useK750 } from "../../../lib/k750-context";
import { Wifi, WifiOff, CreditCard, Package, CheckCircle } from "lucide-react";

export default function MyCardsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { connState, connect, disconnect } = useK750();
  const [cards, setCards] = useState<CardIssue[]>([]);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const fetchCards = async () => {
      const data = await getMyCardIssues(user.uid);
      setCards(data);
    };
    fetchCards();
    const interval = setInterval(fetchCards, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const stats = useMemo(() => {
    const issued = cards.filter((c) => c.status === "Issued").length;
    const collected = cards.filter((c) => c.status === "Collected").length;
    const processing = cards.filter((c) => c.status === "Processing").length;
    return { issued, collected, processing };
  }, [cards]);

  const handleConnect = async () => { try { await connect(); } catch { /* */ } };
  const handleDisconnect = async () => { await disconnect(); };

  if (loading || !profile) return <div className="p-4 md:p-6 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between">
        <div>
            <h1 className="text-[26px] font-bold text-gray-900" style={{ fontWeight: 700 }}>My Cards</h1>
          <p className="text-[13px]" style={{ color: "#64748b" }}>View and collect issued cards</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${connState === "connected" ? "bg-green-500 animate-pulse-glow" : connState === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-gray-400"}`} />
          <span className="text-xs text-gray-600 capitalize">{connState}</span>
          {connState === "disconnected" || connState === "error" ? (
            <button onClick={handleConnect} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors btn-primary flex items-center gap-1.5">
              <Wifi className="w-3 h-3" /> Connect
            </button>
          ) : (
            <button onClick={handleDisconnect} className="rounded-lg bg-gray-200 border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 transition-colors flex items-center gap-1.5">
              <WifiOff className="w-3 h-3" /> Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-lg" style={{ backgroundColor: "#eff6ff" }}>
            <CreditCard className="w-5 h-5" style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>Issued</p>
            <p className="text-[28px] font-bold text-gray-900">{stats.issued}</p>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-lg" style={{ backgroundColor: "#f0fdf4" }}>
            <CheckCircle className="w-5 h-5" style={{ color: "#22c55e" }} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>Collected</p>
            <p className="text-[28px] font-bold text-gray-900">{stats.collected}</p>
          </div>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-lg" style={{ backgroundColor: "#fefce8" }}>
            <Package className="w-5 h-5" style={{ color: "#eab308" }} />
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>Processing</p>
            <p className="text-[28px] font-bold text-gray-900">{stats.processing}</p>
          </div>
        </div>
      </div>

      {/* Cards Table */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        {cards.length === 0 ? (
          <div className="text-center py-16">
            <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-3" strokeWidth={1} />
            <p className="text-sm text-gray-500 font-medium">No cards issued yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 bg-gray-50/50">
                  <th className="text-left py-3.5 px-5 font-semibold">Employee ID</th>
                  <th className="text-left py-3.5 px-5 font-semibold">Name</th>
                  <th className="text-left py-3.5 px-5 font-semibold hidden sm:table-cell">Department</th>
                  <th className="text-left py-3.5 px-5 font-semibold hidden md:table-cell">Email</th>
                  <th className="text-left py-3.5 px-5 font-semibold hidden md:table-cell">Phone</th>
                  <th className="text-left py-3.5 px-5 font-semibold">Date</th>
                  <th className="text-left py-3.5 px-5 font-semibold">Status</th>
                  <th className="text-left py-3.5 px-5 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3.5 px-5 font-mono text-gray-900">{c.employeeId}</td>
                    <td className="py-3.5 px-5 text-gray-900 font-medium">{c.employeeName}</td>
                    <td className="py-3.5 px-5 text-gray-600 hidden sm:table-cell">{c.department}</td>
                    <td className="py-3.5 px-5 text-gray-600 hidden md:table-cell">{c.email || "-"}</td>
                    <td className="py-3.5 px-5 text-gray-600 hidden md:table-cell">{c.phone || "-"}</td>
                    <td className="py-3.5 px-5 text-gray-600">
                      {formatDateTime(c.issuedAt)}
                    </td>
                    <td className="py-3.5 px-5">
                      {c.status === "Collected" || c.checkoutAt ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          Collected
                        </span>
                      ) : c.status === "Processing" ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200">
                          Processing
                        </span>
                      ) : c.status === "Failed" ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                          Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                          Issued
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="text-[11px] text-gray-400">—</span>
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
