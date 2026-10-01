"use client";
// AI Business Forecast — time-bound predictive analytics with Gemini.
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AiSmartFeatures from "@/app/components/AiSmartFeatures";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = 7 | 30 | 90;
type Lang = "English" | "Amharic" | "Afaan Oromoo";

const PERIOD_TO_TARGET: Record<Period, string> = {
  7: "NEXT_7_DAYS",
  30: "NEXT_30_DAYS",
  90: "NEXT_QUARTER",
};

// Report languages are named in their own script (endonyms) — never translated.
const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "English", label: "English" },
  { value: "Amharic", label: "አማርኛ" },
  { value: "Afaan Oromoo", label: "Afaan Oromoo" },
];

interface ForecastReport {
  revenueProjection: {
    projectedRevenue: number;
    projectedUnits: number;
    topGrowthCategories: {
      category: string;
      growthPercent: number;
      reasoning: string;
    }[];
  };
  stockOutWarnings: {
    product: string;
    currentStock: number;
    dailyVelocity: number;
    daysRemaining: number;
    recommendedReorderQty: number;
    recommendedReorderDate: string;
  }[];
  deadStockPlan: {
    product: string;
    quantityInStock: number;
    suggestedDiscountPct: number;
    strategy: string;
  }[];
  staffingAdjustments: {
    day: string;
    shift: string;
    recommendedStaff: number;
    reasoning: string;
  }[];
}

interface Insight {
  id: string;
  type: string;
  summary: string;
  targetPeriod: string | null;
  createdAt: string;
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

const TYPE_BADGE: Record<string, string> = {
  DEMAND_FORECAST: "bg-blue-100 text-blue-800",
  WEEKLY_SUMMARY: "bg-emerald-100 text-emerald-800",
  DEAD_STOCK_ALERT: "bg-amber-100 text-amber-800",
  STAFF_EFFICIENCY: "bg-violet-100 text-violet-800",
  CASH_FLOW_FORECAST: "bg-cyan-100 text-cyan-800",
  PRICING_RECOMMENDATIONS: "bg-pink-100 text-pink-800",
  CUSTOMER_CHURN: "bg-orange-100 text-orange-800",
  PO_DRAFT: "bg-indigo-100 text-indigo-800",
};

export default function ForecastPage() {
  const { hasPermission, user } = useAuth();
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>(30);
  const [language, setLanguage] = useState<Lang>("English");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ForecastReport | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [entitlement, setEntitlement] = useState<AiEntitlement | null>(null);

  const canView = user?.isSuperuser || hasPermission("ai.view");
  const entitlementLocked = !entitlement?.enabled;

  useEffect(() => {
    if (!canView) return;
    api
      .get("/ai/insights")
      .then((r) => setInsights(r.data ?? []))
      .catch(() => setInsights([]));
    api
      .get("/ai/usage")
      .then((r) => {
        setUsage(r.data ?? null);
        setLimitReached(Boolean(r.data?.limitReached));
        setEntitlement(r.data?.entitlement ?? null);
      })
      .catch(() => undefined);
  }, [canView]);

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.post(
        "/ai/forecast",
        {
          targetPeriod: PERIOD_TO_TARGET[period],
          language,
        },
        { timeout: 120000 },
      );
      if (res.data?.usage) {
        setUsage(res.data.usage);
        setLimitReached(Boolean(res.data.usage.limitReached));
      }
      setReport(res.data.report);
      setLastRun(new Date().toLocaleString());
      const insightsRes = await api.get("/ai/insights");
      setInsights(insightsRes.data ?? []);
    } catch (err: any) {
      if (err?.response?.status === 429) {
        const msg =
          err?.response?.data?.message || t("forecast.limitFallback");
        setLimitReached(true);
        setUsage((prev) =>
          prev ? { ...prev, limitReached: true, remaining: 0 } : prev,
        );
        setError(msg);
      } else if (err?.response?.status === 403) {
        const msg =
          err?.response?.data?.message || t("forecast.notEnabledFallback");
        setEntitlement((prev) => (prev ? { ...prev, enabled: false } : prev));
        setError(msg);
      } else {
        setError(
          err?.response?.data?.message || t("forecast.generateFail"),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-white border rounded-xl p-8 text-center">
        <p className="text-gray-600">{t("forecast.noAccess")}</p>
      </div>
    );
  }

  const rp = report?.revenueProjection;
  const chartData =
    rp?.topGrowthCategories?.map((c) => ({
      name: c.category,
      growth: c.growthPercent,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("forecast.title")}
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">
          {t("forecast.subtitle")}
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            {t("forecast.window")}
          </p>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([7, 30, 90] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 sm:px-4 py-2 text-sm font-medium transition ${
                  period === p
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t("forecast.days", { count: p })}
              </button>
            ))}
          </div>
        </div>
        <div className="md:ml-2">
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            {t("forecast.reportLanguage")}
          </p>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={generate}
          disabled={loading || limitReached || usage?.limitReached || entitlementLocked}
          className="md:ml-auto bg-blue-600 text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              {t("ai.analyzing")}
            </>
          ) : (
            <>
              <span aria-hidden="true">✨</span> {t("forecast.generate")}
            </>
          )}
        </button>
        {usage && (
          <span
            className={`md:ml-auto -ml-1 md:mt-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              usage.limitReached || limitReached || entitlementLocked
                ? "bg-red-100 text-red-700 border-red-200"
                : "bg-blue-100 text-blue-700 border-blue-200"
            }`}
          >
            {t("forecast.queriesUsed", { used: usage.count, quota: usage.quota })}
            {entitlement?.trialEndsAt && !entitlementLocked
              ? t("forecast.trialEnds", { date: entitlement.trialEndsAt })
              : entitlementLocked && entitlement?.expired
                ? t("forecast.trialExpired")
                : ""}
          </span>
        )}
      </div>

      {entitlementLocked && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
          <span aria-hidden="true">🤖</span>
          <span>
            {entitlement?.expired
              ? t("forecast.trialEndedBanner", { date: entitlement.trialEndsAt })
              : t("forecast.notEnabledBanner")}
          </span>
        </div>
      )}

      {(limitReached || usage?.limitReached) && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <span aria-hidden="true">⚠️</span>
          <span>
            {t("forecast.limitBanner", {
              quota: usage?.quota ?? 15,
            })}
          </span>
        </div>
      )}

      {error && !limitReached && !entitlementLocked && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {lastRun && (
        <p className="text-xs text-gray-400">
          {t("forecast.lastGenerated", { at: lastRun })}{" "}
          {period === 7
            ? t("forecast.next7")
            : period === 30
              ? t("forecast.next30")
              : t("forecast.nextQuarter")}
        </p>
      )}

      {report && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label={t("forecast.statRevenue")}
              value={`${(rp?.projectedRevenue ?? 0).toLocaleString()} ETB`}
              accent="text-blue-700"
            />
            <StatCard
              label={t("forecast.statUnits")}
              value={t("forecast.statUnitsValue", {
                count: rp?.projectedUnits ?? 0,
              })}
              accent="text-emerald-700"
            />
            <StatCard
              label={t("forecast.statStockOut")}
              value={`${report.stockOutWarnings?.length ?? 0}`}
              accent={
                (report.stockOutWarnings?.length ?? 0) > 0
                  ? "text-red-600"
                  : "text-gray-700"
              }
            />
            <StatCard
              label={t("forecast.statDeadStock")}
              value={`${report.deadStockPlan?.length ?? 0}`}
              accent={
                (report.deadStockPlan?.length ?? 0) > 0
                  ? "text-amber-600"
                  : "text-gray-700"
              }
            />
          </div>

          {/* Growth chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                {t("forecast.growthTitle")}
              </h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      angle={-12}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: "#f3f4f6" }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar
                      dataKey="growth"
                      name={t("forecast.growthSeries")}
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}


          {/* Action cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
            <ActionCard
              icon="🚨"
              title={t("forecast.reorderTitle")}
              empty={t("forecast.reorderEmpty")}
              items={
                report.stockOutWarnings?.map((w) => ({
                  key: `${w.product}-${w.daysRemaining}`,
                  title: w.product,
                  detail: t("forecast.reorderDetail", {
                    stock: w.currentStock,
                    velocity: w.dailyVelocity,
                    days: w.daysRemaining,
                  }),
                  action: t("forecast.reorderAction", {
                    qty: w.recommendedReorderQty,
                    date: w.recommendedReorderDate,
                  }),
                })) ?? []
              }
            />
            <ActionCard
              icon="🧹"
              title={t("forecast.deadTitle")}
              empty={t("forecast.deadEmpty")}
              items={
                report.deadStockPlan?.map((d) => ({
                  key: d.product,
                  title: d.product,
                  detail: t("forecast.deadDetail", {
                    qty: d.quantityInStock,
                    strategy: d.strategy,
                  }),
                  action: t("forecast.deadAction", {
                    pct: d.suggestedDiscountPct,
                  }),
                })) ?? []
              }
            />
            <ActionCard
              icon="🛠️"
              title={t("forecast.staffTitle")}
              empty={t("forecast.staffEmpty")}
              items={
                report.staffingAdjustments?.map((s) => ({
                  key: `${s.day}-${s.shift}`,
                  title: `${s.day} · ${s.shift}`,
                  detail: s.reasoning,
                  action: t("forecast.staffAction", {
                    count: s.recommendedStaff,
                  }),
                })) ?? []
              }
            />
            <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                {t("forecast.peakTitle")}
              </h2>
              <p className="text-sm text-gray-600">{t("forecast.peakBody")}</p>
              {(report.staffingAdjustments?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400 mt-2">
                  {t("forecast.staffEmpty")}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Insights history */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          {t("forecast.insightsTitle")}
        </h2>
        {insights.length === 0 ? (
          <p className="text-sm text-gray-400">{t("forecast.insightsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {insights.slice(0, 8).map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE[i.type] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {i.type.replace(/_/g, " ")}
                  </span>
                  {i.targetPeriod && (
                    <span className="text-[10px] text-gray-400">
                      {i.targetPeriod.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {new Date(i.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1">{i.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* AI Smart Features: cash flow, pricing, churn, PO drafts */}
      <AiSmartFeatures />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-lg sm:text-xl font-bold mt-1 ${accent}`}>{value}</p>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  items,
  empty,
}: {
  icon: string;
  title: string;
  items: { key: string; title: string; detail: string; action: string }[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">
          {icon} {title}
        </h2>
        <p className="text-sm text-gray-400">{empty}</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-3">
        {icon} {title}
      </h2>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key} className="border border-gray-100 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-800">{item.title}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {item.detail}
            </p>
            <p className="text-xs font-semibold text-blue-700 mt-1.5">
              {item.action}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

