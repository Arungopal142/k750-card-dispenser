"use client";

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { K750Connection, type ConnectionState, type DeviceStatus } from "./k750-connection";
import { DispenseService } from "./k750-dispense";
import { CollectService } from "./k750-collect";
import { ToastContext } from "./toast-context";

interface K750ContextValue {
  conn: K750Connection;
  dispense: DispenseService;
  collect: CollectService;
  connState: ConnectionState;
  status: DeviceStatus | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const K750Context = createContext<K750ContextValue | null>(null);

let sharedConn: K750Connection | null = null;
let sharedDispense: DispenseService | null = null;
let sharedCollect: CollectService | null = null;

function getSharedServices() {
  if (!sharedConn) sharedConn = new K750Connection();
  if (!sharedDispense) sharedDispense = new DispenseService(sharedConn);
  if (!sharedCollect) sharedCollect = new CollectService(sharedConn);
  return { conn: sharedConn, dispense: sharedDispense, collect: sharedCollect };
}

export function getK750Conn(): K750Connection {
  return getSharedServices().conn;
}

export function getK750Dispense(): DispenseService {
  return getSharedServices().dispense;
}

export function getK750Collect(): CollectService {
  return getSharedServices().collect;
}

export function K750Provider({ children }: { children: ReactNode }) {
  const { conn, dispense, collect } = getSharedServices();
  const toastCtx = useContext(ToastContext);
  const [connState, setConnState] = useState<ConnectionState>(
    conn.isConnected ? "connected" : "disconnected"
  );
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    conn.onConnectionChange = setConnState;
    conn.onStatusChange = setStatus;
    conn.onAutoReconnect = () => {
      toastCtx?.toast("Device unresponsive — auto-reconnecting...", "warning");
    };
    if (conn.isConnected) conn.queryAP();
    return () => {
      conn.onConnectionChange = undefined;
      conn.onStatusChange = undefined;
      conn.onAutoReconnect = undefined;
    };
  }, [toastCtx, conn]);

  const value = useMemo(
    () => ({
      conn,
      dispense,
      collect,
      connState,
      status,
      connect: async () => { try { await conn.connect(); } catch { /* */ } },
      disconnect: async () => { await conn.disconnect(); setStatus(null); },
    }),
    [conn, dispense, collect, connState, status]
  );

  return <K750Context.Provider value={value}>{children}</K750Context.Provider>;
}

export function useK750() {
  const ctx = useContext(K750Context);
  if (!ctx) throw new Error("useK750 must be used within K750Provider");
  return ctx;
}
