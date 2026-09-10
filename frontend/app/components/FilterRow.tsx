"use client";

import { ReactNode, useState } from "react";

interface FilterRowProps {
  children: ReactNode;
}

/**
 * Collapsible filter bar — toggle on mobile, always visible on desktop.
 */
export default function FilterRow({ children }: FilterRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 sm:mb-6">
      {/* Toggle — mobile only */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden w-full flex items-center justify-between bg-white border rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow-sm mb-2"
      >
        <span className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          Filters
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Grid — hidden on mobile when collapsed */}
      <div
        className={`bg-white rounded-xl shadow-sm border border-gray-200 ${open ? "block" : "hidden"} md:block`}
      >
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 p-3 sm:p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

interface FilterFieldProps {
  label: string;
  children: ReactNode;
}

export function FilterField({ label, children }: FilterFieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
