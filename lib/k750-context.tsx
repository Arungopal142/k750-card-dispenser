"use client";

import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { K750Connection, type ConnectionState, type DeviceStatus, type NfcState } from "./k750-connection";
import { DispenseService } from "./k750-dispense";
import { CollectService } from "./k750-collect";
import { ReadCardService } from "./k750-readcard";
import { ToastContext } from "./toast-context";

interface K750ContextValue {
  conn: K750Connection;
  dispense: DispenseService;
  collect: CollectService;
  readCard: ReadCardService;
  connState: ConnectionState;
  status: DeviceStatus | null;
  nfc: NfcState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const K750Context = createContext<K750ContextValue | null>(null);

let sharedConn: K750Connection | null = null;
let sharedDispense: DispenseService | null = null;
let sharedCollect: CollectService | null = null;
let sharedReadCard: ReadCardService | null = null;

function getSharedServices() {
  if (!sharedConn) sharedConn = new K750Connection();
  if (!sharedDispense) sharedDispense = new DispenseService(sharedConn);
  if (!sharedCollect) sharedCollect = new CollectService(sharedConn);
  if (!sharedReadCard) sharedReadCard = new ReadCardService(sharedConn);
  return { conn: sharedConn, dispense: sharedDispense, collect: sharedCollect, readCard: sharedReadCard };
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

export function getK750ReadCard(): ReadCardService {
  return getSharedServices().readCard;
}

export function K750Provider({ children }: { children: ReactNode }) {
  const { conn, dispense, collect, readCard } = getSharedServices();
  const toastCtx = useContext(ToastContext);
  const [connState, setConnState] = useState<ConnectionState>(
    conn.isConnected ? "connected" : "disconnected"
  );
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [nfc, setNfc] = useState<NfcState>(conn.nfcState);
  const autoReadRef = useRef(false);

  useEffect(() => {
    conn.onConnectionChange = setConnState;
    conn.onStatusChange = setStatus;
    conn.onNfcStateChange = setNfc;
    conn.onAutoReconnect = () => {
      toastCtx?.toast("Device unresponsive — auto-reconnecting...", "warning");
    };
    if (conn.isConnected) conn.queryAP();
    return () => {
      conn.onConnectionChange = undefined;
      conn.onStatusChange = undefined;
      conn.onNfcStateChange = undefined;
      conn.onAutoReconnect = undefined;
    };
  }, [toastCtx, conn]);

  // Read the UID as soon as a card arrives at the reader, so the status panel
  // shows a live result rather than waiting for someone to press a button.
  // Skipped while a flow owns the device — the issue flow does its own read —
  // and guarded so only one auto-read is in flight per card.
  useEffect(() => {
    if (connState !== "connected") return;
    if (nfc.card !== "present") return;
    if (autoReadRef.current) return;
    if (conn.isBusy || dispense.isFlowBusy || collect.isFlowBusy || readCard.isBusy) return;

    autoReadRef.current = true;
    conn
      .readNfcCard({ requireCardAtReader: false })
      .catch(() => { /* state is published by readNfcCard either way */ })
      .finally(() => { autoReadRef.current = false; });
    // `status` is in the deps so a poll that lands while a flow owns the device
    // retries on the next tick instead of giving up on this card.
  }, [connState, nfc.card, status, conn, dispense, collect, readCard]);

  const value = useMemo(
    () => ({
      conn,
      dispense,
      collect,
      readCard,
      connState,
      status,
      nfc,
      connect: async () => { try { await conn.connect(); } catch { /* */ } },
      disconnect: async () => { await conn.disconnect(); setStatus(null); },
    }),
    [conn, dispense, collect, readCard, connState, status, nfc]
  );

  return <K750Context.Provider value={value}>{children}</K750Context.Provider>;
}

export function useK750() {
  const ctx = useContext(K750Context);
  if (!ctx) throw new Error("useK750 must be used within K750Provider");
  return ctx;
}
