"use client";
// app/components/PurchasesTable.tsx
//
// One table for every purchase row, no matter how it settles. It carries only
// what a shopkeeper scans for — the date, the item (with its vendor underneath
// on a credit row), the quantity, what it cost and what is still owed — so the
// list stays readable on a phone instead of scrolling sideways.
// Everything else the row knows (the shop, the buy and sell prices, the
// recorded margin, the invoice, the settled amount, the payment status and the
// payback trail) lives in PurchaseDetailModal, which the row opens on tap.
// Both settlements share the same status pill and the same actions, so there is
// exactly one place where a purchase is approved, rejected, paid or deleted.
import RowActionsMenu from "./RowActionsMenu";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import { formatDate } from "@/lib/datetime";
import { useTranslation } from "react-i18next";

/** What is still owed to the vendor on one credit row. */
export function remainingToPay(row: any): number {
  return Math.max(0, (row?.totalCost ?? 0) - (row?.amountPaid ?? 0));
}

/**
 * The margin the shop expected when it bought the line: (sell − buy) × qty.
 * A PAID row books this as `profit` when it is approved; a CREDIT row keeps the
 * sell side as a promise until the goods are actually resold, so this is
 * computed from the stored prices and shown as recorded — never as banked.
 */
export function recordedMargin(row: any): number {
  return (
    ((row?.sellPrice ?? 0) - (row?.unitPrice ?? 0)) * (row?.quantity ?? 0)
  );
}

interface Props {
  rows: any[];
  /** Columns to show: 'PAID', 'CREDIT', or both when the tab shows everything. */
  mode: "ALL" | "PAID" | "CREDIT";
  canApprove?: boolean;
  canCreate?: boolean;
  /** Opens the row's detail modal — the home of everything not in the table. */
  onView?: (row: any) => void;
  onApprove?: (row: any) => void;
  onReject?: (row: any) => void;
  onPay?: (row: any) => void;
  onDelete?: (row: any) => void;
}

/** The one status pill, shared by the table and the detail modal. */
export const statusBadge = (status: string) => {
  const cls =
    status === "PENDING" || status === "PARTIALLY_PAID"
      ? "bg-yellow-100 text-yellow-800"
      : status === "APPROVED" || status === "PAID"
        ? "bg-green-100 text-green-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={"px-2 py-0.5 text-xs rounded-full font-semibold " + cls}>
      {statusLabel(status)}
    </span>
  );
};

export default function PurchasesTable({
  rows,
  mode,
  canApprove = false,
  canCreate = false,
  onView,
  onApprove,
  onReject,
  onPay,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  // The vendor rides under the item rather than taking a column of its own, and
  // only a credit tab (or the mixed one) has anything to print there.
  const showVendor = mode !== "PAID";
  // What is still owed is the number a shopkeeper chases, so it keeps a column
  // on the credit side; a paid row has nothing left to settle.
  const showCredit = mode !== "PAID";
  const showActions = canApprove || canCreate;
  // Column count for the empty-state row, read in header order:
  //   date | product | qty | total cost | remaining | status | actions
  // The date, the item, the quantity and the cost answer the same question
  // whatever the settlement, so they are always there; the rest only where the
  // mode counts on them. The sum below follows the order above, one term per
  // heading.
  const columns = 4 + (showCredit ? 1 : 0) + 1 + (showActions ? 1 : 0);

  // The settlement decides which money columns are meaningful on a row; the
  // ones that are not carry an em dash rather than a misleading zero.
  const body = (
    <>
      {rows.map((p: any) => {
        const isCredit = p.paymentType === "CREDIT";
        const remaining = remainingToPay(p);
        // Reading the row comes first: the table carries the headline, the modal
        // the rest, so "view" leads every menu.
        const actions: Array<{
          label: string;
          color?: string;
          onClick: () => void;
        }> = onView
          ? [{ label: t("common.view"), onClick: () => onView(p) }]
          : [];
        if (p.status === "PENDING") {
          if (canApprove) {
            actions.push(
              {
                label: t("purchases.approve"),
                color: "text-green-600",
                onClick: () => onApprove?.(p),
              },
              {
                label: t("purchases.reject"),
                color: "text-red-500",
                onClick: () => onReject?.(p),
              },
            );
          }
          // Deleting a paid purchase after approval would orphan its sale and
          // cash entries, so only a pending row can be removed.
          if (canCreate) {
            actions.push({
              label: t("common.delete"),
              color: "text-red-500",
              onClick: () => onDelete?.(p),
            });
          }
        } else if (
          p.status === "APPROVED" &&
          isCredit &&
          canCreate &&
          remaining > 0
        ) {
          actions.push({
            label: t("purchases.recordPayment"),
            color: "text-green-600",
            onClick: () => onPay?.(p),
          });
        }
        return (
          <tr
            key={p.id}
            // The whole row is the tap target for the detail modal; the actions
            // menu stops propagation, so opening the menu never opens the modal.
            onClick={() => onView?.(p)}
            className={
              "border-b hover:bg-gray-50 " + (onView ? "cursor-pointer" : "")
            }
            title={p.publicId ?? undefined}
          >
            <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-gray-500 whitespace-nowrap">
              {formatDate(p.createdAt)}
            </td>
            <td className="px-2 py-1.5 sm:px-3 sm:py-2">
              <div className="font-medium text-gray-800">{p.productName}</div>
              {/* Where it came from, on the line that has a vendor to name. */}
              {showVendor && p.vendorCustomer?.name && (
                <div className="text-[10px] sm:text-xs text-gray-400">
                  {p.vendorCustomer.name}
                </div>
              )}
            </td>
            <td className="px-2 py-1.5 sm:px-3 sm:py-2">{p.quantity}</td>
            <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right font-semibold whitespace-nowrap">
              {fmtCurrency(p.totalCost)}
            </td>
            {showCredit && (
              <td
                className={
                  "px-2 py-1.5 sm:px-3 sm:py-2 text-right font-bold whitespace-nowrap " +
                  (remaining > 0 && isCredit ? "text-red-500" : "text-green-600")
                }
              >
                {isCredit ? fmtCurrency(remaining) : "—"}
              </td>
            )}
            <td className="px-2 py-1.5 sm:px-3 sm:py-2">
              {statusBadge(p.status)}
            </td>
            {showActions && (
              <td
                className="px-2 py-1.5 sm:px-3 sm:py-2"
                onClick={(e) => e.stopPropagation()}
              >
                {actions.length > 0 && <RowActionsMenu items={actions} />}
              </td>
            )}
          </tr>
        );
      })}
      {rows.length === 0 && (
        <tr>
          <td
            colSpan={columns}
            className="p-6 text-center text-gray-400 text-sm"
          >
            {t("purchases.noPurchases")}
          </td>
        </tr>
      )}
    </>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
      <table className="w-full text-left min-w-[520px] text-xs sm:text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2">{t("common.date")}</th>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2">
              {t("common.product")}
            </th>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2">{t("common.qty")}</th>
            <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
              {t("purchases.totalCost")}
            </th>
            {showCredit && (
              <th className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                {t("purchases.remaining")}
              </th>
            )}
            <th className="px-2 py-1.5 sm:px-3 sm:py-2">{t("common.status")}</th>
            {showActions && (
              <th className="px-2 py-1.5 sm:px-3 sm:py-2">
                {t("common.actions")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}

