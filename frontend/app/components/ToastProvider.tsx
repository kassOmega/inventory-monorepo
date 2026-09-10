"use client";
import { onApiError } from "@/lib/api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface Toast { id: number; message: string; type: "success" | "error" | "info" }

const ToastCtx = createContext<{
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let id = 0;

  const add = useCallback((message: string, type: Toast["type"]) => {
    const tid = ++id;
    setToasts((prev) => [...prev, { id: tid, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== tid)), 3000);
  }, []);

  // Show a toast for every API error that isn't already handled by a page,
  // so permission-denied and other failures are always visible to the user.
  useEffect(() => {
    return onApiError((message) => add(message, "error"));
  }, [add]);

  return (
    <ToastCtx.Provider value={{ success: (m) => add(m, "success"), error: (m) => add(m, "error"), info: (m) => add(m, "info") }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white animate-in ${
            t.type === "success" ? "bg-green-600" : t.type === "error" ? "bg-red-600" : "bg-blue-600"
          }`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}