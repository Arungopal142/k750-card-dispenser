"use client";

import Sidebar from "../../components/Sidebar";
import { SidebarProvider, useSidebar } from "../../lib/sidebar-context";

function UserShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen" style={{ background: "#f8fafc" }}>
      <Sidebar />
      <main
        className={`transition-all duration-300 p-6 ${
          collapsed ? "md:ml-[60px]" : "md:ml-[220px]"
        }`}
      >
        {children}
      </main>
    </div>
  );
}

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <UserShell>{children}</UserShell>
    </SidebarProvider>
  );
}
