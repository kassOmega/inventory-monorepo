"use client";

import { useCallback, useState } from "react";
import {
  ackFiscal,
  dispatchFiscalPrint,
  fetchFiscalSummary,
  FiscalPrintPayload,
  FiscalTarget,
  markFiscalPrintFailed,
  markFiscalPrintPending,
  prepareFiscalPrintPayload,
} from "@/lib/fiscal";
import FiscalPrintPreviewModal from "@/app/components/FiscalPrintPreviewModal";

/**
 * Reusable fiscal print action + status badge. Intercepts the print with a
 * thermal-receipt preview: fetch summary → show preview → on "Confirm & Print"
 * run the full lifecycle (PRINT_PENDING → dispatch to the local agent → ack).
 */
export default function FiscalPrintButton({
  target,
  fiscalStatus,
  receipt,
  onUpdated,
}: {
  target: FiscalTarget;
  fiscalStatus?: string;
  receipt?: { fsNumber?: string; ejNumber?: string } | null;
  onUpdated?: () => void;
}) {
  const [state, setState] = useState<"idle" | "printing" | "done" | "error">(
    "idle",
  );
  const [preview, setPreview] = useState<FiscalPrintPayload | null>(null);
  const [error, setError] = useState("");

  const printed = fiscalStatus === "PRINTED" || state === "done";
  const pending = fiscalStatus === "PRINT_PENDING" || state === "printing";
  const failed = fiscalStatus === "PRINT_FAILED" || state === "error";
  const isPrinting = state === "printing";

  const openPreview = useCallback(async () => {
    setError("");
    try {
      const summary = await fetchFiscalSummary(target);
      setPreview(prepareFiscalPrintPayload(summary));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load fiscal summary");
    }
  }, [target]);

  const confirmPrint = useCallback(async () => {
    if (!preview) return;
    setState("printing");
    try {
      await markFiscalPrintPending(target);
      const agent = await dispatchFiscalPrint(preview);
      await ackFiscal(target, agent);
      setState("done");
      setPreview(null);
      onUpdated?.();
    } catch (e: any) {
      try {
        await markFiscalPrintFailed(target, e?.message ?? "Fiscal print failed");
      } catch {
        // ack-side failure is reported below
      }
      setError(e?.message ?? "Fiscal print failed");
      setState("error");
      setPreview(null);
      onUpdated?.();
    }
  }, [preview, target, onUpdated]);

  if (printed) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[11px] font-medium">
        ✓ Fiscally Printed
        {receipt?.fsNumber ? ` · ${receipt.fsNumber}` : ""}
        {receipt?.ejNumber ? ` / ${receipt.ejNumber}` : ""}
      </span>
    );
  }
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[11px] font-medium">
        Printing…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={openPreview}
        className="text-xs bg-gray-800 text-white rounded px-2.5 py-1 font-medium hover:bg-gray-700 disabled:opacity-40"
      >
        🖨 Print Fiscal Invoice
      </button>
      {failed && (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
          {error ? "Print Failed" : "Print Failed"}
          <button onClick={openPreview} className="underline">
            Retry
          </button>
        </span>
      )}
      {preview && (
        <FiscalPrintPreviewModal
          payload={preview}
          onClose={() => setPreview(null)}
          onConfirm={confirmPrint}
          printing={isPrinting}
        />
      )}
    </span>
  );
}

