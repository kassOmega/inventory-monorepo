import api from "@/lib/api";

// Local desktop fiscal bridge agent. This is a separate origin from the backend
// API, so these helpers use raw fetch (with CORS) instead of the axios client.
const AGENT_URL =
  process.env.NEXT_PUBLIC_FISCAL_AGENT_URL || "http://localhost:5000";

export interface FiscalTarget {
  kind: "order" | "sale";
  id: number;
}

export interface FiscalAckPayload {
  fsNumber: string;
  ejNumber: string;
  machineSerial?: string;
}

const base = (t: FiscalTarget) =>
  t.kind === "order"
    ? `/restaurant/orders/${t.id}` // order routes live under the restaurant module
    : `/sales/${t.id}`;

/** Universal fiscal summary payload from the backend (order or sale). */
export async function fetchFiscalSummary(t: FiscalTarget) {
  const r = await api.get(`${base(t)}/fiscal-summary`);
  return r.data;
}

export async function markFiscalPrintPending(t: FiscalTarget) {
  await api.post(`${base(t)}/fiscal-print`);
}

export async function ackFiscal(t: FiscalTarget, payload: FiscalAckPayload) {
  const r = await api.patch(`${base(t)}/fiscal-ack`, payload);
  return r.data;
}

export async function markFiscalPrintFailed(t: FiscalTarget, message?: string) {
  await api.post(`${base(t)}/fiscal-print-failed`, { message });
}

/** Dispatch the invoice payload to the local hardware bridge agent. */
export async function dispatchFiscalPrint(
  payload: any,
): Promise<FiscalAckPayload> {
  const res = await fetch(`${AGENT_URL}/api/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Fiscal agent error (HTTP ${res.status})`);
  const data = await res.json();
  if (!data?.fsNumber || !data?.ejNumber) {
    throw new Error("Fiscal agent returned no fs/ej numbers");
  }
  return {
    fsNumber: data.fsNumber,
    ejNumber: data.ejNumber,
    machineSerial: data.machineSerial ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Tenant fiscal config + multi-document batch consolidation
// ---------------------------------------------------------------------------

export interface FiscalBatchTarget {
  orderIds?: number[];
  saleIds?: number[];
}

export interface FiscalConfig {
  id: number;
  tenantId: number;
  tin: string;
  taxName: string;
  address: string | null;
  phone: string | null;
  agentUrl: string;
  agentApiKey: string | null;
  printerVendor: string;
  comPort: string | null;
  baudRate: number | null;
  enableFiscal: boolean;
  // MoR E-Invoicing & Security credentials
  morLiveUrl: string | null;
  morClientId: string | null;
  morClientSecret: string | null;
  morCertificate: string | null;
  terminalId: string | null;
  branchCode: string | null;
}

export async function fetchFiscalConfig(): Promise<FiscalConfig> {
  const r = await api.get("/fiscal/config");
  return r.data;
}

export async function updateFiscalConfig(payload: Partial<FiscalConfig>) {
  const r = await api.put("/fiscal/config", payload);
  return r.data;
}

export async function fetchFiscalBatchSummary(batch: FiscalBatchTarget) {
  const r = await api.post("/fiscal/batch-summary", batch);
  return r.data;
}

export async function markBatchPrintPending(batch: FiscalBatchTarget) {
  await api.post("/fiscal/batch-print", batch);
}

export async function ackFiscalBatch(
  batch: FiscalBatchTarget,
  payload: FiscalAckPayload,
) {
  const r = await api.patch("/fiscal/batch-ack", { ...batch, ...payload });
  return r.data;
}

export async function markBatchPrintFailed(
  batch: FiscalBatchTarget,
  message?: string,
) {
  await api.post("/fiscal/batch-print-failed", { ...batch, message });
}

// ---------------------------------------------------------------------------
// Thermal print payload preparation
// ---------------------------------------------------------------------------

const fmt2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FiscalLineItem {
  description: string;
  barcode: string | null;
  qty: number;
  unitPrice: number;
  taxGroup: string | null;
  lineTotal: number;
  fmtQty: string;
  fmtPrice: string;
  fmtLineTotal: string; // e.g. "*100.00"
}

export interface FiscalPrintPayload {
  type: string;
  reference: string;
  date: string;
  header: {
    companyName: string;
    tin: string | null;
    taxName?: string | null;
    address?: string | null;
    phone?: string | null;
    customerName?: string | null;
  };
  metadata: {
    customerName: string; // default "Walk-in"
    referenceNo: string;
    cashierName: string;
    tableNo: string;
    waiterName: string;
  };
  fiscalIds: {
    ejNumber: string;
    fsNumber: string;
    machineSerial: string;
  };
  documents?: Array<{ type: string; reference: string }>;
  lineItems: FiscalLineItem[];
  totalItemQty: number;
  financials: {
    subtotal: number;
    discount: number;
    serviceChargeAmount: number;
    vatAmount: number;
    grandTotal: number;
    taxableAmount: number;
    vatInclusive: boolean;
    paidAmount: number;
    fmtSubtotal: string; // "*123.45"
    fmtDiscount: string;
    fmtServiceCharge: string;
    fmtTaxable: string;
    fmtVat: string;
    fmtGrandTotal: string;
  };
}

export interface FiscalPrintMeta {
  cashierName?: string;
  waiterName?: string;
  tableNo?: string;
  ejNumber?: string;
  fsNumber?: string;
  machineSerial?: string;
}

function fmtDate(d?: string): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

const fmtCur = (n: number) => `*${fmt2.format(n)}`;

/**
 * Enrich a backend fiscal summary into an Antica/MoR thermal-display payload:
 * every line carries its pre-calculated sub-total + `*`-prefixed currency
 * strings; totals include `totalItemQty` and `taxableAmount`; receipt metadata
 * (customer / reference / cashier / waiter / table) and fiscal ids default and
 * can be overridden via `meta`. `grandTotal` stays the backend's value.
 */
export function prepareFiscalPrintPayload(
  summary: any,
  meta?: FiscalPrintMeta,
): FiscalPrintPayload {
  const financials = summary?.financials ?? {};
  const subtotal = Number(financials.subtotal ?? 0);
  const serviceChargeAmount = Number(financials.serviceChargeAmount ?? 0);
  const vatAmount = Number(financials.vatAmount ?? 0);
  const grandTotal = Number(financials.grandTotal ?? 0);
  const taxableAmount = Math.round((grandTotal - vatAmount) * 100) / 100;

  const lineItems: FiscalLineItem[] = (summary?.lineItems ?? []).map(
    (it: any) => {
      const unitPrice = Number(it.unitPrice ?? 0);
      const qty = Number(it.qty ?? 0);
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      return {
        description: it.description ?? "",
        barcode: it.barcode ?? null,
        qty,
        unitPrice,
        taxGroup: it.taxGroup ?? null,
        lineTotal,
        fmtQty: String(qty),
        fmtPrice: fmt2.format(unitPrice),
        fmtLineTotal: fmtCur(lineTotal),
      };
    },
  );
  const totalItemQty = lineItems.reduce((s, it) => s + it.qty, 0);
  const referenceNo = summary?.reference ?? "";

  return {
    type: summary?.type ?? "",
    reference: referenceNo,
    date: fmtDate(summary?.date),
    header: {
      companyName: summary?.header?.companyName ?? "",
      tin: summary?.header?.tin ?? null,
      taxName: summary?.header?.taxName ?? null,
      address: summary?.header?.address ?? null,
      phone: summary?.header?.phone ?? null,
      customerName: summary?.header?.customerName ?? null,
    },
    metadata: {
      customerName: summary?.header?.customerName || "Walk-in",
      referenceNo,
      cashierName: meta?.cashierName ?? summary?.cashierName ?? "",
      tableNo: meta?.tableNo ?? summary?.tableNo ?? "",
      waiterName: meta?.waiterName ?? summary?.waiterName ?? "",
    },
    fiscalIds: {
      ejNumber: meta?.ejNumber ?? summary?.fiscalIds?.ejNumber ?? "",
      fsNumber: meta?.fsNumber ?? summary?.fiscalIds?.fsNumber ?? "",
      machineSerial:
        meta?.machineSerial ?? summary?.fiscalIds?.machineSerial ?? "",
    },
    documents: summary?.documents,
    lineItems,
    totalItemQty,
    financials: {
      subtotal,
      discount: Number(financials.discount ?? 0),
      serviceChargeAmount,
      vatAmount,
      grandTotal,
      taxableAmount,
      vatInclusive: financials.vatInclusive !== false,
      paidAmount: Number(financials.paidAmount ?? 0),
      fmtSubtotal: fmtCur(subtotal),
      fmtDiscount: fmtCur(Number(financials.discount ?? 0)),
      fmtServiceCharge: fmtCur(serviceChargeAmount),
      fmtTaxable: fmtCur(taxableAmount),
      fmtVat: fmtCur(vatAmount),
      fmtGrandTotal: fmtCur(grandTotal),
    },
  };
}

