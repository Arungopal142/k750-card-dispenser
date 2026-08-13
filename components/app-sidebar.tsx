"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { useK750 } from "../lib/k750-context";
import { useSidebar } from "../lib/sidebar-context";
import { useState } from "react";
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
  {
    label: "OVERVIEW",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "CARD OPS",
    items: [
      { href: "/dashboard/issue", label: "Issue Card", icon: CreditCard },
      { href: "/admin/cards", label: "Card Records", icon: ClipboardList },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      { href: "/admin/users", label: "Users", icon: UserCog },
    ],
  },
  {
    label: "DEVICE",
    items: [{ href: "/admin/device", label: "Device Status", icon: MonitorDot }],
  },
  {
    label: "MONITORING",
    items: [
      { href: "/admin/logs", label: "Activity Logs", icon: Activity },
      { href: "/admin/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "SYSTEM",
    items: [{ href: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

const userSections: NavSection[] = [
  {
    label: "OVERVIEW",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "CARD OPS",
    items: [
      { href: "/dashboard/issue", label: "Issue Card", icon: CreditCard },
      { href: "/dashboard/my-cards", label: "My Cards", icon: ClipboardList },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

function NavItem({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className="flex items-center gap-3 rounded-md transition-all"
      style={{
        height: 40,
        paddingLeft: collapsed ? 0 : 12,
        paddingRight: collapsed ? 0 : 12,
        fontSize: 14,
        fontWeight: 500,
        justifyContent: collapsed ? "center" : "flex-start",
        background: active ? "#eff6ff" : "transparent",
        borderLeft: active ? "2px solid #2563eb" : "2px solid transparent",
        color: active ? "#2563eb" : "#64748b",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "#f1f5f9";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      <Icon className="flex-shrink-0" style={{ width: 18, height: 18 }} strokeWidth={1.5} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
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

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initials = profile?.displayName
    ? profile.displayName
        .split(" ")
        .map((w) => w.charAt(0))
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const sidebarContent = (
    <>
      {/* Brand */}
      <div
        style={{
          borderBottom: "1px solid #e2e8f0",
          background: "#ffffff",
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            height: 56,
            paddingLeft: collapsed ? 0 : 16,
            paddingRight: collapsed ? 0 : 12,
          }}
        >
          <div className={`flex items-center gap-3 ${collapsed ? "justify-center w-full" : ""}`}>
            <div
              className="flex-shrink-0 flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "#2563eb",
              }}
            >
              <CreditCard className="w-3.5 h-3.5 text-white" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="text-[14px] font-bold whitespace-nowrap" style={{ color: "#1e293b" }}>
                  VMS CARD DISPENSER
                </h1>
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
                  Management System
                </p>
              </div>
            )}
          </div>
          <div className={collapsed ? "hidden" : ""}>
            <button
              onClick={toggle}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#94a3b8" }}
              title="Collapse sidebar"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
          {collapsed && (
            <button
              onClick={toggle}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#94a3b8" }}
              title="Expand sidebar"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="mb-2">
            {!collapsed && (
              <p
                className="text-[11px] font-semibold uppercase px-4 py-2"
                style={{ color: "#64748b", letterSpacing: "0.08em" }}
              >
                {section.label}
              </p>
            )}
            <div className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <NavItem
                    key={item.href}
                    item={item}
                    active={active}
                    collapsed={collapsed}
                    onClick={collapsed ? undefined : () => setOpen(false)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div
        className={`${collapsed ? "px-2 py-3" : "p-3"} space-y-2`}
        style={{ borderTop: "1px solid #e2e8f0" }}
      >
        {/* Device status */}
        <div
          className={`flex items-center gap-2 ${collapsed ? "justify-center px-1" : "px-3"} py-2`}
        >
          <span
            className="flex-shrink-0"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isOnline ? "#22c55e" : "#94a3b8",
              boxShadow: isOnline ? "0 0 6px rgba(34,197,94,0.4)" : "none",
            }}
          />
          {!collapsed && (
            <>
              <span className="text-[13px] font-medium" style={{ color: "#475569" }}>
                K750-001
              </span>
              <span className="text-[11px] font-semibold uppercase ml-auto" style={{ color: isOnline ? "#22c55e" : "#94a3b8" }}>
                {isOnline ? "ONLINE" : "OFFLINE"}
              </span>
            </>
          )}
        </div>

        {/* User info */}
        <div className={`flex items-center gap-3 ${collapsed ? "justify-center px-1" : "px-2"}`}>
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#eff6ff",
              color: "#2563eb",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate" style={{ color: "#1e293b" }}>
                {profile?.displayName}
              </div>
              <div className="text-[11px] truncate capitalize" style={{ color: "#94a3b8" }}>
                {profile?.role}
              </div>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 rounded-md text-[14px] font-medium transition-colors ${
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2"
          }`}
          style={{ color: "#ef4444" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fef2f2";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut className="w-4 h-4" strokeWidth={1.5} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 inset-x-0 h-12 flex items-center px-4 z-40"
        style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}
      >
        <button
          onClick={() => setOpen(true)}
          className="p-1 mr-3 transition-colors"
          style={{ color: "#64748b" }}
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center"
            style={{ width: 24, height: 24, borderRadius: 5, background: "#2563eb" }}
          >
            <CreditCard className="w-3 h-3 text-white" />
          </div>
          <h1 className="text-sm font-bold" style={{ color: "#1e293b" }}>VMS CARD DISPENSER</h1>
        </div>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 backdrop-blur-sm"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 w-64 flex flex-col z-50 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#ffffff", borderRight: "1px solid #e2e8f0" }}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 56, borderBottom: "1px solid #e2e8f0" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center"
              style={{ width: 28, height: 28, borderRadius: 6, background: "#2563eb" }}
            >
              <CreditCard className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold" style={{ color: "#1e293b" }}>VMS CARD DISPENSER</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#64748b" }}>
                Management System
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 transition-colors"
            style={{ color: "#64748b" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider px-3 py-2" style={{ color: "#64748b", letterSpacing: "0.08em" }}>
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <NavItem
                      key={item.href}
                      item={item}
                      active={active}
                      collapsed={false}
                      onClick={() => setOpen(false)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 space-y-2" style={{ borderTop: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className="flex-shrink-0"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isOnline ? "#22c55e" : "#94a3b8",
                boxShadow: isOnline ? "0 0 6px rgba(34,197,94,0.4)" : "none",
              }}
            />
            <span className="text-[13px] font-medium" style={{ color: "#475569" }}>K750-001</span>
            <span className="text-[11px] font-semibold uppercase ml-auto" style={{ color: isOnline ? "#22c55e" : "#94a3b8" }}>{isOnline ? "ONLINE" : "OFFLINE"}</span>
          </div>

          <div className="flex items-center gap-3 px-2">
            <div
              className="flex-shrink-0 flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#eff6ff",
                color: "#2563eb",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate" style={{ color: "#1e293b" }}>
                {profile?.displayName}
              </div>
              <div className="text-[11px] truncate capitalize" style={{ color: "#94a3b8" }}>
                {profile?.role}
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors"
            style={{ color: "#ef4444" }}
          >
            <LogOut className="w-4 h-4" strokeWidth={1.5} />
            Logout
          </button>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 flex-col z-50 transition-all duration-300 ${
          collapsed ? "w-[60px]" : "w-[220px]"
        }`}
        style={{ background: "#ffffff", borderRight: "1px solid #e2e8f0" }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
