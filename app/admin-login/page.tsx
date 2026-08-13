"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { Shield, Mail, Lock, AlertCircle, Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function AdminLoginPage() {
  const { login, user, profile, authError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Derived during render instead of pushed into state from an effect.
  const accessDenied = !!(user && profile && profile.role !== "admin");

  useEffect(() => {
    if (user && profile && profile.role === "admin") router.replace("/admin");
  }, [user, profile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password")) setError("Invalid email or password");
      else if (msg.includes("auth/user-not-found")) setError("No account found");
      else setError(msg);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#f8fafc" }}>
      {/* Left Panel */}
      <div
        className="hidden lg:flex flex-col items-center justify-center relative overflow-hidden"
        style={{
          width: "55%",
          backgroundColor: "#f1f5f9",
          backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(220,38,38,0.04) 0%, transparent 70%)" }} />
        <div className="relative z-10 flex flex-col items-center space-y-10 px-8">
          <div className="flex flex-col items-center space-y-5">
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
              <img src="/images/k750-product.jpg" alt="K750 Card Dispenser" className="w-[300px] h-[300px] object-cover" />
            </div>
            <div className="text-center space-y-2">
              <h2 style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>K750</h2>
              <p style={{ fontSize: "11px", fontWeight: 500, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>CARD DISPENSER</p>
              <p style={{ fontSize: "13px", color: "#64748b" }}>Enterprise Card Management Platform</p>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            {[{ label: "DEVICE READY" }, { label: "K750-001" }, { label: "USB SERIAL OK" }].map((card) => (
              <div key={card.label} className="flex items-center gap-2" style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#16a34a", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: "11px", color: "#475569" }}>{card.label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-6 items-center">
            <span className="flex items-center gap-1.5" style={{ fontSize: "12px", color: "#16a34a" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#16a34a", display: "inline-block" }} /> ONLINE
            </span>
            <span className="flex items-center gap-1.5" style={{ fontSize: "12px", color: "#16a34a" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#16a34a", display: "inline-block" }} /> READY
            </span>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex flex-col items-center justify-center w-full lg:w-[45%] px-6 py-12" style={{ backgroundColor: "#ffffff" }}>
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center" style={{ width: "40px", height: "40px", backgroundColor: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca" }}>
              <Shield className="w-5 h-5" style={{ color: "#dc2626" }} />
            </div>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a" }}>VMS CARD DISPENSER</h1>
              <p style={{ fontSize: "13px", fontWeight: 500, color: "#dc2626" }}>Admin Portal</p>
            </div>
            <p style={{ fontSize: "14px", color: "#64748b" }}>Welcome back. Sign in to continue.</p>
          </div>

          {(authError || error || accessDenied) && (
            <div className="flex items-center gap-2" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", padding: "10px 12px" }}>
              <AlertCircle className="flex-shrink-0" style={{ width: "14px", height: "14px", color: "#dc2626" }} />
              <span style={{ fontSize: "12px", color: "#dc2626" }}>
                {authError || error || "Access denied. Admin role required."}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5" style={{ fontSize: "12px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b" }}>
                <Mail style={{ width: "13px", height: "13px" }} /> Email
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@email.com"
                className="w-full" style={{ backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", height: "44px", padding: "0 14px", color: "#0f172a", fontSize: "15px", outline: "none" }} />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5" style={{ fontSize: "12px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b" }}>
                <Lock style={{ width: "13px", height: "13px" }} /> Password
              </label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="Min 6 characters"
                  className="w-full" style={{ backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", height: "44px", padding: "0 40px 0 14px", color: "#0f172a", fontSize: "15px", outline: "none" }} />
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
            <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2"
              style={{ backgroundColor: submitting ? "#94a3b8" : "#dc2626", color: "#ffffff", fontWeight: 600, fontSize: "15px", height: "44px", borderRadius: "6px", border: "none", cursor: submitting ? "not-allowed" : "pointer" }}>
              {submitting ? (<><Loader2 className="animate-spin" style={{ width: "16px", height: "16px" }} /> Please wait...</>) : (<>Admin Sign In <ArrowRight style={{ width: "16px", height: "16px" }} /></>)}
            </button>
          </form>

          <div className="flex justify-center" style={{ paddingTop: "8px" }}>
            <a href="/login" style={{ fontSize: "12px", color: "#64748b", textDecoration: "none" }}>Operator? Sign in here</a>
          </div>
        </div>
      </div>
    </div>
  );
}
