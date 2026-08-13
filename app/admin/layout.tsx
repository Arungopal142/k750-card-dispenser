"use client";

import Sidebar from "../../components/Sidebar";
import { SidebarProvider, useSidebar } from "../../lib/sidebar-context";

function AdminShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen" style={{ background: "#f8fafc" }}>
      <Sidebar />
      <main
        className={`transition-all duration-300 p-4 md:p-6 lg:p-8 ${
          collapsed ? "md:ml-[60px]" : "md:ml-[220px]"
        }`}
      >
        {children}
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AdminShell>{children}</AdminShell>
    </SidebarProvider>
  );
}
