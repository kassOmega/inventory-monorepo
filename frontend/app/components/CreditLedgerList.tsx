"use client";
import RowActionsMenu, { ActionItem } from "@/app/components/RowActionsMenu";
import { fmtCurrency } from "@/lib/currency";
import { localDayKey } from "@/lib/dayKey";
import { formatDate } from "@/lib/datetime";
import type { LedgerLineGroup } from "@/lib/saleItems";
import { variantLabel } from "@/lib/variantLabel";
import { Fragment, ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * One record of a day-grouped ledger list: a credit sale, or everything taken
 * from one vendor on one day (see lib/purchaseLedger).
 */
export interface CreditLedgerEntry {
  /** Key of the entry row: the record id, or the group key. */
  key: string | number;
  /** Tooltip of the entry — the record's public id. */
  title?: string;
  /** Timestamp the day header is derived from. */
  date: string | Date | null | undefined;
  /** Timestamp the list is ordered by; defaults to `date`. */
  sortAt?: string | Date | null;
  /** What this entry adds to its day's total. */
  total: number;
  /** Left half of the grey meta strip above the item table. */
  strip: ReactNode;
  /** Right half of that strip. */
  actions: ActionItem[];
  /** Item-table rows, grouped by product exactly as `groupSaleItemsByProduct` returns them. */
  groups: LedgerLineGroup[];
  /** Extra indented rows under a product row (the paybacks a purchase received). */
  subRows?: (group: LedgerLineGroup, index: number) => ReactNode;
  /** Tooltip of a product row — the record behind that line. */
  lineTitle?: (group: LedgerLineGroup, index: number) => string | undefined;
  /** Makes a product row open the record behind it. */
  onLineClick?: (group: LedgerLineGroup, index: number) => void;
}

interface Props {
  entries: CreditLedgerEntry[];
  /** Left half of a day header, e.g. "Aug 21, 2026 · 3 sales". */
  dayLabel: (date: string, count: number) => string;
  emptyLabel: string;
}

/**
 * The credit-sales listing: a card per day with a running total, one block per
 * record carrying its meta strip and an item table (Product / Qty / Price /
 * Subtotal) that folds variant lines.
 *
 * Both sides of the credits page read through it — the Credit Sales tab feeds it
 * credit sales, the Payables to Vendors tab feeds it the shop-days of what was
 * taken from the vendor — so the two sides of the ledger look the same.
 */
export default function CreditLedgerList({
  entries,
  dayLabel,
  emptyLabel,
}: Props) {
  const { t } = useTranslation();
  // Products whose variant lines are folded open, keyed "<entryKey>:<productId>".
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(
    new Set(),
  );
  const toggleVariantGroup = (key: string) =>
    setExpandedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const days = useMemo(() => {
    // Newest first. The sort is stable, so entries of the same moment keep the
    // order the page handed them over in (its own list order).
    const groups: Record<string, CreditLedgerEntry[]> = {};
    [...entries]
      .sort(
        (a, b) =>
          new Date(b.sortAt ?? b.date ?? 0).getTime() -
          new Date(a.sortAt ?? a.date ?? 0).getTime(),
      )
      .forEach((entry) => {
        const key = localDayKey(entry.date);
        if (!groups[key]) groups[key] = [];
        groups[key].push(entry);
      });

    // Newest date first, each day carrying the running total of the days above.
    const result: {
      key: string;
      date: string;
      entries: CreditLedgerEntry[];
      dayTotal: number;
      accumulated: number;
    }[] = [];
    let running = 0;
    Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .forEach(([key, dayEntries]) => {
        const dayTotal = dayEntries.reduce((s, e) => s + (e.total ?? 0), 0);
        running += dayTotal;
        result.push({
          key,
          date: /^\d{4}-\d{2}-\d{2}$/.test(key)
            ? formatDate(`${key}T00:00:00`)
            : "—",
          entries: dayEntries,
          dayTotal,
          accumulated: running,
        });
      });
    return result;
  }, [entries]);

  return (
    <div className="space-y-4">
      {days.map(({ date, entries: dayEntries, dayTotal, accumulated }) => (
        <div
          key={date}
          className="bg-white rounded-xl shadow-sm border overflow-hidden"
        >
          <div className="px-3 sm:px-4 py-2.5 bg-gray-50 border-b text-xs sm:text-sm font-semibold text-gray-700 flex justify-between">
            <span>
              {dayLabel(date, dayEntries.length)}{" "}
              · {fmtCurrency(dayTotal)}
            </span>
            <span className="text-gray-500 font-normal">
              {t("credits.accLabel")} {fmtCurrency(accumulated)}
            </span>
          </div>
          {dayEntries.map((entry) => (
            <div
              key={entry.key}
              className="border-b last:border-b-0"
              title={entry.title}
            >
              <div className="px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs text-gray-400 bg-gray-50/50 flex justify-between items-center">
                <span>{entry.strip}</span>
                <RowActionsMenu items={entry.actions} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 sm:p-3 font-medium text-gray-500">
                        {t("common.product")}
                      </th>
                      <th className="p-2 sm:p-3 text-center w-16 font-medium text-gray-500">
                        {t("common.qty")}
                      </th>
                      <th className="p-2 sm:p-3 text-right w-24 font-medium text-gray-500">
                        {t("common.price")}
                      </th>
                      <th className="p-2 sm:p-3 text-right w-24 font-medium text-gray-500">
                        {t("credits.subtotal")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.groups.map((group, index) => {
                      const key = `${entry.key}:${group.productId}`;
                      const name = `${group.product?.brand ?? ""} ${
                        group.product?.baseName ?? ""
                      }`.trim();
                      const subRows = entry.subRows?.(group, index);
                      const lineTitle = entry.lineTitle?.(group, index);
                      const onLineClick = entry.onLineClick
                        ? () => entry.onLineClick?.(group, index)
                        : undefined;

                      // No variants: one plain row, exactly as before.
                      if (!group.hasVariants) {
                        const item = group.items[0];
                        return (
                          <Fragment key={key}>
                            <tr
                              onClick={onLineClick}
                              title={lineTitle}
                              className={
                                "border-b last:border-b-0" +
                                (onLineClick
                                  ? " cursor-pointer hover:bg-gray-50"
                                  : "")
                              }
                            >
                              <td className="p-2 sm:p-3">{name}</td>
                              <td className="p-2 sm:p-3 text-center">
                                {item.quantity}
                              </td>
                              <td className="p-2 sm:p-3 text-right">
                                {fmtCurrency(item.unitPrice)}
                              </td>
                              <td className="p-2 sm:p-3 text-right font-medium">
                                {fmtCurrency(
                                  Number(item.quantity) *
                                    Number(item.unitPrice),
                                )}
                              </td>
                            </tr>
                            {subRows}
                          </Fragment>
                        );
                      }

                      // Variant product: fold its lines, collapsed by default.
                      const open = expandedVariants.has(key);
                      return (
                        <Fragment key={key}>
                          <tr className="border-b" title={lineTitle}>
                            <td className="p-2 sm:p-3">
                              <button
                                type="button"
                                aria-expanded={open}
                                title={
                                  open
                                    ? t("products.collapseVariants")
                                    : t("products.expandVariants")
                                }
                                onClick={() => toggleVariantGroup(key)}
                                className="flex items-center gap-1.5 text-left"
                              >
                                <span className="w-3 text-gray-400">
                                  {open ? "▾" : "▸"}
                                </span>
                                <span>{name}</span>
                                <span className="text-[10px] text-gray-400">
                                  · {group.items.length}{" "}
                                  {t("credits.variants")}
                                </span>
                              </button>
                            </td>
                            <td className="p-2 sm:p-3 text-center">
                              {group.quantity}
                            </td>
                            <td className="p-2 sm:p-3 text-right">
                              {group.unitPrice === null
                                ? "—"
                                : fmtCurrency(group.unitPrice)}
                            </td>
                            <td className="p-2 sm:p-3 text-right font-medium">
                              {fmtCurrency(group.subtotal)}
                            </td>
                          </tr>
                          {open &&
                            group.items.map((item, i) => (
                              <tr
                                key={`${key}:${i}`}
                                className="border-b last:border-b-0 bg-gray-50/60 text-gray-600"
                              >
                                <td className="p-2 sm:p-3 pl-8 sm:pl-10 text-[11px] sm:text-xs">
                                  {variantLabel(item.variant) ||
                                    t("products.standard")}
                                </td>
                                <td className="p-2 sm:p-3 text-center text-[11px] sm:text-xs">
                                  {item.quantity}
                                </td>
                                <td className="p-2 sm:p-3 text-right text-[11px] sm:text-xs">
                                  {fmtCurrency(item.unitPrice)}
                                </td>
                                <td className="p-2 sm:p-3 text-right text-[11px] sm:text-xs">
                                  {fmtCurrency(
                                    Number(item.quantity) *
                                      Number(item.unitPrice),
                                  )}
                                </td>
                              </tr>
                            ))}
                          {subRows}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
      {days.length === 0 && (
        <p className="text-center text-gray-400 py-8 text-sm">{emptyLabel}</p>
      )}
    </div>
  );
}

