"use client";

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ClearableInput from "./ClearableInput";
import {
  FilterField,
  FILTER_CONTROL_CLASS,
} from "./FilterField";

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
        <FilterField label={t("filters.search")} className="my-2">
          <ClearableInput
            placeholder={searchPlaceholder ?? t("filters.searchProducts")}
            value={search ?? ""}
            onChange={(v) => onSearchChange?.(v)}
            inputClassName={FILTER_CONTROL_CLASS}
          />
        </FilterField>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 sm:gap-3 items-end">
        {showCategory && (
          <FilterField label={t("filters.category")}>
            <select
              value={category ?? ""}
              onChange={(e) => onCategoryChange?.(e.target.value)}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">{t("filters.allCategories")}</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FilterField>
        )}

        {showLocation && onLocationChange && locations && (
          <FilterField label={t("filters.location")}>
            <select
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              className={FILTER_CONTROL_CLASS}
            >
              <option value="">{t("filters.allLocations")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FilterField>
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
