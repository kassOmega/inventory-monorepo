"use client";

import { type ReactNode } from "react";
import DateFilter from "./DateFilter";
import FilterBar from "./FilterBar";

interface Location {
  id: number;
  name: string;
  type: string;
}

interface Category {
  id: number;
  name: string;
}

type DatePreset = "today" | "week" | "month" | "year";

interface FilterPanelProps {
  // DateFilter props (only required when showDateFilter is true)
  showDateFilter?: boolean;
  datePreset?: DatePreset;
  onDatePresetChange?: (p: DatePreset) => void;
  startDate?: string;
  onStartDateChange?: (v: string) => void;
  endDate?: string;
  onEndDateChange?: (v: string) => void;

  // FilterBar props (all optional so a page can show only what it needs)
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  category?: string;
  onCategoryChange?: (v: string) => void;
  categories?: Category[];
  location?: string;
  onLocationChange?: (v: string) => void;
  locations?: Location[];
  showLocation?: boolean;
  /** Page-specific selects rendered inside the shared panel (same styling). */
  extra?: ReactNode;
}

/**
 * A labelled select styled like the built-in FilterBar controls — use it for the
 * `extra` slot so page-specific filters match the shared panel exactly.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm w-full"
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function FilterPanel({
  showDateFilter = false,
  datePreset,
  onDatePresetChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  search,
  onSearchChange,
  searchPlaceholder,
  category,
  onCategoryChange,
  categories,
  location,
  onLocationChange,
  locations,
  showLocation,
  extra,
}: FilterPanelProps) {
  return (
    <div className="w-full max-w-full bg-white p-2 sm:p-4 rounded-xl shadow-sm border mb-4 sm:mb-6 space-y-1.5 sm:space-y-3">
      {showDateFilter && (
        <DateFilter
          preset={datePreset ?? "today"}
          onPresetChange={onDatePresetChange ?? (() => {})}
          startDate={startDate ?? ""}
          onStartDateChange={onStartDateChange ?? (() => {})}
          endDate={endDate ?? ""}
          onEndDateChange={onEndDateChange ?? (() => {})}
        />
      )}

      <FilterBar
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        category={category}
        onCategoryChange={onCategoryChange}
        categories={categories}
        location={location}
        onLocationChange={onLocationChange}
        locations={locations}
        showLocation={showLocation}
        extra={extra}
      />
    </div>
  );
}
