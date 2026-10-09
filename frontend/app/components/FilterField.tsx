"use client";
// Shared primitives for every filtering FIELD (text inputs and dropdowns) so
// they all share one label + control layout across the app.
//
//   <FilterField label="…">…control…</FilterField>
//
// Keep the control styling here (FILTER_CONTROL_CLASS) and in the *Select /
// *Input wrappers so a text field and a dropdown always line up.
import { type ReactNode } from "react";

/** The single styling used by every filter control (text input + select). */
export const FILTER_CONTROL_CLASS =
  "border border-gray-300 rounded-lg bg-white px-2 py-1.5 sm:px-2.5 sm:py-2 text-xs sm:text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400";

/** The single label styling used above every filter control. */
export const FILTER_LABEL_CLASS =
  "block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1";

/**
 * One filter field: a label stacked above its control. Every filtering field
 * (text or dropdown) should be wrapped in this so the grid stays aligned.
 */
export function FilterField({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {label !== undefined && (
        <label className={FILTER_LABEL_CLASS}>{label}</label>
      )}
      {children}
    </div>
  );
}
