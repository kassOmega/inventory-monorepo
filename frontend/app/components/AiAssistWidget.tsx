"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
const GUEST_KEY = "kass_assist_guest";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface Status {
  remaining: number;
  limit: number;
  used: number;
}

function getGuestId(): string {
  try {
    let id = window.localStorage.getItem(GUEST_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `g-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return `g-${Date.now()}`;
  }
}

export default function AiAssistWidget() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === "am" ? "am" : "en";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [quotaError, setQuotaError] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const guestId = useMemo(getGuestId, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/ai/assist/status?guestId=${encodeURIComponent(guestId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = (await res.json()) as Status;
        setStatus(data);
        setQuotaError(data.remaining <= 0);
      }
    } catch {
      /* backend offline — widget keeps working silently */
    }
  }, [guestId]);

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, loading, open]);

  const remaining = status?.remaining ?? 5;
  const limit = status?.limit ?? 5;
  const exhausted = quotaError || remaining <= 0;

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (utterRef.current) {
      utterRef.current.onend = null;
      utterRef.current.onerror = null;
      utterRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const readAloud = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window)) return;
      if (speaking) stopSpeaking();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === "am" ? "am-ET" : "en-US";
      utter.rate = 0.92;
      utter.onend = () => {
        utterRef.current = null;
        setSpeaking(false);
      };
      utter.onerror = () => {
        utterRef.current = null;
        setSpeaking(false);
      };
      utterRef.current = utter;
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
    },
    [lang, speaking, stopSpeaking],
  );

  const send = useCallback(
    async (rawText?: string) => {
      const text = (rawText ?? input).trim();
      if (!text || loading || exhausted) return;
      setInput("");
      const userMsg: Message = { role: "user", text };
      const base = [...messages, userMsg].slice(-8);
      setMessages(base);
      setLoading(true);
      setStreamText("");
      let acc = "";
      try {
        const res = await fetch(`${API_BASE}/ai/assist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestId,
            message: text,
            lang,
            history: base
              .filter((m) => m !== userMsg || m.text === text)
              .map((m) => ({
                role: m.role === "user" ? "user" : "model",
                text: m.text,
              })),
          }),
        });
        if (res.status === 429) {
          setQuotaError(true);
          setStatus({ used: limit, limit, remaining: 0 });
          const msg = t("assist.exhausted");
          acc = msg;
          setMessages((prev) => [...prev, { role: "assistant", text: msg }]);
          return;
        }
        if (!res.ok || !res.body) throw new Error("bad response");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let final: Status | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const line = evt.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as {
                type: string;
                text?: string;
                remaining?: number;
                limit?: number;
              };
              if (payload.type === "delta" && payload.text) {
                acc += payload.text;
                setStreamText(acc);
              } else if (payload.type === "done") {
                final = {
                  remaining: payload.remaining ?? remaining,
                  limit: payload.limit ?? limit,
                  used: (payload.limit ?? limit) - (payload.remaining ?? remaining),
                };
              } else if (payload.type === "error") {
                throw new Error(payload.text ?? "stream error");
              }
            } catch {
              /* ignore malformed event */
            }
          }
        }
        if (final) {
          setStatus(final);
          setQuotaError(final.remaining <= 0);
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: acc || t("assist.errorGeneric") },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: t("assist.errorGeneric") },
        ]);
      } finally {
        setStreamText(null);
        setLoading(false);
      }
    },
    [input, loading, exhausted, messages, guestId, lang, remaining, limit, t],
  );

  const chips = [
    "assist.chipWhat",
    "assist.chipHow",
    "assist.chipHelp",
    "assist.chipProducts",
    "assist.chipSale",
  ];

  const newChat = useCallback(() => {
    stopSpeaking();
    setMessages([]);
    setQuotaError(false);
    void refreshStatus();
  }, [stopSpeaking, refreshStatus]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t("assist.title")}
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-2 ring-emerald-400/60 hover:bg-slate-800"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l1.9 5.7L19.6 9.6l-5.7 1.9L12 17.2l-1.9-5.7L4.4 9.6l5.7-1.9L12 2z" />
            <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" opacity="0.7" />
          </svg>
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 bg-slate-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.9 5.7L19.6 9.6l-5.7 1.9L12 17.2l-1.9-5.7L4.4 9.6l5.7-1.9L12 2z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold leading-tight">{t("assist.title")}</p>
                <p className="text-[11px] leading-tight text-gray-300">
                  {exhausted
                    ? t("assist.remaining", { remaining: 0 })
                    : t("assist.remaining", { remaining: Math.max(0, remaining - (loading ? 1 : 0)) })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={newChat}
                  className="rounded-lg px-2 py-1 text-xs text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  {t("assist.newChat")}
                </button>
              )}
              <button
                onClick={() => {
                  stopSpeaking();
                  setOpen(false);
                }}
                aria-label="close"
                className="rounded-lg px-2 py-1 text-gray-300 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="h-72 space-y-3 overflow-y-auto bg-gray-50 px-3 py-3">
            {messages.length === 0 && !loading && (
              <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                {t("assist.welcome", { remaining: exhausted ? 0 : remaining })}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chips.map((key) => (
                    <button
                      key={key}
                      onClick={() => void send(t(key))}
                      disabled={exhausted}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
                {exhausted && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    {t("assist.exhausted")}{" "}
                    <span className="font-semibold">{t("assist.supportEmail")}</span>
                    <br />
                    {t("assist.supportNote")}
                  </p>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-slate-900 px-3 py-2 text-sm text-white"
                      : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-700 shadow-sm"
                  }
                >
                  {m.text}
                  {m.role === "assistant" && m.text && (
                    <button
                      onClick={() => (speaking ? stopSpeaking() : readAloud(m.text))}
                      className="mt-1.5 block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
                    >
                      {speaking ? t("assist.stop") : t("assist.readAloud")}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                  {streamText || t("assist.typing")}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("assist.inputPlaceholder")}
                disabled={loading || exhausted}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
              />
              <button
                type="submit"
                disabled={loading || exhausted || !input.trim()}
                className="shrink-0 rounded-xl bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-40"
              >
                {t("assist.send")}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
