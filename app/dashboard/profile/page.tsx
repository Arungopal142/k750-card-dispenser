"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../../lib/auth-context";
import { Loader2, Plus, Minus, Type } from "lucide-react";

const FONT_SIZES = [12, 13, 14, 15, 16] as const;
const FONT_LABELS: Record<number, string> = { 12: "Small", 13: "Medium-S", 14: "Medium", 15: "Medium-L", 16: "Large" };

export default function ProfilePage() {
  const { profile, loading } = useAuth();
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    const saved = localStorage.getItem("app-font-size");
    if (saved) setFontSize(Number(saved));
  }, []);

  const changeFontSize = (delta: number) => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev as typeof FONT_SIZES[number]);
      const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))];
      localStorage.setItem("app-font-size", String(next));
      document.documentElement.style.fontSize = `${next}px`;
      return next;
    });
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center gap-2 p-6 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-[26px] font-bold text-gray-900">Profile</h1>

      <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="flex justify-between text-[14px]">
          <span className="text-gray-500">Name</span>
          <span className="text-gray-900">{profile.displayName}</span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span className="text-gray-500">Email</span>
          <span className="text-gray-900">{profile.email}</span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span className="text-gray-500">Role</span>
          <span
            className={`font-mono px-2 py-0.5 rounded-full text-xs font-medium ${
              profile.role === "admin"
                ? "bg-purple-50 text-purple-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            {profile.role}
          </span>
        </div>
        <div className="flex justify-between text-[14px]">
          <span className="text-gray-500">Status</span>
          <span
            className={`font-mono px-2 py-0.5 rounded-full text-xs font-medium ${
              profile.active !== false
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {profile.active !== false ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-[14px] font-bold text-gray-900 mb-1">Display</h3>
          <p className="text-[13px] text-gray-500">Adjust text size across the app</p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Type className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-[13px] font-semibold text-gray-900">Font Size</p>
              <p className="text-[13px] text-gray-500">{FONT_LABELS[fontSize]} ({fontSize}px)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => changeFontSize(-1)}
              disabled={fontSize <= FONT_SIZES[0]}
              className="w-9 h-9 rounded-lg border border-gray-300 bg-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 active:bg-gray-100"
            >
              <Minus className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-[13px] font-semibold text-gray-900 min-w-[24px] text-center">{fontSize}</span>
            <button
              onClick={() => changeFontSize(1)}
              disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
              className="w-9 h-9 rounded-lg border border-gray-300 bg-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 active:bg-gray-100"
            >
              <Plus className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
