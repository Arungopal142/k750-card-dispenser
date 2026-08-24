"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { Mail, Lock, AlertCircle, Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function UserLoginPage() {
  const { login, register, user, authError } = useAuth();
  const router = useRouter();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSubmitting(true);
    try {
      if (isRegister) await register(email, password, displayName);
      else await login(email, password);
      router.replace("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password")) setError("Invalid email or password");
      else if (msg.includes("auth/email-already-in-use")) setError("Email already registered");
      else if (msg.includes("auth/weak-password")) setError("Password must be at least 6 characters");
      else if (msg.includes("auth/user-not-found")) setError("No account found");
      else setError(msg);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="flex" style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {/* Left Panel - Hardware Showcase */}
      <div
        className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden"
        style={{
          width: "55%",
          height: "100%",
          backgroundColor: "#f1f5f9",
          backgroundImage:
            "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      >
        <div className="relative z-10 flex flex-col items-center space-y-8 px-8">
          {/* Product Image */}
          <img
            src="/images/k750-product.jpg"
            alt="K750 Card Dispenser"
            style={{
              height: "280px",
              width: "auto",
              borderRadius: "12px",
              boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            }}
          />

          <div className="text-center space-y-2">
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              VMS CARD DISPENSER
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
              }}
            >
              Enterprise Card Management Platform
            </p>
          </div>

          {/* Status Cards */}
          <div className="flex gap-3 flex-wrap justify-center">
            {/* Device Ready */}
            <div
              style={{
                backgroundColor: "white",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "16px",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#22c55e",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  Device Ready
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>K750-001</p>
              <p style={{ fontSize: "11px", color: "#94a3b8" }}>USB Serial Connected</p>
            </div>

            {/* System Ready */}
            <div
              style={{
                backgroundColor: "white",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "16px",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: "#22c55e",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  System Ready
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>All systems operational</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login */}
      <div
        className="flex flex-col items-center justify-center w-full lg:w-[45%] px-6"
        style={{ backgroundColor: "white", height: "100%" }}
      >
        <div style={{ maxWidth: "380px", width: "100%" }}>
          <div className="space-y-6">
            {/* Title Area */}
            <div>
              <h1
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                VMS CARD DISPENSER
              </h1>
              <p
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#2563eb",
                  marginTop: "2px",
                }}
              >
                Operator Portal
              </p>
              <div style={{ marginTop: "16px" }}>
                <p style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Welcome back</p>
                <p style={{ fontSize: "14px", color: "#64748b" }}>Sign in to continue</p>
              </div>
            </div>

            {/* Error Banner */}
            {(authError || error) && (
              <div
                className="flex items-center gap-2"
                style={{
                  backgroundColor: "rgba(239,68,68,0.08)",
                  border: "1px solid #EF4444",
                  borderRadius: "6px",
                  padding: "10px 12px",
                }}
              >
                <AlertCircle
                  className="flex-shrink-0"
                  style={{ width: "14px", height: "14px", color: "#EF4444" }}
                />
                <span style={{ fontSize: "13px", color: "#EF4444" }}>
                  {authError || error}
                </span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-1.5">
                  <label
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#374151",
                    }}
                  >
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    placeholder="Enter your name"
                    className="w-full"
                    style={{
                      backgroundColor: "white",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      height: "44px",
                      padding: "0 14px",
                      color: "#0f172a",
                      fontSize: "15px",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#cbd5e1")}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#374151",
                  }}
                >
                  <Mail style={{ width: "13px", height: "13px" }} />
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="operator@email.com"
                  className="w-full"
                  style={{
                    backgroundColor: "white",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    height: "44px",
                    padding: "0 14px",
                    color: "#0f172a",
                    fontSize: "14px",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#cbd5e1")}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#374151",
                  }}
                >
                  <Lock style={{ width: "13px", height: "13px" }} />
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    className="w-full"
                    style={{
                      backgroundColor: "white",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      height: "44px",
                      padding: "0 40px 0 14px",
                      color: "#0f172a",
                      fontSize: "15px",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#cbd5e1")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {showPassword ? <EyeOff style={{ width: "18px", height: "18px" }} /> : <Eye style={{ width: "18px", height: "18px" }} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2"
                style={{
                  backgroundColor: submitting ? "rgba(37,99,235,0.5)" : "#2563eb",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "15px",
                  height: "44px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: submitting ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (!submitting) e.currentTarget.style.backgroundColor = "#1d4ed8";
                }}
                onMouseLeave={(e) => {
                  if (!submitting) e.currentTarget.style.backgroundColor = "#2563eb";
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" style={{ width: "16px", height: "16px" }} />
                    Please wait...
                  </>
                ) : isRegister ? (
                  "Create Account"
                ) : (
                  <>
                    Sign In
                    <ArrowRight style={{ width: "16px", height: "16px" }} />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }} />
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>or</span>
              <div style={{ flex: 1, height: "1px", backgroundColor: "#e2e8f0" }} />
            </div>

            {/* Footer Links */}
            <div className="flex justify-between items-center" style={{ paddingTop: "4px" }}>
              <button
                onClick={() => { setIsRegister(!isRegister); setError(""); }}
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#0f172a")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
              >
                {isRegister ? "Already have an account? Sign in" : "New operator? Create account"}
              </button>
              <a
                href="/admin-login"
                className="flex items-center gap-1"
                style={{
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#2563eb",
                  textDecoration: "none",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#3b82f6")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#2563eb")}
              >
                Admin access
                <ArrowRight style={{ width: "12px", height: "12px" }} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
