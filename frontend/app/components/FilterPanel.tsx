"use client";

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
  // DateFilter props
  showDateFilter?: boolean;
  datePreset: DatePreset;
  onDatePresetChange: (p: DatePreset) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;

  // FilterBar props
  search: string;
  onSearchChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  categories: Category[];
  location?: string;
  onLocationChange?: (v: string) => void;
  locations?: Location[];
  showLocation?: boolean;
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
  category,
  onCategoryChange,
  categories,
  location,
  onLocationChange,
  locations,
  showLocation,
}: FilterPanelProps) {
  return (
    <div className="w-full max-w-full bg-white p-2 sm:p-4 rounded-xl shadow-sm border mb-4 sm:mb-6 space-y-1.5 sm:space-y-3">
      {showDateFilter && (
        <DateFilter
          preset={datePreset}
          onPresetChange={onDatePresetChange}
          startDate={startDate}
          onStartDateChange={onStartDateChange}
          endDate={endDate}
          onEndDateChange={onEndDateChange}
        />
      )}

      <FilterBar
        search={search}
        onSearchChange={onSearchChange}
        category={category}
        onCategoryChange={onCategoryChange}
        categories={categories}
        location={location}
        onLocationChange={onLocationChange}
        locations={locations}
        showLocation={showLocation}
      />
    </div>
  );
}
