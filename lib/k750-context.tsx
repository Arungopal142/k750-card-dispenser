"use client";

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { K750Service, type ConnectionState, type DeviceStatus } from "./k750-service";
import { ToastContext } from "./toast-context";

interface K750ContextValue {
  service: K750Service;
  connState: ConnectionState;
  status: DeviceStatus | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const K750Context = createContext<K750ContextValue | null>(null);

let sharedService: K750Service | null = null;
function getSharedService(): K750Service {
  if (!sharedService) sharedService = new K750Service();
  return sharedService;
}

/**
 * The same singleton the provider hands out. Use this inside effects that need
 * to attach callbacks to the service (onLog, …) so the mutation does not target
 * a value captured from render scope.
 */
export function getK750Service(): K750Service {
  return getSharedService();
}

export function K750Provider({ children }: { children: ReactNode }) {
  // The service is a module-level singleton, so read it directly instead of
  // through a ref — reading ref.current during render is not allowed.
  const service = getSharedService();
  const toastCtx = useContext(ToastContext);
  const [connState, setConnState] = useState<ConnectionState>(
    service.isConnected ? "connected" : "disconnected"
  );
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    // Read the singleton here rather than closing over a render-scope value.
    const svc = getSharedService();
    svc.onConnectionChange = setConnState;
    svc.onStatusChange = setStatus;
    svc.onAutoReconnect = () => {
      toastCtx?.toast("Device unresponsive — auto-reconnecting...", "warning");
    };
    // No setConnState here: the useState initialiser above already seeds the
    // connected state, and calling it synchronously in an effect just triggers
    // an extra render pass.
    if (svc.isConnected) svc.queryAP();
    return () => {
      svc.onConnectionChange = undefined;
      svc.onStatusChange = undefined;
      svc.onAutoReconnect = undefined;
    };
  }, [toastCtx]);

  const value = useMemo(
    () => ({
      service,
      connState,
      status,
      connect: async () => { try { await service.connect(); } catch { /* */ } },
      disconnect: async () => { await service.disconnect(); setStatus(null); },
    }),
    [service, connState, status]
  );

  return <K750Context.Provider value={value}>{children}</K750Context.Provider>;
}

export function useK750() {
  const ctx = useContext(K750Context);
  if (!ctx) throw new Error("useK750 must be used within K750Provider");
  return ctx;
}
