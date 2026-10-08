"use client";
// app/components/PurchaseDetailModal.tsx
//
// The rest of a purchase, one tap away. The list shows only what a shopkeeper
// scans for — the date, the item, the quantity, what it cost and what is still
// owed — so the shop, the sell side, the recorded margin, the payment trail and
// the identifiers live here instead of in more columns.
// Read-only on purpose: approving, paying the vendor back and deleting stay on
// the row's own menu, so there is exactly one place where a purchase changes
// state.
import Modal from "./Modal";
import { recordedMargin, remainingToPay, statusBadge } from "./PurchasesTable";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import { useTranslation } from "react-i18next";
import { ReactNode } from "react";

/** One label/value line of the panel. */
function Row({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b last:border-b-0 min-w-0">
      <span className="text-gray-400 text-xs sm:text-sm" title={title}>
        {label}
      </span>
      <span className="text-right text-xs sm:text-sm font-medium text-gray-800 min-w-0 break-words">
        {children}
      </span>
    </div>
  );
}

export default function PurchaseDetailModal({
  purchase,
  onClose,
}: {
  /** The row to show, or null when the modal is closed. */
  purchase: any;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const p = purchase;
  const isCredit = p?.paymentType === "CREDIT";
  // Same two figures the table reads, from the same helpers, so the modal can
  // never disagree with the row that opened it.
  const remaining = remainingToPay(p);
  const margin = recordedMargin(p);
  const payments: any[] = p?.payments ?? [];

  return (
    <Modal isOpen={!!p} onClose={onClose} title={t("purchases.detailTitle")}>
      {p && (
        <div className="space-y-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 break-words">
              {p.productName}
            </h3>
            {p.publicId && (
              <p className="font-mono text-[11px] text-gray-400 break-all">
                {p.publicId}
              </p>
            )}
          </div>

          {/* Where and how the line was taken. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 border-t pt-2">
            <Row label={t("common.date")}>{formatDate(p.createdAt)}</Row>
            <Row label={t("status.shop")}>{p.shop?.name ?? "—"}</Row>
            {p.vendorCustomer?.name && (
              <Row label={t("purchases.vendor")}>{p.vendorCustomer.name}</Row>
            )}
            <Row label={t("purchases.modeLabel")}>
              {isCredit ? t("purchases.modeCredit") : t("purchases.modePaid")}
            </Row>
            <Row label={t("common.status")}>{statusBadge(p.status)}</Row>
            {isCredit && (
              <Row label={t("purchases.paymentStatus")}>
                {statusBadge(p.paymentStatus)}
              </Row>
            )}
            {p.paymentMethod?.name && (
              <Row label={t("purchases.paymentMethod")}>
                {p.paymentMethod.name}
              </Row>
            )}
            {p.sale?.invoiceNumber && (
              <Row label={t("purchases.invoice")}>
                <span className="font-mono text-xs">{p.sale.invoiceNumber}</span>
              </Row>
            )}
          </div>

          {/* The money, buy side first — the sell side of a credit row is a
              promise until the goods are resold, hence the `~` on its margin. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Row label={t("purchases.unitPrice")}>
              {fmtCurrency(p.unitPrice)}
            </Row>
            <Row label={t("common.qty")}>{p.quantity}</Row>
            <Row label={t("purchases.totalCost")}>
              <span className="font-bold">{fmtCurrency(p.totalCost)}</span>
            </Row>
            <Row label={t("purchases.sellPrice")}>
              {fmtCurrency(p.sellPrice)}
            </Row>
            {Number(p.sellPrice) > 0 && (
              <Row
                label={t("purchases.recordedMargin")}
                title={t("purchases.recordedMarginHint")}
              >
                <span className={margin >= 0 ? "text-green-600" : "text-red-500"}>
                  ~{fmtCurrency(margin)}
                </span>
              </Row>
            )}
            {!isCredit && (
              <Row label={t("purchases.revenue")}>
                {fmtCurrency(p.revenue)}
              </Row>
            )}
            {!isCredit && (
              <Row label={t("purchases.profit")}>
                <span className={p.profit >= 0 ? "text-green-600" : "text-red-500"}>
                  {fmtCurrency(p.profit)}
                </span>
              </Row>
            )}
            {isCredit && (
              <Row label={t("purchases.paidAmount")}>
                <span className="text-green-600">
                  {fmtCurrency(p.amountPaid ?? 0)}
                </span>
              </Row>
            )}
            {isCredit && (
              <Row label={t("purchases.remaining")}>
                <span
                  className={
                    "font-bold " +
                    (remaining > 0 ? "text-red-500" : "text-green-600")
                  }
                >
                  {fmtCurrency(remaining)}
                </span>
              </Row>
            )}
          </div>

          {p.notes && (
            <div className="border-t pt-2">
              <p className="text-gray-400 text-xs sm:text-sm">
                {t("common.notes")}
              </p>
              <p className="text-xs sm:text-sm text-gray-700 break-words">
                {p.notes}
              </p>
            </div>
          )}

          {/* Every payback already made against this line. */}
          {isCredit && (
            <div className="border-t pt-2">
              <h4 className="font-medium text-gray-700 mb-2 text-xs sm:text-sm">
                {t("purchases.paymentHistory")}
              </h4>
              {payments.length === 0 ? (
                <p className="text-xs text-gray-400">
                  {t("purchases.noPayments")}
                </p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <tbody>
                      {payments.map((pay: any) => (
                        <tr key={pay.id} className="border-b last:border-b-0">
                          <td className="p-2 text-gray-500 whitespace-nowrap">
                            {formatDate(pay.paidAt)}
                          </td>
                          <td className="p-2 text-gray-500">
                            {pay.paymentMethod?.name ?? "—"}
                          </td>
                          <td className="p-2 text-gray-500 break-words">
                            {pay.notes ?? ""}
                          </td>
                          <td className="p-2 text-right font-medium text-green-600 whitespace-nowrap">
                            {fmtCurrency(pay.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
