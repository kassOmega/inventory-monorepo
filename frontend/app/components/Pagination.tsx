"use client";

import { useTranslation } from "react-i18next";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onPrev: () => void;
  onNext: () => void;
  onPage: (p: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
}

const PAGE_SIZES = [10, 20, 50, 100];

/** Shared table pagination footer: range line, page sizes, prev/next + numbers. */
export default function Pagination({
  page,
  totalPages,
  total,
  rangeStart,
  rangeEnd,
  onPrev,
  onNext,
  onPage,
  onPageSizeChange,
  pageSize,
}: PaginationProps) {
  const { t } = useTranslation();
  // Always show the footer when rows exist (single-page lists still get the
  // range line + disabled controls); hide it only for empty results.
  if (total <= 0) return null;

  // Numbered window around the current page (max 5 buttons).
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages: number[] = [];
  for (let i = start; i <= Math.min(totalPages, start + 4); i++) pages.push(i);

  const btn =
    "min-w-8 h-8 px-2 rounded-lg text-sm border transition disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-3">
      <p className="text-xs text-gray-500 whitespace-nowrap">
        {t("pg.showing", { from: rangeStart, to: rangeEnd, total })}
      </p>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 flex items-center gap-1.5">
          {t("pg.rowsPerPage")}
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={page <= 1}
            className={`${btn} bg-white text-gray-600 hover:bg-gray-50`}
            aria-label={t("pg.previous")}
          >
            ‹
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              className={`${btn} ${
                p === page
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 hover:bg-gray-50 border-gray-200"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={onNext}
            disabled={page >= totalPages}
            className={`${btn} bg-white text-gray-600 hover:bg-gray-50`}
            aria-label={t("pg.next")}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
