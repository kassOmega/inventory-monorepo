"use client";

import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";

/**
 * Compute start → end for a date preset.
 * - Today:     start = end = today
 * - This Week: start = most recent Monday; end = today
 * - This Month:start = 1st of this month; end = today
 * - This Year: start = Jan 1 of this year; end = today
 */
export function getDateRange(preset: DatePreset): {
  start: string;
  end: string;
} {
  const now = new Date();
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayStr = fmt(now);

  switch (preset) {
    case "today":
      return { start: todayStr, end: todayStr };

    case "week": {
      // Monday = 1, Sunday = 0 — getDay() returns 0=Sun,1=Mon,...
      const dayOfWeek = now.getDay(); // 0 = Sunday
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(monday.getDate() - daysSinceMonday);
      return { start: fmt(monday), end: todayStr };
    }

    case "month": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: fmt(firstOfMonth), end: todayStr };
    }

    case "year": {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      return { start: fmt(firstOfYear), end: todayStr };
    }
  }
}

const PRESETS: { key: DatePreset; labelKey: string }[] = [
  { key: "today", labelKey: "dateToday" },
  { key: "week", labelKey: "dateWeek" },
  { key: "month", labelKey: "dateMonth" },
  { key: "year", labelKey: "dateYear" },
];

interface DateFilterProps {
  preset: DatePreset;
  onPresetChange: (p: DatePreset) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
}

export default function DateFilter({
  preset,
  onPresetChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}: DateFilterProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => {
            const r = getDateRange(p.key);
            onPresetChange(p.key);
            onStartDateChange(r.start);
            onEndDateChange(r.end);
          }}
          className={`px-1.5 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium transition ${
            preset === p.key
              ? "bg-blue-600 text-white shadow"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {t(`filters.${p.labelKey}`)}
        </button>
      ))}
      <div className="flex items-center gap-1 sm:gap-2 ml-0.5 sm:ml-1 flex-wrap">
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="border p-0.5 sm:p-1.5 rounded text-[10px] sm:text-xs bg-white"
        />
        <span className="text-gray-400 text-[10px] sm:text-xs">{t("filters.to")}</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="border p-0.5 sm:p-1.5 rounded text-[10px] sm:text-xs bg-white"
        />
      </div>
    </div>
  );
}
