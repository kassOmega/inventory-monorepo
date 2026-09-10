"use client";
// AI Business Forecast — time-bound predictive analytics with Gemini.
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useEffect, useState } from "react";
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
          err?.response?.data?.message ||
          "⚠️ Daily limit reached: You have used your daily AI queries. Quota resets at midnight.";
        setLimitReached(true);
        setUsage((prev) =>
          prev ? { ...prev, limitReached: true, remaining: 0 } : prev,
        );
        setError(msg);
      } else if (err?.response?.status === 403) {
        const msg =
          err?.response?.data?.message ||
          "🤖 The AI feature is not enabled for this business. Contact the admin.";
        setEntitlement((prev) => (prev ? { ...prev, enabled: false } : prev));
        setError(msg);
      } else {
        setError(
          err?.response?.data?.message || "Failed to generate the forecast.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-white border rounded-xl p-8 text-center">
        <p className="text-gray-600">
          You don&apos;t have access to AI Forecast. Ask an owner to grant you
          the &quot;View AI Forecast &amp; Insights&quot; permission.
        </p>
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
          AI Business Forecast
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">
          Predictive revenue, stock-out and staffing insights generated by
          Gemini from your live sales data.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            Forecast window
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
                {p} Days
              </button>
            ))}
          </div>
        </div>
        <div className="md:ml-2">
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            Report language
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
              Analyzing…
            </>
          ) : (
            <>
              <span aria-hidden="true">✨</span> Generate Forecast
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
            {usage.count} / {usage.quota} queries used today
            {entitlement?.trialEndsAt && !entitlementLocked
              ? ` · trial ends ${entitlement.trialEndsAt}`
              : entitlementLocked && entitlement?.expired
                ? " · trial expired"
                : ""}
          </span>
        )}
      </div>

      {entitlementLocked && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
          <span aria-hidden="true">🤖</span>
          <span>
            {entitlement?.expired
              ? `AI free trial ended on ${entitlement.trialEndsAt}. Contact the admin to extend or enable the AI feature.`
              : "The AI feature is not enabled for this business. Contact the admin to enable it."}
          </span>
        </div>
      )}

      {(limitReached || usage?.limitReached) && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <span aria-hidden="true">⚠️</span>
          <span>
            Daily limit reached: You have used {usage?.quota ?? 15}/
            {usage?.quota ?? 15} daily AI queries. Quota resets at midnight.
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
          Last generated: {lastRun} ·{" "}
          {period === 7
            ? "Next 7 days"
            : period === 30
              ? "Next 30 days"
              : "Next quarter"}
        </p>
      )}

      {report && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Projected revenue"
              value={`${(rp?.projectedRevenue ?? 0).toLocaleString()} ETB`}
              accent="text-blue-700"
            />
            <StatCard
              label="Projected units"
              value={`${rp?.projectedUnits ?? 0} units`}
              accent="text-emerald-700"
            />
            <StatCard
              label="Stock-out risks"
              value={`${report.stockOutWarnings?.length ?? 0}`}
              accent={
                (report.stockOutWarnings?.length ?? 0) > 0
                  ? "text-red-600"
                  : "text-gray-700"
              }
            />
            <StatCard
              label="Dead stock items"
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
                📈 Top Growth Categories (demand change %)
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
                      name="Growth %"
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
              title="Immediate Reorder Warnings"
              empty="No stock-out risks predicted."
              items={
                report.stockOutWarnings?.map((w) => ({
                  key: `${w.product}-${w.daysRemaining}`,
                  title: w.product,
                  detail: `Only ${w.currentStock} in stock · sells ~${w.dailyVelocity}/day · runs out in ${w.daysRemaining} day(s)`,
                  action: `Reorder ${w.recommendedReorderQty} by ${w.recommendedReorderDate}`,
                })) ?? []
              }
            />
            <ActionCard
              icon="🧹"
              title="Dead Stock Liquidation"
              empty="No dead stock detected."
              items={
                report.deadStockPlan?.map((d) => ({
                  key: d.product,
                  title: d.product,
                  detail: `${d.quantityInStock} in stock — ${d.strategy}`,
                  action: `Suggested discount: ${d.suggestedDiscountPct}%`,
                })) ?? []
              }
            />
            <ActionCard
              icon="🛠️"
              title="Staffing Adjustments"
              empty="No staffing changes recommended."
              items={
                report.staffingAdjustments?.map((s) => ({
                  key: `${s.day}-${s.shift}`,
                  title: `${s.day} · ${s.shift}`,
                  detail: s.reasoning,
                  action: `Recommended staff: ${s.recommendedStaff}`,
                })) ?? []
              }
            />
            <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                🕐 Peak Hours Coverage
              </h2>
              <p className="text-sm text-gray-600">
                Historical peak sales hours were factored into the staffing
                plan. Focus coverage on the days and shifts Gemini flagged.
              </p>
              {(report.staffingAdjustments?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400 mt-2">
                  No staffing changes recommended.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Insights history */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          🗂️ Past AI Insights
        </h2>
        {insights.length === 0 ? (
          <p className="text-sm text-gray-400">
            No AI insights generated yet. Click &quot;Generate Forecast&quot;
            above to create your first one.
          </p>
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

