"use client";

import { createContext, useContext, useState } from "react";

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed((p) => !p) }}>
      {children}
    </SidebarContext.Provider>
  );
}

export const useSidebar = () => useContext(SidebarContext);
