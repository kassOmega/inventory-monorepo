"use client";
// AiCoachDrawer — slide-over AI Business Coach chat.
// Streams answers from POST /ai/chat (SSE). The AI automatically replies in
// whatever language the user writes in (English, Amharic, Afaan Oromoo, etc.).
import api from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  messages: { sender: string; content: string; createdAt: string }[];
}

interface AiUsage {
  date: string;
  count: number;
  quota: number;
  remaining: number;
  limitReached: boolean;
}

interface AiEntitlement {
  enabled: boolean;
  trialEndsAt: string | null;
  inTrial: boolean;
  expired: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

export default function AiCoachDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [entitlement, setEntitlement] = useState<AiEntitlement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // AI is unusable when the tenant's entitlement is disabled/expired.
  const entitlementLocked = !entitlement?.enabled;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Refresh the session list and usage counter every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setError("");
    api
      .get("/ai/chat/sessions")
      .then((r) => setSessions(r.data ?? []))
      .catch(() => setSessions([]));
    api
      .get("/ai/usage")
      .then((r) => {
        setUsage(r.data ?? null);
        setLimitReached(Boolean(r.data?.limitReached));
        setEntitlement(r.data?.entitlement ?? null);
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setShowSessions(false);
    setError("");
  };

  const loadSession = async (id: string) => {
    try {
      const res = await api.get(`/ai/chat/sessions/${id}`);
      const data = res.data;
      setMessages(
        (data.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.sender === "USER" ? "user" : "assistant",
          content: m.content,
        })),
      );
      setSessionId(id);
      setShowSessions(false);
      setError("");
    } catch {
      setError("Failed to load that conversation.");
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await api.delete(`/ai/chat/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (sessionId === id) newChat();
    } catch {
      setError("Failed to delete conversation.");
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming || limitReached || usage?.limitReached || entitlementLocked) return;
    setInput("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", streaming: true },
    ]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const token = localStorage.getItem("token");
    const orgId = localStorage.getItem("activeOrganizationId");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { "X-Tenant-Id": orgId } : {}),
    };

    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
          sessionId: sessionId ?? undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => null);
        if (res.status === 429) {
          const msg =
            errData?.message ||
            "⚠️ Daily limit reached: You have used your daily AI queries. Quota resets at midnight.";
          setLimitReached(true);
          setUsage((prev) => (prev ? { ...prev, limitReached: true, remaining: 0 } : prev));
          setError(msg);
          setStreaming(false);
          return;
        }
        if (res.status === 403) {
          const msg =
            errData?.message ||
            "🤖 The AI feature is not enabled for this business. Contact the admin.";
          setEntitlement((prev) => (prev ? { ...prev, enabled: false } : prev));
          setError(msg);
          setStreaming(false);
          return;
        }
        throw new Error(errData?.message || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const appendDelta = (delta: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let payload: any;
          try {
            payload = JSON.parse(raw);
          } catch {
            continue;
          }
          if (payload.type === "delta") {
            appendDelta(payload.text ?? "");
          } else if (payload.type === "done") {
            setSessionId(payload.sessionId ?? null);
            if (payload.usage) {
              setUsage(payload.usage);
              setLimitReached(Boolean(payload.usage.limitReached));
            }
            if (payload.entitlement) {
              setEntitlement(payload.entitlement);
            }
          } else if (payload.type === "error") {
            setError(payload.message || "The assistant ran into a problem.");
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      );
      setStreaming(false);
      api
        .get("/ai/chat/sessions")
        .then((r) => setSessions(r.data ?? []))
        .catch(() => undefined);
      api
        .get("/ai/usage")
        .then((r) => {
          setUsage(r.data ?? null);
          setLimitReached(Boolean(r.data?.limitReached));
        })
        .catch(() => undefined);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err?.message || "Failed to reach the AI coach.");
      }
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      );
      setStreaming(false);
    }
  };

  if (!open) return null;


  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="relative h-full w-full sm:w-[430px] max-w-full bg-gray-50 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl" aria-hidden="true">
              🤖
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm sm:text-base truncate">
                AI Business Coach
              </h2>
              <p className="text-[11px] text-gray-400 truncate">
                Replies in your language — አማርኛ · Afaan Oromoo · English
              </p>
              {usage && (
                <span
                  className={`inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    usage.limitReached || limitReached || entitlementLocked
                      ? "bg-red-100 text-red-700 border-red-200"
                      : "bg-blue-100 text-blue-700 border-blue-200"
                  }`}
                >
                  {usage.count} / {usage.quota} queries used today
                  {entitlement?.trialEndsAt && !entitlementLocked
                    ? ` · trial ends ${entitlement.trialEndsAt}`
                    : entitlementLocked && entitlement?.expired
                      ? " · trial expired"
                      : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSessions((v) => !v)}
              className="p-2 rounded hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-medium"
            >
              {showSessions ? "New chat" : "History"}
            </button>
            <button
              onClick={newChat}
              className="p-2 rounded hover:bg-gray-700 text-gray-300 hover:text-white"
              aria-label="New chat"
              title="New chat"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-gray-700 text-gray-300 hover:text-white"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>


        {showSessions ? (
          /* Session history */
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 px-1">
              Past conversations
            </p>
            {sessions.length === 0 && (
              <p className="text-sm text-gray-400 px-1">
                No conversations yet.
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2 hover:border-blue-300 transition"
              >
                <button
                  onClick={() => loadSession(s.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {s.title || "Untitled chat"}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {new Date(s.createdAt).toLocaleString()}
                  </p>
                </button>
                <button
                  onClick={() => deleteSession(s.id)}
                  className="text-gray-400 hover:text-red-500 p-1"
                  aria-label="Delete"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Messages */
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
          >
            {messages.length === 0 && (
              <div className="text-center mt-10 px-4">
                <div className="text-4xl mb-3">🤖</div>
                <p className="text-gray-700 font-medium text-sm sm:text-base">
                  Ask me about your business
                </p>
                <p className="text-gray-400 text-xs sm:text-sm mt-2 leading-relaxed">
                  Inventory, staff efficiency, customer retention, dead stock,
                  reordering — I&apos;ll answer using your live data and in the
                  language you write in.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-blue-600 text-white rounded-br-md"
                      : "bg-white border border-gray-200 text-gray-800 rounded-bl-md"
                  }`}
                >
                  {m.content}
                  {m.streaming && (
                    <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-blue-500 animate-pulse" />
                  )}
                </div>
              </div>
            ))}
            {error && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
        )}


        {/* Input */}
        <div className="border-t border-gray-200 bg-white p-3">
          {entitlementLocked && (
            <div className="mb-2 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs leading-relaxed">
              <span aria-hidden="true">🤖</span>
              <span>
                {entitlement?.expired
                  ? `AI free trial ended on ${entitlement.trialEndsAt}. Contact the admin to extend or enable the AI feature.`
                  : "The AI feature is not enabled for this business. Contact the admin to enable it."}
              </span>
            </div>
          )}
          {(limitReached || usage?.limitReached) && (
            <div className="mb-2 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs leading-relaxed">
              <span aria-hidden="true">⚠️</span>
              <span>
                Daily limit reached: You have used {usage?.quota ?? 15}/
                {usage?.quota ?? 15} daily AI queries. Quota resets at midnight.
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
              disabled={streaming || limitReached || usage?.limitReached || entitlementLocked}
              placeholder={
                entitlementLocked
                  ? "AI is unavailable — contact the admin"
                  : limitReached || usage?.limitReached
                    ? "Daily limit reached — try again tomorrow"
                    : "Type your question…"
              }
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            />
            <button
              onClick={sendMessage}
              disabled={
                !input.trim() ||
                streaming ||
                limitReached ||
                usage?.limitReached ||
                entitlementLocked
              }
              className="bg-blue-600 text-white rounded-xl px-3.5 py-2.5 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            Grounded in your live sales &amp; inventory data · Powered by Gemini
          </p>
        </div>
      </div>
    </div>
  );
}

