"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import FilterPanel from "./FilterPanel";

type FilterPanelProps = React.ComponentProps<typeof FilterPanel>;

interface Props extends FilterPanelProps {
  /** Header/toggle label. Defaults to the shared "Filters" copy. */
  title?: string;
  defaultOpen?: boolean;
}

export default function CollapsibleFilterPanel({
  title,
  defaultOpen = false,
  ...panel
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="w-full max-w-full mb-4 sm:mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-2 sm:px-4 text-left shadow-sm"
      >
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {title ?? t("common.filters")}
        </span>
        <span className="min-w-0 flex-1" />
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="[&>div]:mb-0">
          <FilterPanel {...panel} />
        </div>
      )}
    </div>
  );
}
