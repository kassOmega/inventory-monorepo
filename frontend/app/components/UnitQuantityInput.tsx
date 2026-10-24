"use client";
// Whole-number quantity entry across a product's unit ladder. The controlled
// value is always the base-unit quantity, so callers can keep one number while
// the user types e.g. 2 Rolls + 3 Pieces.
import {
  baseToStockQuantity,
  fromStockQuantity,
  toStockFromCounts,
  unitsLargestFirst,
} from "@/lib/unit-stock";
import {
  formatBaseQuantity,
  formatStockQuantity,
  stockBreakdownCounts,
} from "@/lib/unit-display";

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

export default function UnitQuantityInput({
  units,
  value,
  valueMode = "base",
  onChange,
  disabled = false,
  compact = false,
  showTotal = true,
  className = "",
  inputClassName = "",
}: {
  units: any[] | null | undefined;
  value: number;
  /** "base" (default) for product forms; "stock" for requests/inventory moves. */
  valueMode?: "base" | "stock";
  onChange: (qty: number) => void;
  disabled?: boolean;
  compact?: boolean;
  showTotal?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const ordered = unitsLargestFirst(units ?? []);
  const stockValue =
    valueMode === "stock" ? Number(value) || 0 : baseToStockQuantity(value, ordered);
  const counts = stockBreakdownCounts(stockValue, ordered);
  const baseUnit = ordered.find((u) => u.isBase) ?? ordered[0] ?? null;
  const emit = (stockQty: number) =>
    onChange(
      valueMode === "stock"
        ? Math.round(stockQty)
        : fromStockQuantity(stockQty, baseUnit, ordered),
    );

  if (ordered.length === 0) {
    return (
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        disabled={disabled}
        value={value || ""}
        onChange={(e) => onChange(Number(digitsOnly(e.target.value)) || 0)}
        className={`border p-2 rounded-lg text-sm tabular-nums ${inputClassName}`}
      />
    );
  }

  const setCount = (unitId: string, raw: string) => {
    const nextCounts = {
      ...counts,
      [unitId]: digitsOnly(raw),
    };
    emit(toStockFromCounts(nextCounts, ordered));
  };

  return (
    <div className={className}>
      <div className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-2 gap-1.5 sm:grid-cols-3"}>
        {ordered.map((unit) => {
          const unitId = String(unit.unitId);
          const count = counts[unitId] ?? 0;
          return (
            <label key={unitId} className="min-w-0">
              {!compact && (
                <span className="mb-0.5 block truncate text-[10px] font-medium text-gray-500">
                  {unit.unit?.name ?? unit.name ?? ""}
                </span>
              )}
              <div className="flex items-center gap-1">
                {compact && (
                  <span className="max-w-12 truncate text-[10px] text-gray-400">
                    {unit.unit?.name ?? unit.name ?? ""}
                  </span>
                )}
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  disabled={disabled}
                  value={count || ""}
                  onChange={(e) => setCount(unitId, e.target.value)}
                  placeholder="0"
                  className={`w-full min-w-14 border p-1.5 rounded-lg text-right text-sm tabular-nums ${inputClassName}`}
                />
              </div>
            </label>
          );
        })}
      </div>
      {showTotal && ordered.length > 1 && (
        <p className="mt-1 text-[10px] text-gray-400">
          {valueMode === "stock"
            ? formatStockQuantity(stockValue, ordered)
            : formatBaseQuantity(value, ordered)}
        </p>
      )}
    </div>
  );
}
