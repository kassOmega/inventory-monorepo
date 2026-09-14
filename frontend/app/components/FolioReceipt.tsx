"use client";

// Printable folio receipt, shared by the front-desk checkout modal and the
// unified folios surface. Renders the consolidated per-line bill (each line
// tagged with the service and the staff member who posted it), the money
// summary and who settled it — exactly what the printed receipt reproduces.

import { useTranslation } from "react-i18next";

const money = (n: number | undefined | null) =>
  n == null
    ? "0.00"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : "—");

export default function FolioReceipt({
  bill,
  totals,
  settledBy,
  forced,
  outstanding,
  onClose,
}: {
  bill: any;
  /** Money summary; falls back to the bill's own totals. */
  totals?: {
    charges?: number;
    payments?: number;
    outstanding?: number;
  };
  settledBy?: { name?: string | null; role?: string | null } | null;
  forced?: boolean;
  outstanding?: number;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const lines: any[] = bill?.lines ?? [];
  const charges = totals?.charges ?? bill?.totals?.charges ?? 0;
  const payments = totals?.payments ?? bill?.totals?.payments ?? 0;
  const due = outstanding ?? Math.max(0, Number(charges) - Number(payments));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-800">
          {bill?.reservation?.guestName}
        </h3>
        <p className="text-xs text-gray-500">
          {bill?.reservation?.roomNumber
            ? `${t("hotel.roomPrefix", { number: bill.reservation.roomNumber })} · `
            : ""}
          {bill?.reservation?.checkIn?.slice(0, 10)} →{" "}
          {bill?.reservation?.checkOut?.slice(0, 10)} ·{" "}
          {t("hotel.nightsCount", { count: bill?.reservation?.nights ?? 0 })}
        </p>
      </div>

      <div className="overflow-x-auto border border-gray-100 rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">{t("hotel.billDate")}</th>
              <th className="px-3 py-2">{t("hotel.billService")}</th>
              <th className="px-3 py-2">{t("hotel.billItem")}</th>
              <th className="px-3 py-2">{t("hotel.billStaff")}</th>
              <th className="px-3 py-2 text-right">{t("hotel.billAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                  {fmtDate(l.date)}
                </td>
                <td className="px-3 py-1.5 text-gray-600">{l.serviceLabel}</td>
                <td className="px-3 py-1.5 text-gray-800">
                  {l.description}
                  {l.source === "PACKAGE" && l.guestName && (
                    <span className="text-xs text-gray-400">
                      {" "}
                      · {l.guestName}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-gray-600">
                  {l.staffName ?? "—"}
                  {l.staffRole && (
                    <span className="text-xs text-gray-400">
                      {" "}
                      ({l.staffRole})
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-medium">
                  {l.type === "PAYMENT" ? "-" : ""}
                  {money(l.amount)}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                  {t("hotel.billNoLines")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-gray-50 rounded p-3">
        <div>
          <p className="text-xs text-gray-400">{t("hotel.billCharges")}</p>
          <p className="font-bold text-gray-800">{money(charges)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t("hotel.billPaid")}</p>
          <p className="font-bold text-gray-800">{money(payments)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t("hotel.billOutstanding")}</p>
          <p
            className={`font-bold ${due > 0 ? "text-amber-600" : "text-green-600"}`}
          >
            {money(due)}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {t("hotel.settledBy")}:{" "}
        <span className="font-medium text-gray-700">
          {settledBy?.name ?? bill?.stay?.settledByName ?? "—"}
          {settledBy?.role ? ` (${settledBy.role})` : ""}
        </span>
      </p>
      {forced && (
        <p className="text-xs text-amber-600">
          {t("hotel.checkoutForcedNote")}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium hover:bg-gray-700"
        >
          {t("hotel.printReceipt")}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-100 text-gray-700 rounded px-3 py-2 text-sm font-medium"
          >
            {t("common.close")}
          </button>
        )}
      </div>
    </div>
  );
}
