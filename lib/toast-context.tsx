"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
}

interface ToastContextType {
  toast: (message: string, type?: "success" | "error" | "info" | "warning") => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

let nextToastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  const toast = useCallback((message: string, type: "success" | "error" | "info" | "warning" = "info") => {
    const id = ++nextToastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg animate-slide-in ${
            t.type === "success" ? "bg-green-600 text-white" :
            t.type === "error" ? "bg-red-600 text-white" :
            t.type === "warning" ? "bg-amber-500 text-white" :
            "bg-blue-600 text-white"
          }`}>
            {t.type === "success" ? "✓ " : t.type === "error" ? "✗ " : t.type === "warning" ? "⚠ " : "ℹ "}{t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
