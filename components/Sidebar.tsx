"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { useK750 } from "../lib/k750-context";
import { useSidebar } from "../lib/sidebar-context";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  CreditCard,
  ClipboardList,
  UserCog,
  MonitorDot,
  Activity,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Minus,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const adminSections: NavSection[] = [
  { label: "OVERVIEW", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "CARD OPS", items: [
    { href: "/dashboard/issue", label: "Issue Card", icon: CreditCard },
    { href: "/admin/cards", label: "Card Records", icon: ClipboardList },
  ]},
  { label: "MANAGEMENT", items: [
    { href: "/admin/users", label: "Users", icon: UserCog },
  ]},
  { label: "DEVICE", items: [{ href: "/admin/device", label: "Device Status", icon: MonitorDot }] },
  { label: "MONITORING", items: [
    { href: "/admin/logs", label: "Activity Logs", icon: Activity },
    { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  ]},
  { label: "SYSTEM", items: [{ href: "/admin/settings", label: "Settings", icon: Settings }] },
];

const userSections: NavSection[] = [
  { label: "OVERVIEW", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "CARD OPS", items: [
    { href: "/dashboard/issue", label: "Issue Card", icon: CreditCard },
    { href: "/dashboard/my-cards", label: "My Cards", icon: ClipboardList },
  ]},
];

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const { profile, logout } = useAuth();
  const { connState } = useK750();
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebar();
  const [open, setOpen] = useState(false);
  const isAdmin = profile?.role === "admin";
  const sections = isAdmin ? adminSections : userSections;
  const isOnline = connState === "connected";

  const FONT_SIZES = [12, 13, 14, 15, 16] as const;
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    const saved = localStorage.getItem("app-font-size");
    if (saved) {
      setFontSize(Number(saved));
      document.documentElement.style.fontSize = `${saved}px`;
    }
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

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const navItemClass = (active: boolean, collapsedMode: boolean) =>
    `flex items-center gap-3 rounded-md text-[14px] font-medium transition-all ${
      collapsedMode ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
    } ${
      active
        ? "bg-blue-50 text-blue-600 border-l-2 border-blue-600"
        : "text-gray-500 hover:bg-gray-100"
    }`;

  return (
    <>
      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 inset-x-0 h-12 flex items-center px-4 z-40"
        style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}
      >
        <button onClick={() => setOpen(true)} className="p-1 mr-3" style={{ color: "#64748b" }}>
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center" style={{ width: 24, height: 24, borderRadius: 5, background: "#2563eb" }}>
            <CreditCard className="w-3 h-3 text-white" />
          </div>
          <h1 className="text-sm font-bold" style={{ color: "#0f172a" }}>VMS CARD DISPENSER</h1>
        </div>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.3)" }} onClick={() => setOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 w-64 flex flex-col z-50 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "#ffffff", borderRight: "1px solid #e2e8f0" }}
      >
        <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#2563eb" }}>
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-[13px] font-bold" style={{ color: "#0f172a" }}>VMS CARD DISPENSER</h1>
              <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>Management System</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="p-1" style={{ color: "#64748b" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.label}>
                <p className="text-[11px] font-medium uppercase tracking-wider px-3 py-2" style={{ color: "#64748b", letterSpacing: "0.08em" }}>{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((link) => {
                  const active = isActive(pathname, link.href);
                  const Icon = link.icon;
                  return (
                    <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={navItemClass(active, false)}>
                      <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 space-y-2" style={{ borderTop: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isOnline ? "#16a34a" : "#94a3b8" }} />
            <span className="text-xs font-medium" style={{ color: "#475569" }}>K750-001</span>
            <span className="text-[10px] font-medium uppercase ml-auto" style={{ color: isOnline ? "#16a34a" : "#94a3b8" }}>{isOnline ? "ONLINE" : "OFFLINE"}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] font-medium" style={{ color: "#64748b" }}>Font</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]}
                className="w-7 h-7 rounded border flex items-center justify-center transition-all disabled:opacity-30"
                style={{ borderColor: "#cbd5e1", background: "#fff" }}>
                <Minus className="w-3 h-3" style={{ color: "#475569" }} />
              </button>
              <span className="text-[11px] font-semibold min-w-[18px] text-center" style={{ color: "#0f172a" }}>{fontSize}</span>
              <button onClick={() => changeFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
                className="w-7 h-7 rounded border flex items-center justify-center transition-all disabled:opacity-30"
                style={{ borderColor: "#cbd5e1", background: "#fff" }}>
                <Plus className="w-3 h-3" style={{ color: "#475569" }} />
              </button>
            </div>
          </div>
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center px-1" : "px-2"}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium flex-shrink-0" style={{ background: "#eff6ff", color: "#2563eb" }}>
              {profile?.displayName?.charAt(0)?.toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: "#0f172a" }}>{profile?.displayName}</div>
                <div className="text-[11px] truncate" style={{ color: "#64748b" }}>{profile?.email}</div>
              </div>
            )}
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors" style={{ color: "#dc2626" }}>
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
            Logout
          </button>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 flex-col z-50 transition-all duration-300 ${collapsed ? "w-[60px]" : "w-[220px]"}`}
        style={{ background: "#ffffff", borderRight: "1px solid #e2e8f0" }}
      >
        {/* Brand */}
        <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#2563eb" }}>
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="text-[13px] font-bold whitespace-nowrap" style={{ color: "#0f172a" }}>VMS CARD DISPENSER</h1>
                <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>Management System</p>
              </div>
            )}
          </div>
          <div className={`flex items-center ${collapsed ? "hidden" : ""}`}>
            <button onClick={toggle} className="p-1 rounded-md transition-colors" style={{ color: "#64748b" }} title="Collapse sidebar">
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
          {collapsed && (
            <button onClick={toggle} className="p-1 rounded-md transition-colors" style={{ color: "#64748b" }} title="Expand sidebar">
              <ChevronsRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.label} className="mb-2">
              {!collapsed && (
                <p className="text-[11px] font-medium uppercase tracking-wider px-4 py-2" style={{ color: "#64748b", letterSpacing: "0.08em" }}>{section.label}</p>
              )}
              <div className="space-y-0.5 px-2">
                {section.items.map((link) => {
                  const active = isActive(pathname, link.href);
                  const Icon = link.icon;
                  return (
                    <Link key={link.href} href={link.href} title={collapsed ? link.label : undefined} className={navItemClass(active, collapsed)}>
                      <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                      {!collapsed && <span className="truncate">{link.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className={`${collapsed ? "px-2 py-3" : "p-3"} space-y-2`} style={{ borderTop: "1px solid #e2e8f0" }}>
          <div className={`flex items-center gap-2 ${collapsed ? "justify-center px-1" : "px-3"} py-2`}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isOnline ? "#16a34a" : "#94a3b8" }} />
            {!collapsed && (
              <>
                <span className="text-xs font-medium" style={{ color: "#475569" }}>K750-001</span>
                <span className="text-[10px] font-medium uppercase ml-auto" style={{ color: isOnline ? "#16a34a" : "#94a3b8" }}>{isOnline ? "ONLINE" : "OFFLINE"}</span>
              </>
            )}
          </div>
          {!collapsed && (
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] font-medium" style={{ color: "#64748b" }}>Font</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]}
                  className="w-7 h-7 rounded border flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ borderColor: "#cbd5e1", background: "#fff" }}>
                  <Minus className="w-3 h-3" style={{ color: "#475569" }} />
                </button>
                <span className="text-[11px] font-semibold min-w-[18px] text-center" style={{ color: "#0f172a" }}>{fontSize}</span>
                <button onClick={() => changeFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
                  className="w-7 h-7 rounded border flex items-center justify-center transition-all disabled:opacity-30"
                  style={{ borderColor: "#cbd5e1", background: "#fff" }}>
                  <Plus className="w-3 h-3" style={{ color: "#475569" }} />
                </button>
              </div>
            </div>
          )}
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center px-1" : "px-2"}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium flex-shrink-0" style={{ background: "#eff6ff", color: "#2563eb" }}>
              {profile?.displayName?.charAt(0)?.toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: "#0f172a" }}>{profile?.displayName}</div>
                <div className="text-[11px] truncate" style={{ color: "#64748b" }}>{profile?.email}</div>
              </div>
            )}
          </div>
          <button onClick={handleLogout} className={`w-full flex items-center gap-3 rounded-md text-[14px] font-medium transition-colors ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2"}`} style={{ color: "#dc2626" }} title={collapsed ? "Logout" : undefined}>
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
