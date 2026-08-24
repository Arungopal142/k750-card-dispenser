"use client";

import { useEffect } from "react";

export default function FontSizeLoader() {
  useEffect(() => {
    const saved = localStorage.getItem("app-font-size");
    if (saved) {
      document.documentElement.style.fontSize = `${saved}px`;
    }
  }, []);
  return null;
}
