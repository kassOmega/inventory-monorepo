"use client";

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Location {
  id: number;
  name: string;
  type: string;
}

interface Category {
  id: number;
  name: string;
}

interface FilterBarProps {
  search?: string;
  onSearchChange?: (v: string) => void;
  /** Placeholder for the search input (defaults to the product search copy). */
  searchPlaceholder?: string;
  category?: string;
  onCategoryChange?: (v: string) => void;
  categories?: Category[];
  location?: string;
  onLocationChange?: (v: string) => void;
  locations?: Location[];
  showLocation?: boolean;
  /** Page-specific selects rendered inside the panel, below the standard row. */
  extra?: ReactNode;
}

export default function FilterBar({
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
}: FilterBarProps) {
  const { t } = useTranslation();
  const showSearch = onSearchChange !== undefined;
  const showCategory = onCategoryChange !== undefined;
  return (
    <div>
      {showSearch && (
        <div className="my-2">
          <label className="flex-1 block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
            {t("filters.search")}
          </label>
          <input
            placeholder={searchPlaceholder ?? t("filters.searchProducts")}
            value={search ?? ""}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="border p-1.5 sm:p-2 rounded-lg w-full text-xs sm:text-sm"
          />
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 sm:gap-3 items-end">
        {showCategory && (
          <div>
            <label className="mb-1 block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
              {t("filters.category")}
            </label>
            <select
              value={category ?? ""}
              onChange={(e) => onCategoryChange?.(e.target.value)}
              className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm w-full"
            >
              <option value="">{t("filters.allCategories")}</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {showLocation && onLocationChange && locations && (
          <div>
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
              {t("filters.location")}
            </label>
            <select
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm w-full"
            >
              <option value="">{t("filters.allLocations")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {extra && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 sm:gap-3 items-end mt-1.5 sm:mt-3">
          {extra}
        </div>
      )}
    </div>
  );
}
