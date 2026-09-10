"use client";

import { FiscalPrintPayload } from "@/lib/fiscal";

/**
 * Thermal-receipt preview mirroring the Ethiopian MoR / Antica fiscal receipt
 * template. The card is strictly 300px wide with fixed monospace character
 * widths and explicit CSS grids, so no row wraps or overflows the paper.
 * "Confirm & Print" runs the agent dispatch + ack lifecycle.
 */
export default function FiscalPrintPreviewModal({
  payload,
  onClose,
  onConfirm,
  printing = false,
}: {
  payload: FiscalPrintPayload;
  onClose: () => void;
  onConfirm: () => void;
  printing?: boolean;
}) {
  const f = payload.financials;
  const m = payload.metadata;
  const ids = payload.fiscalIds;
  const showServiceCharge = f.serviceChargeAmount > 0;
  const rule = "border-t border-dashed border-black my-1";
  // Description / Qty / Price / Amount columns — fixed widths that fit the
  // 300px thermal width at 11px monospace (~41 chars usable).
  const itemGrid = "grid grid-cols-[1fr_1.75rem_3.25rem_3.75rem] gap-x-1";
  const metaGrid = "grid grid-cols-[5.5rem_1fr] gap-x-1";

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] overflow-y-auto rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Outer thermal card — strictly constrained */}
        <div className="w-[300px] max-w-[300px] overflow-hidden bg-white p-3 font-mono text-[11px] leading-tight text-black shadow-lg rounded border border-gray-200 select-none">
          {/* A. Header (centered, each line truncates rather than wraps) */}
          <div className="text-center space-y-0.5">
            {payload.header.companyName && (
              <p className="font-bold text-sm uppercase truncate">
                {payload.header.companyName}
              </p>
            )}
            {payload.header.tin && (
              <p className="whitespace-nowrap overflow-hidden text-ellipsis">
                TIN: {payload.header.tin}
              </p>
            )}
            {payload.header.taxName && (
              <p className="font-bold uppercase truncate">
                {payload.header.taxName}
              </p>
            )}
            {payload.header.address && (
              <p className="truncate">{payload.header.address}</p>
            )}
            {payload.header.phone && (
              <p className="whitespace-nowrap overflow-hidden text-ellipsis">
                Tel:{payload.header.phone}
              </p>
            )}
          </div>

          {/* Printer audit placeholders — natural width, never clipped */}
          <div className="flex justify-between items-baseline gap-1 mt-1.5">
            <span className="min-w-0 truncate text-left">
              EJ Rec.{ids.ejNumber || "00042056 @1"}
            </span>
            <span className="text-right whitespace-nowrap">
              DATE: {payload.date}
            </span>
          </div>
          <div className="flex justify-between items-baseline gap-1">
            <span className="min-w-0 truncate text-left">
              FS No. {ids.fsNumber || "00040528"}
            </span>
            <span />
          </div>

          {/* B. Document title */}
          <p className="text-center font-bold my-1 truncate">
            ===== CASH INVOICE =====
          </p>

          {/* C. Context metadata grid */}
          <div className="space-y-0.5">
            <div className={metaGrid}>
              <span className="whitespace-nowrap text-left">Customer :</span>
              <span className="truncate">{m.customerName}</span>
            </div>
            <div className={metaGrid}>
              <span className="whitespace-nowrap text-left">Ref No.  :</span>
              <span className="truncate">{m.referenceNo}</span>
            </div>
            <div className={metaGrid}>
              <span className="whitespace-nowrap text-left">Cashier :</span>
              <span className="truncate">{m.cashierName || "—"}</span>
            </div>
            {(m.tableNo || m.waiterName) && (
              <div className="flex justify-between gap-1">
                <span className="min-w-0 truncate text-left">
                  Table: {m.tableNo || "—"}
                </span>
                <span className="whitespace-nowrap text-left">
                  Waiter: {m.waiterName || "—"}
                </span>
              </div>
            )}
          </div>

          {/* D. Line items table header */}
          <div className={rule} />
          <div className={`${itemGrid} font-bold`}>
            <span className="truncate text-left">Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Amount</span>
          </div>
          <div className={rule} />

          {/* E. Line items — description line + values line */}
          <div className="space-y-1">
            {payload.lineItems.map((it, idx) => (
              <div key={idx}>
                <p className="uppercase truncate text-left">{it.description}</p>
                <div className={itemGrid}>
                  <span />
                  <span className="text-right whitespace-nowrap">
                    {it.fmtQty}
                  </span>
                  <span className="text-right whitespace-nowrap">
                    {it.fmtPrice}
                  </span>
                  <span className="text-right whitespace-nowrap">
                    {it.fmtLineTotal}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className={rule} />

          {/* F. Financial totals & tax breakdown */}
          <div className="space-y-0.5">
            <div className="grid grid-cols-[1fr_auto] gap-x-1">
              <span className="truncate">SUBTOTAL:</span>
              <span className="whitespace-nowrap">{f.fmtSubtotal}</span>
            </div>
            {showServiceCharge && (
              <div className="grid grid-cols-[1fr_auto] gap-x-1">
                <span className="truncate">(+) Service Charge (10%):</span>
                <span className="whitespace-nowrap">{f.fmtServiceCharge}</span>
              </div>
            )}
            <div className={rule} />
            <div className="grid grid-cols-[1fr_auto] gap-x-1">
              <span className="truncate">TAXABLE 1:</span>
              <span className="whitespace-nowrap">{f.fmtTaxable}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-1">
              <span className="truncate">TAX 1 15%:</span>
              <span className="whitespace-nowrap">{f.fmtVat}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-1 font-bold text-sm">
              <span className="truncate">TOTAL:</span>
              <span className="whitespace-nowrap">{f.fmtGrandTotal}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-1">
              <span className="truncate">CASH:</span>
              <span className="whitespace-nowrap">{f.fmtGrandTotal}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-1">
              <span className="truncate">ITEM COUNT:</span>
              <span className="whitespace-nowrap">{payload.totalItemQty}</span>
            </div>
          </div>

          <div className={rule} />

          {/* Footer machine serial + preview watermark */}
          <p className="text-center truncate">
            [ET Logo] {ids.machineSerial || "AAD0001542"}
          </p>
          <p className="text-center font-bold mt-1 leading-snug">
            *** PREVIEW ONLY /<br />NOT AN OFFICIAL FISCAL RECEIPT ***
          </p>
        </div>

        {/* Actions */}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={printing}
            className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={printing}
            className="px-3 py-2 text-sm bg-green-600 text-white rounded font-medium disabled:opacity-40"
          >
            {printing ? "Printing…" : "Confirm & Print"}
          </button>
        </div>
      </div>
    </div>
  );
}
