"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getSettings, updateSettings } from "../../../lib/firestore-service";
import { Loader2, Settings } from "lucide-react";

type TabKey = "general" | "device" | "security";

export default function SettingsPage() {
  const { profile, loading, logout } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [enableDispenser, setEnableDispenser] = useState(true);
  const [allowIssuance, setAllowIssuance] = useState(true);
  const [allowCollection, setAllowCollection] = useState(true);

  const [deviceName, setDeviceName] = useState("K750-001");
  const [connection, setConnection] = useState("COM3");
  const [baudRate, setBaudRate] = useState("9600");

  const [maxCapacity, setMaxCapacity] = useState("500");
  const [lowThreshold, setLowThreshold] = useState("50");
  const [criticalThreshold, setCriticalThreshold] = useState("10");

  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [auditLogging, setAuditLogging] = useState(true);

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  useEffect(() => {
    if (profile?.role === "admin") {
      getSettings()
        .then((data) => {
          if (data) {
            setEnableDispenser((data.enableDispenser as boolean) ?? true);
            setAllowIssuance((data.allowIssuance as boolean) ?? true);
            setAllowCollection((data.allowCollection as boolean) ?? true);
            setDeviceName((data.deviceName as string) ?? "K750-001");
            setConnection((data.connection as string) ?? "COM3");
            setBaudRate((data.baudRate as string) ?? "9600");
            setMaxCapacity((data.maxCapacity as string) ?? "500");
            setLowThreshold((data.lowThreshold as string) ?? "50");
            setCriticalThreshold((data.criticalThreshold as string) ?? "10");
            setSessionTimeout((data.sessionTimeout as string) ?? "30");
            setAuditLogging((data.auditLogging as boolean) ?? true);
          }
        })
        .catch(() => {});
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    await updateSettings({
      enableDispenser,
      allowIssuance,
      allowCollection,
      deviceName,
      connection,
      baudRate,
      maxCapacity,
      lowThreshold,
      criticalThreshold,
      sessionTimeout,
      auditLogging,
    });
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/admin-login");
  };

  if (loading || !profile) {
    return (
      <div style={{ padding: 24, color: "#64748b" }} className="flex items-center gap-2">
        <Loader2 className="animate-spin" style={{ width: 20, height: 20 }} />
        Loading...
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "general", label: "General" },
    { key: "device", label: "Device" },
    { key: "security", label: "Security" },
  ];

  const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "#2563eb" : "#cbd5e1",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      />
    </button>
  );

  const inputStyle = {
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 13,
    color: "#0f172a",
    outline: "none",
    width: "100%",
    height: 36,
    boxSizing: "border-box" as const,
  };

  const renderGeneral = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
          Card Dispenser
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Configure card dispenser behavior
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", margin: 0 }}>Enable Dispenser</p>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>Turn on/off the card dispenser device</p>
        </div>
        <ToggleSwitch checked={enableDispenser} onChange={setEnableDispenser} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", margin: 0 }}>Allow Issuance</p>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>Allow cards to be issued to users</p>
        </div>
        <ToggleSwitch checked={allowIssuance} onChange={setAllowIssuance} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", margin: 0 }}>Allow Collection</p>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>Allow cards to be collected/returned</p>
        </div>
        <ToggleSwitch checked={allowCollection} onChange={setAllowCollection} />
      </div>
    </div>
  );

  const renderDevice = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
          Device
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Device connection and hardware settings
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Device Name</label>
        <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} style={inputStyle} />
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Connection</label>
        <div
          style={{
            ...inputStyle,
            display: "flex",
            alignItems: "center",
            background: "#f8fafc",
            cursor: "default",
          }}
        >
          <span style={{ fontSize: 13, color: "#475569" }}>{connection}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Connected</span>
        </div>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Baud Rate</label>
        <input value={baudRate} onChange={(e) => setBaudRate(e.target.value)} style={inputStyle} />
      </div>
    </div>
  );

  const renderSecurity = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
          Card Settings
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Capacity and threshold configuration
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Maximum Capacity</label>
        <input type="number" value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} style={inputStyle} />
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Low Threshold</label>
        <input type="number" value={lowThreshold} onChange={(e) => setLowThreshold(e.target.value)} style={inputStyle} />
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Critical Threshold</label>
        <input type="number" value={criticalThreshold} onChange={(e) => setCriticalThreshold(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
          Security
        </h3>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Session and audit configuration
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>Session Timeout (minutes)</label>
        <input type="number" value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", margin: 0 }}>Audit Logging</p>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0, marginTop: 2 }}>Log all user actions for audit trail</p>
        </div>
        <ToggleSwitch checked={auditLogging} onChange={setAuditLogging} />
      </div>
    </div>
  );

  const tabContent: Record<TabKey, () => React.ReactNode> = {
    general: renderGeneral,
    device: renderDevice,
    security: renderSecurity,
  };

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Settings style={{ width: 22, height: 22, color: "#fff" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", margin: 0 }}>Settings</h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: 0, marginTop: 2 }}>
                Configure system preferences
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div
            style={{
              width: 180,
              flexShrink: 0,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? "#2563eb" : "#475569",
                  background: activeTab === tab.key ? "#eff6ff" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderLeft: activeTab === tab.key ? "3px solid #2563eb" : "3px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 32,
              }}
            >
              {tabContent[activeTab]()}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 32,
                  paddingTop: 24,
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <button
                  onClick={handleLogout}
                  style={{
                    background: "rgba(220,38,38,0.08)",
                    color: "#dc2626",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(220,38,38,0.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(220,38,38,0.08)")}
                >
                  Logout
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: saved ? "#16a34a" : "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 24px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "background 0.2s",
                  }}
                >
                  {saving && <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />}
                  {saved ? "Saved!" : "Save Settings"}
                </button>
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 24,
                marginTop: 16,
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>Account</h3>
              <div style={{ fontSize: 13, color: "#475569", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#64748b" }}>Logged in as:</span>
                  <span style={{ color: "#0f172a", fontWeight: 500 }}>{profile.email}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#64748b" }}>Role:</span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: profile.role === "admin" ? "rgba(220,38,38,0.1)" : "rgba(37,99,235,0.1)",
                      color: profile.role === "admin" ? "#dc2626" : "#2563eb",
                    }}
                  >
                    {profile.role}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
