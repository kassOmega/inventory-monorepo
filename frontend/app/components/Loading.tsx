"use client";
import { useTranslation } from "react-i18next";

/**
 * Common loading indicator used across all pages and API-driven UI.
 *
 * - <Loading />            full-area centered spinner + label
 * - <Loading size="sm" />  small spinner only (buttons, inline spots)
 *
 * "use client" so the default label can be localized (route-level loading.tsx
 * files can still render it as a client component).
 */
export default function Loading({
  size = "lg",
  label,
  className = "",
  minHeight,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
  minHeight?: number | string;
}) {
  const { t } = useTranslation();
  const shownLabel = label ?? t("common.loading");

  const spinnerClass =
    size === "sm"
      ? "h-4 w-4 border-2"
      : size === "md"
        ? "h-6 w-6 border-2"
        : "h-8 w-8 border-4";

  if (size === "sm") {
    return (
      <span
        role="status"
        aria-label={shownLabel}
        className={`inline-block ${spinnerClass} animate-spin rounded-full border-gray-300 border-t-blue-600 ${className}`}
      />
    );
  }

  return (
    <div
      role="status"
      className={`flex items-center justify-center ${className}`}
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div
          className={`${spinnerClass} animate-spin rounded-full border-gray-300 border-t-blue-600`}
        />
        <p className="text-sm">{shownLabel}</p>
      </div>
    </div>
  );
}
