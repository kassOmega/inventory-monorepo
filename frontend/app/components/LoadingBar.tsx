"use client";
import { useEffect, useState } from "react";
import { onApiPendingChange } from "@/lib/api";

/**
 * Thin top progress bar that appears whenever any API request is in flight
 * (page navigation data loads, login, saves, etc.).
 */
export default function LoadingBar() {
  const [active, setActive] = useState(false);

  useEffect(() => onApiPendingChange((count) => setActive(count > 0)), []);

  if (!active) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5 bg-blue-500/20 overflow-hidden">
      <div className="h-full w-1/3 bg-blue-500 loading-bar-inner" />
    </div>
  );
}
