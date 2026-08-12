"use client";

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { K750Service, type ConnectionState, type DeviceStatus } from "./k750-service";

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

export function K750Provider({ children }: { children: ReactNode }) {
  const serviceRef = useRef<K750Service>(getSharedService());
  const [connState, setConnState] = useState<ConnectionState>(
    serviceRef.current.isConnected ? "connected" : "disconnected"
  );
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    const svc = serviceRef.current;
    svc.onConnectionChange = setConnState;
    svc.onStatusChange = setStatus;
    if (svc.isConnected) {
      setConnState("connected");
      svc.queryAP();
    }
    return () => {
      svc.onConnectionChange = undefined;
      svc.onStatusChange = undefined;
    };
  }, []);

  const connect = async () => {
    try { await serviceRef.current.connect(); } catch { /* */ }
  };
  const disconnect = async () => {
    await serviceRef.current.disconnect();
    setStatus(null);
  };

  return (
    <K750Context.Provider value={{ service: serviceRef.current, connState, status, connect, disconnect }}>
      {children}
    </K750Context.Provider>
  );
}

export function useK750() {
  const ctx = useContext(K750Context);
  if (!ctx) throw new Error("useK750 must be used within K750Provider");
  return ctx;
}
