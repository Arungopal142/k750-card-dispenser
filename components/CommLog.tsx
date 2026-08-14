"use client";

import { useState, useEffect, useRef } from "react";
import { getK750Service } from "../lib/k750-context";
import type { LogEntry } from "../lib/k750-service";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";

export default function CommLog() {
  const [commLog, setCommLog] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svc = getK750Service();
    if (!svc) return;
    const handler = (entry: LogEntry) => {
      setCommLog((prev) => [...prev.slice(-199), entry]);
    };
    svc.onLog = handler;
    return () => { svc.onLog = undefined; };
  }, []);

  useEffect(() => {
    if (!collapsed) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commLog, collapsed]);

  const downloadLog = () => {
    const lines = commLog.map((e) => {
      const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${time} ${e.direction} ${e.hex}${e.text ? " — " + e.text : ""}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `k750-comm-log-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed bottom-0 right-0 z-50" style={{ width: 420, maxWidth: "100vw" }}>
      <div className="rounded-t-lg shadow-lg border border-b-0 border-gray-200 overflow-hidden" style={{ backgroundColor: "#ffffff" }}>
        {/* Header */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
          style={{ borderBottom: collapsed ? "none" : "1px solid #e2e8f0" }}
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4" style={{ color: "#64748b" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>Communication Log</span>
            <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>({commLog.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {commLog.length > 0 && (
              <span
                onClick={(e) => { e.stopPropagation(); downloadLog(); }}
                className="text-[11px] text-blue-600 hover:text-blue-800 cursor-pointer px-2 py-0.5 rounded hover:bg-blue-50 transition-colors"
              >
                Save
              </span>
            )}
            {commLog.length > 0 && (
              <span
                onClick={(e) => { e.stopPropagation(); setCommLog([]); }}
                className="text-[11px] text-gray-500 hover:text-gray-700 cursor-pointer px-2 py-0.5 rounded hover:bg-gray-100 transition-colors"
              >
                Clear
              </span>
            )}
            {collapsed ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </button>

        {/* Log body */}
        {!collapsed && (
          <div style={{ maxHeight: 250, overflowY: "auto", backgroundColor: "#1e293b", padding: "8px 12px", fontFamily: "monospace", fontSize: 11, lineHeight: "18px" }}>
            {commLog.length === 0 ? (
              <div style={{ color: "#64748b", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>No communication yet.</div>
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
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
