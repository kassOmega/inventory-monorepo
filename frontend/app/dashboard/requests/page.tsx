"use client";
import BarcodeScanner from "@/app/components/BarcodeScanner";
import AiPhotoPicker from "@/app/components/AiPhotoPicker";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import { useConfirm } from "@/app/components/ConfirmProvider";
import FilterRow, { FilterField } from "@/app/components/FilterRow";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { batchLabel, variantLabel } from "@/lib/variantLabel";
import { formatBusinessNumber } from "@/lib/bizNumber";
import VariantLinesEditor, {
  addOrBumpVariantLine,
  VariantSaleLine,
} from "@/app/components/VariantLinesEditor";
import { formatDateTime } from "@/lib/datetime";
import { statusLabel } from "@/lib/statusLabel";
import { fmtCurrency } from "@/lib/currency";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function RequestsPage() {
  const { t } = useTranslation();
  const { user, hasPermission, activeMembership } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const reqPaged = useServerPaging({ pageSize: 20 });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stores, setStores] = useState([]);
  // AI scan (photo → match catalog product) for individual request items.
  const [scanBusyIndex, setScanBusyIndex] = useState<number | null>(null);
  const canAiScan = user?.isSuperuser || hasPermission("ai.requests-assist");

  const handleAiScan = async (images: string[], index: number) => {
    setScanBusyIndex(index);
    try {
      const res = await api.post(
        "/ai/requests/identify-product",
        {
          base64Image: images[0],
          ...(images[1] ? { base64Image2: images[1] } : {}),
        },
        { timeout: 60000 },
      );
      const { product, variant } = res.data;
      if (!product) {
        const ex = res.data.extracted ?? {};
        const nm = [ex.brand, ex.baseName].filter(Boolean).join(" ");
        toast.error(
          nm
            ? t("sales.noAiMatch", { name: nm })
            : t("sales.noAiMatchGeneric"),
        );
        return;
      }
      setProducts((prev) =>
        prev.some((p: any) => p.id === product.id) ? prev : [...prev, product],
      );
      setReqItems((prev) => {
        const next = prev.map((r, i) =>
          i === index
            ? {
                ...r,
                productId: String(product.id),
                variantLines: variant?.id
                  ? [
                      {
                        variantId: String(variant.id),
                        quantity: 1,
                        customPrice: "",
                      },
                    ]
                  : [],
              }
            : r,
        );
        return next;
      });
      const productName = `${product.brand} ${product.baseName}${variant ? ` (${variant.sku || t("sales.variantWord")})` : ""}`;
      toast.success(t("sales.matchedProduct", { name: productName }));
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message || t("sales.aiReadFailed"),
      );
    } finally {
      setScanBusyIndex(null);
    }
  };

  // Manage Modal states
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [itemUpdates, setItemUpdates] = useState<
    { id: number; status: string }[]
  >([]);
  const [dispatchData, setDispatchData] = useState<
    { id: number; quantityDispatched: number }[]
  >([]);
  const [receivedData, setReceivedData] = useState<
    { id: number; quantityReceived: number }[]
  >([]);
  // Status-change timeline for the open request detail.
  const [activities, setActivities] = useState<any[]>([]);

  // Direct sale ("Confirm Receipt & Sell") modal state.
  const [saleReq, setSaleReq] = useState<any>(null);
  const [saleItems, setSaleItems] = useState<
    {
      requestItemId: number;
      productId: number;
      quantity: number;
      quantityReceived: number;
      dispatched: number;
      unitSellPrice: number;
      suggestedPrice: number;
      name: string;
      variantLabel: string;
      variantSku: string;
      variantBarcode: string;
      productSku: string;
      productBarcode: string;
    }[]
  >([]);
  const [saleType, setSaleType] = useState<
    "FULLY_PAID" | "PARTIALLY_PAID" | "CREDITED"
  >("FULLY_PAID");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  // The org's "Cash" method (case-insensitive) — the default payment method.
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [newPaymentMethodName, setNewPaymentMethodName] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [savingSale, setSavingSale] = useState(false);

  // New Request Modal states
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqStoreId, setReqStoreId] = useState("");
  // Autofill the sole location/store when the business has only one.
  useSingleLocationAutofill(stores, reqStoreId, setReqStoreId);
  const [reqItems, setReqItems] = useState<
    {
      productId: string;
      quantity: string;
      categoryId: string;
      variantLines?: VariantSaleLine[];
    }[]
  >([{ productId: "", quantity: "", categoryId: "" }]);

  // Edit mode: the request currently being revised (owner or creator).
  const [editingReq, setEditingReq] = useState<any>(null);
  // Products of the store selected in the request form, with that store's
  // inventory, so shopkeepers can see availability while composing.
  const [storeProducts, setStoreProducts] = useState<any[]>([]);
  const [storeStockMap, setStoreStockMap] = useState<Record<number, number>>(
    {},
  );
  const [variantStockMap, setVariantStockMap] = useState<Record<number, number>>(
    {},
  );

  const [loading, setLoading] = useState(true);

  const fetchRequests = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const query = `status=${statusFilter}&locationId=${locationFilter}&categoryId=${categoryFilter}&productId=${productFilter}&startDate=${startDate}&endDate=${endDate}&page=${reqPaged.page}&pageSize=${reqPaged.pageSize}`;
      const res = await api.get(`/requests?${query}`);
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setRequests(rows);
      reqPaged.setTotal(Array.isArray(body) ? rows.length : (body?.total ?? rows.length));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    api.get("/locations").then((res) => {
      setLocations(res.data);
      setStores(res.data.filter((l: any) => l.type === "STORE"));
    });
    api.get("/categories").then((res) => setCategories(res.data));
    api.get("/products").then((res) => setProducts(res.data));
  }, []);

  // Reset to page 1 when any filter/date changes, then refetch.
  const reqFilterSig = `${statusFilter}|${locationFilter}|${categoryFilter}|${productFilter}|${startDate}|${endDate}`;
  const reqFilterRef = useRef(reqFilterSig);
  useEffect(() => {
    if (reqFilterRef.current !== reqFilterSig) {
      reqFilterRef.current = reqFilterSig;
      if (reqPaged.page !== 1) {
        reqPaged.setPage(1);
        return;
      }
    }
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqFilterSig, reqPaged.page, reqPaged.pageSize]);

  // Silent auto-refresh every 5s + on focus: keeps the list fresh without a
  // loading flash so it never interrupts what the user is doing.
  const fetchRef = useRef(fetchRequests);
  useEffect(() => {
    fetchRef.current = fetchRequests;
  }, [fetchRequests]);
  useEffect(() => {
    const id = setInterval(() => fetchRef.current(true), 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchRef.current(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const openDetail = async (r: any) => {
    openManageModal(r);
    setActivities([]);
    try {
      const res = await api.get(`/requests/${r.id}`);
      setActivities(res.data.activities || []);
    } catch {
      setActivities([]);
    }
  };

  const openSellModal = (r: any) => {
    setSaleReq(r);
    setSaleType("FULLY_PAID");
    setPaidAmount("");
    setPaymentMethodId("");
    setCustomerId("");
    setSaleNotes("");
    setSaleItems(
      (r.items || [])
        .filter((i: any) => isConfirmableItem(r, i))
        .map((i: any) => {
          const outstanding = outstandingFor(r, i);
          return {
            requestItemId: i.id,
            productId: i.productId,
            quantity: 0,
            quantityReceived: outstanding,
            dispatched: i.quantityDispatched ?? 0,
            unitSellPrice: 0,
            suggestedPrice: i.product?.currentSellPrice ?? 0,
            name: `${i.product?.brand ?? ""} ${i.product?.baseName ?? ""}`.trim(),
            variantLabel: i.variant ? variantLabel(i.variant) : "",
            variantSku: i.variant?.sku ?? "",
            variantBarcode: i.variant?.barcode ?? "",
            productSku: i.product?.sku ?? "",
            productBarcode: i.product?.barcode ?? "",
          };
        }),
    );
    api
      .get("/payment-methods")
      .then((res) => {
        setPaymentMethods(res.data);
        const cash = (res.data as any[]).find(
          (m: any) => m.name.toLowerCase() === "cash",
        );
        // Cash is the default + initially selected payment method.
        setPaymentMethodId((prev) => prev || (cash ? String(cash.id) : ""));
      })
      .catch(() => {});
    api
      .get("/customers")
      .then((res) => setCustomers(res.data))
      .catch(() => {});
  };

  const updateSaleItem = (id: number, patch: Partial<typeof saleItems[number]>) =>
    setSaleItems((prev) =>
      prev.map((it) =>
        it.requestItemId === id ? { ...it, ...patch } : it,
      ),
    );

  /** Barcode/QR scan on a received line: adds 1 to its sell quantity when the
   *  code matches that variant (or the product when the line has no variant). */
  const handleSellScan = (id: number, code: string) => {
    const codeL = code.trim().toLowerCase();
    if (!codeL) return;
    const it = saleItems.find((x) => x.requestItemId === id);
    if (!it) return;
    const variantCodes = [it.variantSku, it.variantBarcode]
      .filter(Boolean)
      .map((x) => (x as string).toLowerCase());
    const productCodes = [it.productSku, it.productBarcode]
      .filter(Boolean)
      .map((x) => (x as string).toLowerCase());
    const ok =
      variantCodes.includes(codeL) ||
      (variantCodes.length === 0 && productCodes.includes(codeL));
    if (!ok) {
      toast.error(t("sv.noMatch"));
      return;
    }
    updateSaleItem(id, {
      quantity: Math.min((it.quantity || 0) + 1, it.quantityReceived || 0),
    });
  };

  const handleSubmitSale = async () => {
    if (!saleReq) return;
    const items = saleItems.filter(
      (i) => i.productId && (i.quantityReceived || 0) > 0,
    );
    if (items.length === 0) {
      toast.error(t("requests.noReceivedItems"));
      return;
    }
    for (const i of items) {
      if (i.quantity < 0 || i.quantity > i.quantityReceived) {
        toast.error(
          t("requests.cannotSellMoreReceived", { name: i.name || t("requests.itemFallback") }),
        );
        return;
      }
    }
    if (items.some((i) => i.quantity > 0 && !(i.unitSellPrice > 0))) {
      toast.error(t("requests.sellPriceRequiredItems"));
      return;
    }
    if (
      (saleType === "FULLY_PAID" || saleType === "PARTIALLY_PAID") &&
      !paymentMethodId
    ) {
      toast.error(t("requests.paymentMethodRequired"));
      return;
    }
    if (
      (saleType === "PARTIALLY_PAID" || saleType === "CREDITED") &&
      !customerId
    ) {
      toast.error(t("requests.customerRequiredForCredit"));
      return;
    }
    // Review step: show exactly what will happen so an accidental tap can't
    // confirm receipt & sale without re-checking quantities/prices.
    const soldCount = items.reduce((sum, i) => sum + i.quantity, 0);
    const receivedCount = items.reduce(
      (sum, i) => sum + (i.quantityReceived || 0),
      0,
    );
    const soldTotal = items.reduce(
      (sum, i) => sum + i.quantity * (i.unitSellPrice || 0),
      0,
    );
    const ok = await confirm(
      soldCount > 0
        ? t("requests.confirmSalePrompt", {
            sold: soldCount,
            received: receivedCount,
            total: fmtCurrency(soldTotal),
          })
        : t("requests.confirmReceiptOnlyPrompt", {
            received: receivedCount,
          }),
    );
    if (!ok) return;
    setSavingSale(true);
    try {
      await api.post(`/requests/${saleReq.id}/confirm-sale`, {
        items: items.map((i) => ({
          id: i.requestItemId,
          quantity: i.quantity,
          quantityReceived: i.quantityReceived,
          unitSellPrice: i.unitSellPrice,
        })),
        saleType,
        ...(paidAmount ? { paidAmount: Number(paidAmount) } : {}),
        ...(paymentMethodId
          ? { paymentMethodId: Number(paymentMethodId) }
          : {}),
        ...(customerId ? { customerId: Number(customerId) } : {}),
        ...(saleNotes.trim() ? { notes: saleNotes.trim() } : {}),
      });
      toast.success(
        items.some((i) => i.quantity > 0)
          ? t("requests.receiptConfirmedAndSale")
          : t("requests.receiptConfirmed"),
      );
      setSaleReq(null);
      setSelectedReq(null);
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("requests.failedRecordSale"));
    } finally {
      setSavingSale(false);
    }
  };

  const handleAddPaymentMethod = async () => {
    const name = newPaymentMethodName.trim();
    if (!name) return;
    try {
      const res = await api.post("/payment-methods", { name });
      setPaymentMethods((prev) => [...prev, res.data]);
      setPaymentMethodId(String(res.data.id));
      setNewPaymentMethodName("");
    } catch (err: any) {
      markHandled(err);
      toast.error("Failed to add payment method.");
    }
  };
  const handleAddCustomer = async () => {
    const name = newCustomerName.trim();
    if (!name) return;
    try {
      const res = await api.post("/customers", {
        name,
        ...(newCustomerPhone.trim() ? { phone: newCustomerPhone.trim() } : {}),
      });
      setCustomers((prev) => [...prev, res.data]);
      setCustomerId(String(res.data.id));
      setNewCustomerName("");
      setNewCustomerPhone("");
    } catch (err: any) {
      markHandled(err);
      toast.error(t("requests.failedAddCustomer"));
    }
  };

  // Deep-link: /dashboard/requests?req=<id> opens that request's detail.
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = searchParams.get("req");
    if (!id) return;
    api
      .get(`/requests/${id}`)
      .then((res) => {
        openManageModal(res.data);
        setActivities(res.data.activities || []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Load the selected store's stock so shopkeepers can see availability while
  // composing (or editing) a request.
  useEffect(() => {
    if (!reqStoreId) {
      setStoreProducts([]);
      setStoreStockMap({});
      setVariantStockMap({});
      return;
    }
    api
      .get(`/products?locationId=${reqStoreId}`)
      .then((res) => {
        setStoreProducts(res.data);
        const map: Record<number, number> = {};
        const vmap: Record<number, number> = {};
        for (const p of res.data) {
          map[p.id] = (p.inventory ?? []).reduce(
            (s: number, i: any) => s + (i.quantity ?? 0),
            0,
          );
          for (const inv of p.inventory ?? []) {
            if (inv.variantId != null) {
              vmap[inv.variantId] = (vmap[inv.variantId] ?? 0) + (inv.quantity ?? 0);
            }
          }
        }
        setStoreStockMap(map);
        setVariantStockMap(vmap);
      })
      .catch(() => setStoreProducts([]));
  }, [reqStoreId]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const validItems = reqItems.filter((item) => item.productId);
      if (validItems.length === 0) {
        toast.error(t("requests.addAtLeastOneProduct"));
        return;
      }
      const payloadItems: any[] = [];
      for (const item of validItems) {
        const p = products.find((pr: any) => pr.id === Number(item.productId));
        if (p?.hasVariants) {
          if (!(item.variantLines ?? []).some((l) => l.quantity > 0)) {
            toast.error(
              t("sv.needQty", {
                name: `${p.brand} ${p.baseName}`.trim(),
              }),
            );
            return;
          }
          for (const l of item.variantLines ?? []) {
            if (l.quantity > 0) {
              payloadItems.push({
                productId: Number(item.productId),
                variantId: Number(l.variantId),
                quantityRequested: l.quantity,
              });
            }
          }
        } else {
          payloadItems.push({
            productId: Number(item.productId),
            quantityRequested: item.quantity
              ? Number(item.quantity)
              : undefined,
          });
        }
      }
      const payload = {
        storeId: reqStoreId ? Number(reqStoreId) : undefined,
        items: payloadItems,
      };
      if (editingReq) {
        await api.put(`/requests/${editingReq.id}`, payload);
        toast.success(t("requests.requestUpdated"));
      } else {
        await api.post("/requests", payload);
      }
      setShowReqModal(false);
      setEditingReq(null);
      setReqStoreId("");
      setReqItems([{ productId: "", quantity: "", categoryId: "" }]);
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("requests.failedCreateRequest"));
    }
  };

  const handleScanAt = (index: number, sku: string) => {
    const code = sku.toLowerCase();
    let product = products.find(
      (p: any) =>
        (p.sku || "").toLowerCase() === code ||
        (p.barcode && p.barcode.toLowerCase() === code),
    );
    let matchedVariant: any = null;
    if (!product) {
      for (const p of products) {
        const v = (p.variants ?? []).find(
          (vx: any) =>
            (vx.sku || "").toLowerCase() === code ||
            (vx.barcode && vx.barcode.toLowerCase() === code),
        );
        if (v) {
          product = p;
          matchedVariant = v;
          break;
        }
      }
    }
    if (!product) {
      toast.error(t("restock.noProductForSku", { sku }));
      return;
    }
    const rowHas = reqItems[index];
    const sameProduct = rowHas?.productId === String(product.id);
    if (matchedVariant) {
      const dup = reqItems.some(
        (it, i) =>
          i !== index &&
          String(it.productId) === String(product.id) &&
          (it.variantLines ?? []).some(
            (l) => l.variantId === String(matchedVariant.id),
          ),
      );
      if (dup) {
        toast.error(
          t("requests.alreadyInRequest", {
            name: `${product.brand} ${product.baseName}`.trim(),
          }),
        );
        return;
      }
    } else if (
      reqItems.some(
        (it, i) =>
          i !== index &&
          String(it.productId) === String(product.id) &&
          (it.variantLines ?? []).length === 0,
      )
    ) {
      toast.error(
        t("requests.alreadyInRequest", {
          name: `${product.brand} ${product.baseName}`.trim(),
        }),
      );
      return;
    }
    setReqItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              productId: String(product.id),
              categoryId: product.categoryId
                ? String(product.categoryId)
                : item.categoryId,
              variantLines: matchedVariant
                ? sameProduct
                  ? addOrBumpVariantLine(item.variantLines ?? [], {
                      variantId: String(matchedVariant.id),
                      quantity: 1,
                      customPrice: "",
                    })
                  : [
                      {
                        variantId: String(matchedVariant.id),
                        quantity: 1,
                        customPrice: "",
                      },
                    ]
                : product.hasVariants
                  ? []
                  : undefined,
            }
          : item,
      ),
    );
  };
  // Manage Modal - Owner store/restock data
  const [ownerStoreData, setOwnerStoreData] = useState<
    {
      id: number;
      status: string;
      quantityStored: number;
      newBuyPrice: number;
      newSellPrice: number;
    }[]
  >([]);

  const openManageModal = (req: any) => {
    setSelectedReq(req);
    setItemUpdates(req.items.map((i: any) => ({ id: i.id, status: i.status })));
    setDispatchData(
      req.items.map((i: any) => ({
        id: i.id,
        quantityDispatched:
          req.requestType !== "STORE_TO_OWNER" && isDispatchableItem(req, i)
            ? remainingFor(req, i)
            : 0,
      })),
    );
    setOwnerStoreData(
      req.items.map((i: any) => ({
        id: i.id,
        status: i.status,
        quantityStored:
          req.requestType === "STORE_TO_OWNER" && isDispatchableItem(req, i)
            ? remainingFor(req, i)
            : i.quantityStored || 0,
        newBuyPrice: i.product?.currentBuyPrice || 0,
        newSellPrice: i.product?.currentSellPrice || 0,
      })),
    );
    setReceivedData(
      req.items.map((i: any) => ({
        id: i.id,
        quantityReceived: outstandingFor(req, i),
      })),
    );
  };

  const handleSaveApprovals = async () => {
    try {
      const changed = itemUpdates.filter(
        (u) =>
          u.status !==
          selectedReq?.items.find((i: any) => i.id === u.id)?.status,
      );
      if (changed.length === 0) {
        toast.error(t("requests.noChanges"));
        return;
      }
      await api.patch(`/requests/${selectedReq.id}/items`, {
        items: changed,
      });
      setSelectedReq(null);
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("requests.failedUpdateApprovals"));
    }
  };

  const handleDispatch = async () => {
    const items = dispatchData.filter((d) => {
      const item = selectedReq?.items.find((i: any) => i.id === d.id);
      return d.quantityDispatched > 0 && isDispatchableItem(selectedReq, item);
    });
    for (const d of items) {
      const item = selectedReq?.items.find((i: any) => i.id === d.id);
      if (!item) continue;
      const name = (String(item.product?.brand ?? "") + " " + String(item.product?.baseName ?? "")).trim() || ("Item #" + item.id);
      const requested = item.quantityRequested ?? d.quantityDispatched;
      const already = item.quantityDispatched || 0;
      if (d.quantityDispatched < 1) {
        toast.error(t("requests.qtyAtLeast1", { name }));
        return;
      }
      if (already + d.quantityDispatched > requested) {
        toast.error(
          t("requests.cannotDispatchMore", {
            name,
            requested: String(requested),
          }),
        );
        return;
      }
    }
    if (items.length === 0) {
      toast.error(t("requests.noApprovedItemsToDispatch"));
      return;
    }
    try {
      await api.post(`/requests/${selectedReq.id}/dispatch`, { items });
      setSelectedReq(null);
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err.response?.data?.message ||
          t("requests.failedDispatch"),
      );
    }
  };

  const canConfirmReceipt = (req: any) => {
    if (!hasPermission("requests.confirm")) return false;
    if (!req) return false;
    if (req.requestType === "STORE_TO_OWNER") {
      // Receiving location user (storekeeper OR shop employee) confirms.
      return user?.locationId === req.storeId;
    }
    return req.createdById === user?.id;
  };

  // Keep-it-open: a request stays actionable until every item is fully
  // received. `outstanding` = sent but not yet confirmed; `remaining` = still
  // to be dispatched/stored.
  const outstandingFor = (req: any, item: any) => {
    const sent =
      req?.requestType === "STORE_TO_OWNER"
        ? item.quantityStored || 0
        : item.quantityDispatched || 0;
    return Math.max(0, sent - (item.quantityReceived || 0));
  };
  const remainingFor = (req: any, item: any) => {
    const sent =
      req?.requestType === "STORE_TO_OWNER"
        ? item.quantityStored || 0
        : item.quantityDispatched || 0;
    return Math.max(0, (item.quantityRequested ?? 0) - sent);
  };
  const isConfirmableItem = (req: any, item: any) =>
    [
      "APPROVED",
      "DISPATCHED",
      "STORED",
      "PARTIALLY_RECEIVED",
      "PARTIALLY_FULFILLED",
    ].includes(item.status) && outstandingFor(req, item) > 0;
  const isDispatchableItem = (req: any, item: any) =>
    ["APPROVED", "DISPATCHED", "STORED", "PARTIALLY_RECEIVED", "PARTIALLY_FULFILLED"].includes(
      item.status,
    ) && remainingFor(req, item) > 0;

  const handleConfirmReceipt = async () => {
    if (!selectedReq) return;
    const confirmable = selectedReq.items.filter((i: any) =>
      isConfirmableItem(selectedReq, i),
    );
    if (confirmable.length === 0) {
      toast.error(t("requests.noItemsReadyConfirmation"));
      return;
    }
    const items = confirmable.map((i: any) => {
      const r = receivedData.find((d) => d.id === i.id);
      const qty = r ? Number(r.quantityReceived) : 0;
      return { id: i.id, ...(qty > 0 ? { quantityReceived: qty } : {}) };
    });
    try {
      await api.post(`/requests/${selectedReq.id}/confirm-receipt`, { items });
      toast.success(t("requests.receiptConfirmed"));
      fetchRequests();
      setSelectedReq(null);
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("requests.failedConfirmation"));
    }
  };

  // True once any item has been dispatched/stored/received, at which point the
  // request can no longer be edited or sent back.
  const isProgressed = (req: any) =>
    req?.items?.some(
      (i: any) =>
        i.quantityDispatched > 0 ||
        i.quantityStored > 0 ||
        ["DISPATCHED", "STORED", "RECEIVED", "PARTIALLY_RECEIVED"].includes(
          i.status,
        ),
    );

  const canEditRequest = (req: any) => {
    if (!req || req.status === "CLOSED") return false;
    if (!(req.createdById === user?.id || hasPermission("requests.create")))
      return false;
    return !isProgressed(req);
  };

  // Delete requires the dedicated requests.delete permission. Owners may delete
  // any status; other holders are limited to un-closed, un-progressed requests.
  const canDeleteRequest = (req: any) => {
    if (!req) return false;
    if (!hasPermission("requests.delete")) return false;
    if (user?.isSuperuser) return true;
    if (req.status === "CLOSED" || req.status === "COMPLETED") return false;
    return !isProgressed(req);
  };

  const canSendBack = (req: any) => {
    if (!req || req.requestType === "STORE_TO_OWNER") return false;
    if (req.status === "CLOSED" || isProgressed(req)) return false;
    const dispatchLocationId =
      req.requestType === "STORE_TO_STORE" ? req.fromStoreId : req.storeId;
    const isDispatcher =
      user?.locationType === "STORE" && user?.locationId === dispatchLocationId;
    return Boolean(
      hasPermission("requests.dispatch") && (user?.isSuperuser || isDispatcher),
    );
  };

  const openEditModal = (req: any) => {
    setEditingReq(req);
    setReqStoreId(
      req.requestType === "SHOP_TO_STORE" ? String(req.storeId ?? "") : "",
    );
    setReqItems(
      (() => {
        const rows: {
          productId: string;
          quantity: string;
          categoryId: string;
          variantLines?: VariantSaleLine[];
        }[] = [];
        for (const i of req.items ?? []) {
          const pid = String(i.productId);
          const isVariantLine = i.product?.hasVariants || !!i.variantId;
          if (isVariantLine) {
            const last = rows[rows.length - 1];
            const line = {
              variantId: String(i.variantId),
              quantity: Number(i.quantityRequested ?? 0) || 1,
              customPrice: "",
            };
            if (last && last.productId === pid) {
              last.variantLines = [...(last.variantLines ?? []), line];
            } else {
              rows.push({
                productId: pid,
                quantity: "",
                categoryId: i.product?.categoryId
                  ? String(i.product.categoryId)
                  : "",
                variantLines: [line],
              });
            }
          } else {
            rows.push({
              productId: pid,
              quantity: i.quantityRequested ?? "",
              categoryId: i.product?.categoryId
                ? String(i.product.categoryId)
                : "",
            });
          }
        }
        return rows;
      })(),
    );
    setShowReqModal(true);
  };

  const handleSendBack = async (req: any) => {
    const ok = await confirm(t("requests.sendBackConfirm"));
    if (!ok) return;
    try {
      await api.post(`/requests/${req.id}/send-back`);
      toast.success(t("requests.requestSentBack"));
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err.response?.data?.message || t("requests.failedSendBack"),
      );
    }
  };

  const handleDeleteRequest = async (req: any) => {
    const ok = await confirm(t("requests.deleteRequestConfirm", { id: req.id }));
    if (!ok) return;
    try {
      await api.delete(`/requests/${req.id}`);
      toast.success(t("requests.requestDeleted", { id: req.id }));
      fetchRequests();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("requests.failedDeleteRequest"));
    }
  };

  // Direction labels for the From/To columns and the type badge. From = the
  // origin (an owner-created restock shows the Owner as origin), To = the
  // destination.
  // A standalone-shop restock reuses the STORE_TO_OWNER pipeline with the shop
  // as the receiving location — label it as Shop rather than Store.
  const isShopTarget = (r: any) => r.store?.type === "SHOP";

  // Overall request status resolved from the item states so the UI never
  // shows a stale parent status: when every item is in a final (completed)
  // state the request is COMPLETED regardless of the stored parent value.
  const FINAL_ITEM_STATUSES = [
    "COMPLETED",
    "RECEIVED",
    "SOLD",
    "CANCELLED",
    "REJECTED",
  ];
  const resolveStatus = (r: any) => {
    const items = r?.items ?? [];
    if (
      items.length > 0 &&
      items.every((i: any) => FINAL_ITEM_STATUSES.includes(i.status))
    ) {
      return "COMPLETED";
    }
    return r?.status ?? "PENDING";
  };
  const fromLabel = (r: any) =>
    r.requestType === "STORE_TO_OWNER"
      ? r.createdByIsOwner
        ? t("common.owner")
        : r.store?.name
      : r.requestType === "STORE_TO_STORE"
        ? (r.fromStore?.name ?? r.store?.name)
        : r.shop?.name || "—";
  const toLabel = (r: any) =>
    r.requestType === "STORE_TO_OWNER"
      ? r.createdByIsOwner
        ? r.store?.name || "—"
        : t("common.owner")
      : r.requestType === "STORE_TO_STORE"
        ? r.fromStore?.name
          ? r.store?.name
          : "—"
        : r.store?.name || "—";
  const typeLabel = (r: any) =>
    r.requestType === "STORE_TO_OWNER"
      ? r.createdByIsOwner
        ? isShopTarget(r)
          ? `${t("common.owner")} → ${t("status.shop")}`
          : `${t("common.owner")} → ${t("status.store")}`
        : isShopTarget(r)
          ? `${t("status.shop")} → ${t("common.owner")}`
          : `${t("status.store")} → ${t("common.owner")}`
      : r.requestType === "STORE_TO_STORE"
        ? `${t("status.store")} → ${t("status.store")}`
        : `${t("status.shop")} → ${t("status.store")}`;

  // Who performs the next action — shown as a caption under the request status.
  const nextActorForRequest = (r: any) => {
    switch (resolveStatus(r)) {
      case "PENDING":
      case "PARTIALLY_APPROVED":
        return t("requests.next.ownerApprove");
      case "APPROVED":
        return r.requestType === "STORE_TO_STORE"
          ? t("requests.next.sourceStoreDispatch")
          : t("requests.next.storeDispatch");
      case "PARTIALLY_DISPATCHED":
        return r.requestType === "STORE_TO_STORE"
          ? t("requests.next.sourceStoreFinish")
          : t("requests.next.storeDispatchRemaining");
      case "AWAITING_CONFIRMATION":
        return r.requestType === "STORE_TO_OWNER"
          ? isShopTarget(r)
            ? t("requests.next.shopConfirmReceipt")
            : t("requests.next.storeConfirmReceipt")
          : r.requestType === "STORE_TO_STORE"
            ? t("requests.next.receivingStoreConfirm")
            : t("requests.next.shopConfirmReceipt");
      case "COMPLETED":
        return t("status.completed");
      case "PARTIALLY_RECEIVED":
      case "PARTIALLY_FULFILLED":
        return r.requestType === "STORE_TO_OWNER"
          ? t("requests.next.ownerStoreRemaining")
          : r.requestType === "STORE_TO_STORE"
            ? t("requests.next.sourceStoreDispatchRemaining")
            : t("requests.next.storeDispatchRemaining");
      case "REJECTED":
      case "CANCELLED":
        return t("requests.next.rejectedEditDelete");
      case "CLOSED":
        return t("status.closed");
      default:
        return "";
    }
  };

  // Who performs the next action for a single request item (manage modal).
  const progressText = (r: any) => {
    const items = (r.items ?? []).filter(Boolean);
    if (items.length === 0) return "";
    const done = items.filter((i: any) =>
      ["RECEIVED", "SOLD", "COMPLETED", "REJECTED", "CANCELLED"].includes(
        i.status,
      ),
    ).length;
    if (done > 0 && done < items.length)
      return t("requests.progressItemsCompleted", {
        done: String(done),
        total: String(items.length),
      });
    const dispatched = items.filter(
      (i: any) => (i.quantityDispatched || 0) > 0 || (i.quantityStored || 0) > 0,
    ).length;
    if (dispatched > 0 && dispatched < items.length)
      return t("requests.progressDispatched", {
        dispatched: String(dispatched),
        total: String(items.length),
      });
    return "";
  };

  const nextActorForItem = (r: any, item: any) => {
    switch (item.status) {
      case "PENDING":
        return r.requestType === "STORE_TO_OWNER"
          ? t("requests.next.ownerStoreReject")
          : t("requests.next.ownerApprove");
      case "APPROVED":
        return (item.quantityDispatched || 0) > 0
          ? t("requests.next.partiallyDispatchedCaption")
          : r.requestType === "STORE_TO_STORE"
            ? t("requests.next.sourceStoreDispatch")
            : t("requests.next.storeDispatch");
      case "STORED":
        return isShopTarget(r)
          ? t("requests.next.shopConfirmReceipt")
          : t("requests.next.storeConfirmReceipt");
      case "DISPATCHED":
        return r.requestType === "STORE_TO_STORE"
          ? t("requests.next.receivingStoreConfirm")
          : t("requests.next.shopConfirmReceipt");
      case "REJECTED":
        return t("status.rejected");
      case "CANCELLED":
        return t("status.cancelled");
      case "RECEIVED":
        return t("status.received");
      case "COMPLETED":
        return t("status.completed");
      case "PARTIALLY_RECEIVED":
      case "PARTIALLY_FULFILLED":
        return t("requests.next.partiallyFulfilledCaption");
      default:
        return "";
    }
  };

  const statuses = [
    "PENDING",
    "PARTIALLY_APPROVED",
    "APPROVED",
    "REJECTED",
    "PARTIALLY_DISPATCHED",
    "PARTIALLY_RECEIVED",
    "PARTIALLY_FULFILLED",
    "COMPLETED",
    "CANCELLED",
    "AWAITING_CONFIRMATION",
    "CLOSED",
  ];

  if (loading) return <Loading className="py-24" />;

  // Owner-only businesses (no staff) don't use the stock-request flow — hide
  // the board and point the owner at Restock or the Users page instead.
  const hasStaff = (activeMembership?.staffCount ?? 0) > 0;

  if (!hasStaff) {
    return (
      <div className="max-w-xl mx-auto mt-12 text-center">
        <div className="text-4xl mb-3">👥</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">
          {t("requests.noTeamMembers")}
        </h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          {t("requests.noTeamHintBefore")}{" "}
          <Link href="/dashboard/users" className="text-blue-600 hover:underline">
            {t("nav.users")}
          </Link>{" "}
          {t("requests.noTeamHintAfter")}{" "}
          <Link href="/dashboard/restock" className="text-blue-600 hover:underline">
            {t("nav.restock")}
          </Link>{" "}
          {t("requests.noTeamHintEnd")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("requests.title")}
        </h1>
        {hasPermission("requests.create") && (
          <button
            onClick={() => setShowReqModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {t("requests.newRequest")}
          </button>
        )}
      </div>

      {/* Global Filters */}
      <FilterRow>
        <FilterField label={t("common.status")}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border p-2 rounded-lg w-full bg-white text-sm"
          >
            <option value="">{t("common.all")}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </FilterField>

        {hasPermission("requests.approve") && (
          <FilterField label={t("common.location")}>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="border p-2 rounded-lg w-full bg-white text-sm"
            >
              <option value="">{t("common.all")}</option>
              {locations.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FilterField>
        )}

        <FilterField label={t("products.category")}>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border p-2 rounded-lg w-full bg-white text-sm"
          >
            <option value="">{t("common.all")}</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label={t("common.product")}>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="border p-2 rounded-lg w-full bg-white text-sm"
          >
            <option value="">{t("common.all")}</option>
            {products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.baseName}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label={t("common.startDate")}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border p-2 rounded-lg w-full text-sm"
          />
        </FilterField>

        <FilterField label={t("common.endDate")}>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border p-2 rounded-lg w-full text-sm"
          />
        </FilterField>
      </FilterRow>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[600px] sm:min-w-[700px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("requests.idHeader")}</th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("requests.typeHeader")}</th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("requests.fromHeader")}</th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("requests.toHeader")}</th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">
                <span className="block">{t("requests.itemsSummary")}</span>
                <span className="mt-0.5 flex text-[10px] uppercase font-medium text-gray-400">
                  <span className="flex-1 text-center">{t("products.name")}</span>
                  <span className="w-10 text-center">{t("common.qty")}</span>
                </span>
              </th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("common.status")}</th>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("requests.actionHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r: any) => (
              <tr
                key={r.id}
                onClick={() => openDetail(r)}
                className="border-b hover:bg-gray-50 cursor-pointer"
              >
                <td
                  className="p-2 sm:p-3 md:p-4 whitespace-nowrap font-medium"
                  title={r.publicId ?? undefined}
                >
                  {r.numberLabel ??
                    formatBusinessNumber("REQ", r.number) ??
                    `#${r.id}`}
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap">
                  <span
                    className={`px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs rounded-full font-semibold ${
                      r.requestType === "STORE_TO_OWNER"
                        ? "bg-purple-100 text-purple-800"
                        : r.requestType === "STORE_TO_STORE"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-indigo-100 text-indigo-800"
                    }`}
                  >
                    {typeLabel(r)}
                  </span>
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap text-xs sm:text-sm font-medium">
                  {fromLabel(r)}
                  {r.createdByName && (
                    <div className="text-[10px] text-gray-400 font-normal">
                      {r.createdByName}
                    </div>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                  {toLabel(r)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                  <table className="w-full">
                    <tbody>
                      {(r.items.length > 3 ? r.items.slice(0, 2) : r.items).map(
                        (i: any, idx: number) => (
                          <tr
                            key={idx}
                            className={
                              idx > 0 ? "border-t border-gray-200" : ""
                            }
                          >
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {i.product?.baseName}
                              {i.variant && (
                                <span className="text-gray-400">
                                  {" "}• {variantLabel(i.variant)}
                                </span>
                              )}
                              {i.batch && (
                                <span className="block text-[10px] text-gray-400">
                                  {batchLabel(i.batch)}
                                </span>
                              )}
                            </td>
                            <td className="py-1 w-10 whitespace-nowrap text-gray-500">
                              {i.quantityRequested ?? i.quantityStored ?? "—"}
                            </td>
                          </tr>
                        ),
                      )}
                      {r.items.length > 3 && (
                        <tr className="border-t border-gray-200">
                          <td
                            colSpan={2}
                            className="py-1 text-blue-600 font-medium"
                          >
                            +{t("requests.moreItems", { n: r.items.length - 2 })}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap">
                  <span
                    className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs rounded-full font-semibold ${
                      resolveStatus(r) === "PENDING"
                        ? "bg-yellow-100 text-yellow-800"
                        : resolveStatus(r) === "AWAITING_CONFIRMATION"
                          ? "bg-orange-100 text-orange-800"
                          : resolveStatus(r) === "APPROVED" ||
                              resolveStatus(r) === "PARTIALLY_APPROVED"
                            ? "bg-blue-100 text-blue-800"
                            : resolveStatus(r) === "REJECTED" ||
                                resolveStatus(r) === "CANCELLED"
                              ? "bg-red-100 text-red-800"
                              : resolveStatus(r) === "PARTIALLY_RECEIVED" ||
                                  resolveStatus(r) === "PARTIALLY_FULFILLED" ||
                                  resolveStatus(r) === "PARTIALLY_DISPATCHED"
                                ? "bg-amber-100 text-amber-800"
                                : resolveStatus(r) === "CLOSED"
                                  ? "bg-gray-100 text-gray-600"
                                  : "bg-green-100 text-green-800"
                    }`}
                  >
                    {resolveStatus(r) === "AWAITING_CONFIRMATION"
                      ? t("requests.confirmationPending")
                      : statusLabel(resolveStatus(r))}
                  </span>
                  {progressText(r) && (
                    <div className="mt-0.5 text-[10px] font-semibold text-amber-600">
                      {progressText(r)}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {nextActorForRequest(r)}
                  </div>
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <RowActionsMenu
                    items={[
                      { label: t("requests.manageAction"), onClick: () => openManageModal(r) },
                      ...(canEditRequest(r)
                        ? [{ label: t("common.edit"), onClick: () => openEditModal(r) }]
                        : []),
                      ...(canSendBack(r)
                        ? [
                            {
                              label: t("requests.sendBackAction"),
                              onClick: () => handleSendBack(r),
                              color: "text-amber-600",
                            },
                          ]
                        : []),
                      ...(canDeleteRequest(r)
                        ? [
                            {
                              label: t("common.delete"),
                              onClick: () => handleDeleteRequest(r),
                              color: "text-red-500",
                            },
                          ]
                        : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-4 text-center text-gray-500 text-xs sm:text-sm"
                >
                  {t("requests.noRequestsFilters")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={reqPaged.page}
        totalPages={reqPaged.totalPages}
        total={reqPaged.total}
        rangeStart={reqPaged.rangeStart}
        rangeEnd={reqPaged.rangeEnd}
        onPrev={reqPaged.prev}
        onNext={reqPaged.next}
        onPage={reqPaged.setPage}
        onPageSizeChange={reqPaged.setPageSize}
        pageSize={reqPaged.pageSize}
      />

      {/* Manage / Detail Request Modal */}
      <Modal
        isOpen={!!selectedReq}
        onClose={() => setSelectedReq(null)}
        title={t("requests.requestTitle", { id: selectedReq?.id })}
      >
        <div className="space-y-4">
          {selectedReq && (
            <>
              {/* Request summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700 border-b pb-3">
                <div>
                  <span className="text-gray-400">{t("requests.typeColon")}</span>{" "}
                  {typeLabel(selectedReq)}
                </div>
                <div>
                  <span className="text-gray-400">{t("requests.statusColon")}</span>{" "}
                  <span className="font-medium">
                    {statusLabel(resolveStatus(selectedReq))}
                  </span>
                  {progressText(selectedReq) && (
                    <span className="ml-1 text-[10px] font-semibold text-amber-600">
                      ({progressText(selectedReq)})
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-gray-400">{t("requests.fromColon")}</span>{" "}
                  {fromLabel(selectedReq)}
                </div>
                <div>
                  <span className="text-gray-400">{t("requests.toColon")}</span>{" "}
                  {toLabel(selectedReq)}
                </div>
                <div>
                  <span className="text-gray-400">{t("requests.createdByLabel")}</span>{" "}
                  {selectedReq.createdByName || "—"}
                </div>
                <div>
                  <span className="text-gray-400">{t("requests.createdAtLabel")}</span>{" "}
                  {formatDateTime(selectedReq.createdAt)}
                </div>
              </div>

              {/* All items */}
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-1">
                  {t("requests.itemsCount", { count: selectedReq.items.length })}
                </p>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">{t("requests.productCol")}</th>
                        <th className="p-2 text-right whitespace-nowrap">{t("requests.requested")}</th>
                        <th className="p-2 text-right whitespace-nowrap">{t("requests.dispatched")}</th>
                        <th className="p-2 text-right whitespace-nowrap">{t("requests.stored")}</th>
                        <th className="p-2 text-right whitespace-nowrap">{t("requests.received")}</th>
                        <th className="p-2 text-left">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReq.items.map((item: any) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-2 whitespace-nowrap">
                            {item.product?.brand} {item.product?.baseName}
                            {item.variant && (
                              <span className="text-gray-500">
                                {" "}• {variantLabel(item.variant)}
                              </span>
                            )}
                            {item.batch && (
                              <span className="block text-[10px] text-gray-400">
                                {batchLabel(item.batch)}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {item.quantityRequested ?? "—"}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {item.quantityDispatched ?? 0}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {item.quantityStored ?? 0}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {item.quantityReceived ?? 0}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            {item.status.replace(/_/g, " ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status-change timeline */}
              {activities.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">
                    {t("requests.statusHistory")}
                  </p>
                  <div className="space-y-2">
                    {activities.map((a: any) => (
                      <div
                        key={a.id}
                        className="flex items-start gap-2 text-xs"
                      >
                        <span className="mt-0.5 h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800">
                            <span className="font-medium">
                              {a.action.replace(/_/g, " ")}
                            </span>
                            {a.details ? ` — ${a.details}` : ""}
                          </p>
                          <p className="text-gray-400">
                            {a.actorName || "—"} · {formatDateTime(a.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {selectedReq?.items.map((item: any) => {
            const update = itemUpdates.find((u) => u.id === item.id);
            const dispatch = dispatchData.find((d) => d.id === item.id);
            const storeData = ownerStoreData.find((d) => d.id === item.id);
            const isStoreToOwner =
              selectedReq?.requestType === "STORE_TO_OWNER";
            const isClosed = selectedReq?.status === "CLOSED";

            return (
              <div
                key={item.id}
                className="border p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div>
                  <p className="font-semibold">
                    {item.product?.brand} {item.product?.baseName}
                    {item.variant && (
                      <span className="text-gray-500 text-sm font-normal">
                        {" "}• {variantLabel(item.variant)}
                      </span>
                    )}
                    {item.batch && (
                      <span className="block text-[11px] text-gray-400 font-normal">
                        {batchLabel(item.batch)}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    {t("requests.requestedSummary", {
                      qty: item.quantityRequested ?? "—",
                    })}
                    {isStoreToOwner
                      ? ` | ${t("requests.storedSummary", { qty: item.quantityStored || 0 })}`
                      : ` | ${t("requests.dispatchedSummary", { qty: item.quantityDispatched || 0 })}`}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-gray-500">
                    {t("requests.statusColon")}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.status === "PENDING"
                          ? "bg-yellow-100 text-yellow-800"
                          : item.status === "APPROVED"
                            ? "bg-blue-100 text-blue-800"
                            : item.status === "REJECTED" ||
                                item.status === "CANCELLED"
                              ? "bg-red-100 text-red-800"
                              : item.status === "DISPATCHED"
                                ? "bg-indigo-100 text-indigo-800"
                                : item.status === "STORED"
                                  ? "bg-purple-100 text-purple-800"
                                  : item.status === "PARTIALLY_RECEIVED" ||
                                      item.status === "PARTIALLY_FULFILLED"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-green-100 text-green-800"
                      }`}
                    >
                      {statusLabel(item.status)}
                    </span>
                    {item.confirmedAt
                      ? t("requests.confirmedOn", {
                          date: new Date(item.confirmedAt).toLocaleDateString(),
                        })
                      : ""}
                  </p>
                  {(item.status === "RECEIVED" ||
                    item.status === "COMPLETED" ||
                    item.status === "PARTIALLY_RECEIVED" ||
                    item.status === "PARTIALLY_FULFILLED") && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t("requests.receivedColon")} {item.quantityReceived ?? 0}
                      {(item.status === "PARTIALLY_RECEIVED" ||
                        item.status === "PARTIALLY_FULFILLED") &&
                        ` ${t("requests.shortBy", {
                          n: String(
                            (isStoreToOwner
                              ? item.quantityStored || 0
                              : item.quantityDispatched || 0) -
                              (item.quantityReceived ?? 0),
                          ),
                        })}`}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">
                    {nextActorForItem(selectedReq, item)}
                  </p>
                </div>

                {/* Owner - Shop→Store: Approve/Reject */}
                {!isClosed && hasPermission("requests.approve") && !isStoreToOwner && (
                  <select
                    value={update?.status || item.status}
                    onChange={(e) =>
                      setItemUpdates(
                        itemUpdates.map((u) =>
                          u.id === item.id
                            ? { ...u, status: e.target.value }
                            : u,
                        ),
                      )
                    }
                    className="border p-2 rounded-lg bg-white"
                    disabled={[
                      "DISPATCHED",
                      "STORED",
                      "RECEIVED",
                      "PARTIALLY_RECEIVED",
                    ].includes(item.status)}
                  >
                    <option value="PENDING">{t("status.pending")}</option>
                    <option value="APPROVED">{t("requests.approve")}</option>
                    <option value="REJECTED">{t("requests.reject")}</option>
                  </select>
                )}

                {/* Owner - Store→Owner: Store/Reject with qty + prices */}
                {!isClosed &&
                  hasPermission("requests.approve") &&
                  isStoreToOwner &&
                  selectedReq?.createdById !== user?.id && (
                    <div className="flex flex-col gap-2">
                      <select
                        value={
                          item.status === "STORED" ||
                          item.status === "PARTIALLY_RECEIVED"
                            ? "STORED"
                            : storeData?.status || item.status
                        }
                        onChange={(e) =>
                          setOwnerStoreData(
                            ownerStoreData.map((d) =>
                              d.id === item.id
                                ? { ...d, status: e.target.value }
                                : d,
                            ),
                          )
                        }
                        className="border p-2 rounded-lg bg-white"
                        disabled={["RECEIVED", "SOLD"].includes(item.status)}
                      >
                        <option value="PENDING">{t("status.pending")}</option>
                        <option value="STORED">{t("requests.store")}</option>
                        <option value="REJECTED">{t("requests.reject")}</option>
                      </select>
                      {(storeData?.status === "STORED" ||
                        item.status === "STORED" ||
                        item.status === "PARTIALLY_RECEIVED") && (
                        <>
                          <input
                            type="number"
                            min="0"
                            placeholder={t("requests.qtyStoredPlaceholder")}
                            value={storeData?.quantityStored ?? 0}
                            onChange={(e) =>
                              setOwnerStoreData(
                                ownerStoreData.map((d) =>
                                  d.id === item.id
                                    ? {
                                        ...d,
                                        quantityStored: Number(e.target.value),
                                      }
                                    : d,
                                ),
                              )
                            }
                            className="border p-1 rounded w-24 text-sm"
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder={t("requests.buyPricePlaceholder")}
                            value={storeData?.newBuyPrice ?? 0}
                            onChange={(e) =>
                              setOwnerStoreData(
                                ownerStoreData.map((d) =>
                                  d.id === item.id
                                    ? {
                                        ...d,
                                        newBuyPrice: Number(e.target.value),
                                      }
                                    : d,
                                ),
                              )
                            }
                            className="border p-1 rounded w-24 text-sm"
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder={t("requests.sellPricePlaceholder")}
                            value={storeData?.newSellPrice ?? 0}
                            onChange={(e) =>
                              setOwnerStoreData(
                                ownerStoreData.map((d) =>
                                  d.id === item.id
                                    ? {
                                        ...d,
                                        newSellPrice: Number(e.target.value),
                                      }
                                    : d,
                                ),
                              )
                            }
                            className="border p-1 rounded w-24 text-sm"
                          />
                        </>
                      )}
                    </div>
                  )}

                {/* Storekeeper - Shop→Store: Dispatch */}
                {!isClosed &&
                  user?.locationType === "STORE" &&
                  hasPermission("requests.dispatch") &&
                  isDispatchableItem(selectedReq, item) &&
                  !isStoreToOwner && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{t("requests.dispatchQtyLabel")}</span>
                      <input
                        type="number"
                        min="1"
                        max={remainingFor(selectedReq, item)}
                        value={dispatch?.quantityDispatched || 0}
                        onChange={(e) =>
                          setDispatchData(
                            dispatchData.map((d) =>
                              d.id === item.id
                                ? {
                                    ...d,
                                    quantityDispatched: Number(e.target.value),
                                  }
                                : d,
                            ),
                          )
                        }
                        className="border p-2 rounded-lg w-24"
                      />
                    </div>
                  )}

                {/* Receiving party confirms — enter actual received qty */}
                {!isClosed &&
                  canConfirmReceipt(selectedReq) &&
                  isConfirmableItem(selectedReq, item) && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{t("requests.receivedQtyLabel")}</span>
                      <input
                        type="number"
                        min="1"
                        max={outstandingFor(selectedReq, item)}
                        value={
                          receivedData.find((d) => d.id === item.id)
                            ?.quantityReceived ?? 0
                        }
                        onChange={(e) =>
                          setReceivedData(
                            receivedData.map((d) =>
                              d.id === item.id
                                ? {
                                    ...d,
                                    quantityReceived: Number(e.target.value),
                                  }
                                : d,
                            ),
                          )
                        }
                        className="border p-2 rounded-lg w-24"
                      />
                      {(() => {
                        const expectedQty = outstandingFor(selectedReq, item);
                        const enteredQty =
                          receivedData.find((d) => d.id === item.id)
                            ?.quantityReceived ?? 0;
                        return enteredQty > 0 && enteredQty < expectedQty ? (
                          <p className="text-xs text-amber-600 mt-1">
                            {t("requests.shortageNote", {
                              n: String(expectedQty - enteredQty),
                            })}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  )}
              </div>
            );
          })}

          <div className="mt-6 flex gap-2 flex-wrap">
            {hasPermission("requests.approve") &&
              selectedReq?.requestType === "SHOP_TO_STORE" && (
                <button
                  onClick={handleSaveApprovals}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg flex-1"
                >
                  {t("requests.saveApprovals")}
                </button>
              )}
            {hasPermission("requests.approve") &&
              selectedReq?.requestType === "STORE_TO_OWNER" && (
                <button
                  onClick={async () => {
                    if (!selectedReq) return;
                    try {
                      await api.patch(`/requests/${selectedReq.id}/items`, {
                        items: ownerStoreData.map((d) => ({
                          id: d.id,
                          status: d.status,
                          quantityStored: d.quantityStored,
                          newBuyPrice: d.newBuyPrice,
                          newSellPrice: d.newSellPrice,
                        })),
                      });
                      toast.success("Items stored!");
                      fetchRequests();
                      setSelectedReq(null);
                    } catch (err: any) {
                      markHandled(err);
                      toast.error(err.response?.data?.message || "Failed.");
                    }
                  }}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg flex-1"
                >
                  {t("requests.saveApprovalActions")}
                </button>
              )}
            {user?.locationType === "STORE" &&
              hasPermission("requests.dispatch") &&
              selectedReq?.requestType === "SHOP_TO_STORE" && (
                <button
                  onClick={handleDispatch}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg flex-1"
                >
                  {t("requests.dispatchItems")}
                </button>
              )}
            {canConfirmReceipt(selectedReq) &&
              selectedReq?.requestType === "SHOP_TO_STORE" &&
              selectedReq?.items.some((i: any) =>
                isConfirmableItem(selectedReq, i),
              ) && (
                <button
                  onClick={() => openSellModal(selectedReq)}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex-1"
                >
                  {t("requests.confirmReceiptSell")}
                </button>
              )}
            {canConfirmReceipt(selectedReq) &&
              selectedReq?.items.some((i: any) =>
                isConfirmableItem(selectedReq, i),
              ) && (
                <button
                  onClick={handleConfirmReceipt}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex-1"
                >
                  {t("requests.confirmReceipt")}
                </button>
              )}
            <button
              onClick={() => setSelectedReq(null)}
              className="bg-gray-200 px-4 py-2 rounded-lg"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create New Request Modal */}
      <Modal
        isOpen={showReqModal}
        onClose={() => setShowReqModal(false)}
        title={
          editingReq
            ? t("requests.editRequestTitle", { id: editingReq.id })
            : user?.locationType === "STORE"
              ? t("requests.requestRestock")
              : t("requests.requestStock")
        }
      >
        <form onSubmit={handleCreateRequest} className="grid grid-cols-1 gap-4">
          {/* Store selector — only for shopkeepers */}
          {user?.locationType !== "STORE" && (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("requests.requestingFrom")}
              </label>
              {stores.length === 0 ? (
                <>
                  <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    {t("requests.noStoreYet")}{" "}
                    <b>{t("requests.directlyToOwner")}</b>{" "}
                    {t("requests.forReviewRestock")}
                  </p>
                  <input type="hidden" value="" />
                </>
              ) : (
                <select
                  value={reqStoreId}
                  onChange={(e) => setReqStoreId(e.target.value)}
                  className="border p-2 rounded-lg w-full bg-white"
                  required
                >
                  <option value="">{t("requests.selectStore")}</option>
                  {stores.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {user?.locationType === "STORE" && (
            <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
              {t("requests.storeRequestInfo")}
            </p>
          )}

          {/* Dynamic items */}
          {reqItems.map((item, idx) => {
            const rowProducts = products.filter(
              (p: any) =>
                !item.categoryId || String(p.categoryId) === item.categoryId,
            );
            const rowProduct = products.find(
              (p: any) => p.id === Number(item.productId),
            );
            const storeRow = storeProducts.find(
              (sp: any) => sp.id === Number(item.productId),
            );
            const isVariantRow = !!rowProduct?.hasVariants;
            return (
              <div
                key={idx}
                className="border p-3 rounded-lg space-y-2 bg-gray-50"
              >
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="w-full sm:w-44">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {t("products.category")}
                    </label>
                    <select
                      value={item.categoryId}
                      onChange={(e) => {
                        const newItems = [...reqItems];
                        newItems[idx] = {
                          ...newItems[idx],
                          categoryId: e.target.value,
                          productId: "",
                          variantLines: [],
                        };
                        setReqItems(newItems);
                      }}
                      className="border p-2 rounded-lg w-full bg-white text-sm"
                    >
                      <option value="">{t("common.all")}</option>
                      {categories.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {t("requests.product")}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <SearchableSelect
                        options={rowProducts.map((p: any) => ({
                          value: String(p.id),
                          label: `${p.brand} ${p.baseName}`.trim(),
                          searchText: `${p.brand} ${p.baseName} ${p.sku}`,
                          disabled: reqItems.some(
                            (r, i) =>
                              r.productId === String(p.id) && i !== idx,
                          ),
                        }))}
                        value={item.productId}
                        onChange={(v) => {
                          const newItems = [...reqItems];
                          newItems[idx] = {
                            ...newItems[idx],
                            productId: v,
                            variantLines: [],
                          };
                          setReqItems(newItems);
                        }}
                        placeholder={t("restock.searchProduct")}
                        className="flex-1"
                      />
                      <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:justify-start">
                        {canAiScan && (
                          <AiPhotoPicker
                            compact
                            buttonLabel="AI"
                            busy={scanBusyIndex === idx}
                            onImages={(images) => handleAiScan(images, idx)}
                          />
                        )}
                        <BarcodeScanner
                          onScan={(sku) => handleScanAt(idx, sku)}
                          className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {isVariantRow ? (
                  <VariantLinesEditor
                    hidePrice
                    allowOutOfStock
                    product={storeRow ?? rowProduct}
                    lines={item.variantLines ?? []}
                    onChange={(lines) => {
                      const newItems = [...reqItems];
                      newItems[idx].variantLines = lines;
                      setReqItems(newItems);
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-40">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {t("requests.qtyOptional")}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => {
                          const newItems = [...reqItems];
                          newItems[idx].quantity = e.target.value;
                          setReqItems(newItems);
                        }}
                        className="border p-2 rounded-lg w-full text-sm"
                      />
                      {reqStoreId &&
                        storeStockMap[Number(item.productId)] !== undefined && (
                          <p
                            className={`text-[10px] mt-0.5 ${
                              storeStockMap[Number(item.productId)] <= 0
                                ? "text-red-500"
                                : "text-gray-400"
                            }`}
                          >
                            {t("sv.storeStock")}:{" "}
                            {storeStockMap[Number(item.productId)]}
                          </p>
                        )}
                    </div>
                  </div>
                )}

                {reqItems.length > 1 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setReqItems(reqItems.filter((_, i) => i !== idx))
                      }
                      className="text-red-400 hover:text-red-600 text-sm font-medium"
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setReqItems([
                  ...reqItems,
                  { productId: "", quantity: "", categoryId: "" },
                ])
              }
              className="flex-1 bg-gray-100 text-gray-700 p-2 rounded-lg text-sm border border-dashed"
            >
              {t("requests.addAnotherItem")}
            </button>
          </div>

          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg mt-2 font-medium"
          >
            {editingReq ? t("requests.updateRequestTitle") : t("requests.submitRequest")}
          </button>
        </form>
      </Modal>

      {/* Confirm Receipt & Sell — Direct Sale Modal */}
      <Modal
        isOpen={!!saleReq}
        onClose={() => setSaleReq(null)}
        title={t("requests.sellFromRequestTitle", { id: saleReq?.id })}
      >
        <div className="space-y-4">
          {saleReq && (
            <>
              <p className="text-sm text-gray-500">
                {t("requests.sellIntro")}
              </p>

              <div className="space-y-2">
                <p className="text-[11px] text-gray-400">{t("sv.sellZero")}</p>
                {(() => {
                  const groups: {
                    productId: number;
                    name: string;
                    rows: typeof saleItems;
                  }[] = [];
                  for (const it of saleItems) {
                    const g = groups[groups.length - 1];
                    if (g && g.productId === it.productId) g.rows.push(it);
                    else
                      groups.push({
                        productId: it.productId,
                        name: it.name,
                        rows: [it],
                      });
                  }
                  return groups.map((grp) => (
                    <div key={grp.productId} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{grp.name || "—"}</p>
                        {grp.rows.length > 1 && (
                          <span className="text-[10px] text-gray-400">
                            {t("sv.count", { n: String(grp.rows.length) })}
                          </span>
                        )}
                      </div>
                      {grp.rows.map((item) => (
                        <div
                          key={item.requestItemId}
                          className="border-t border-gray-100 mt-2 pt-2 first:border-0 first:mt-0 first:pt-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            {item.variantLabel ? (
                              <p className="text-sm text-gray-700">
                                • {item.variantLabel}
                                {item.variantSku ? (
                                  <span className="text-[10px] text-gray-400">
                                    {" "}· {item.variantSku}
                                  </span>
                                ) : null}
                              </p>
                            ) : (
                              <span />
                            )}
                            <BarcodeScanner
                              onScan={(code) =>
                                handleSellScan(item.requestItemId, code)
                              }
                              className="px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
                            />
                          </div>
                          <p className="text-[10px] text-gray-400">
                            {t("requests.dispatchedInline")} {item.dispatched ?? 0}
                            {item.quantityReceived < (item.dispatched ?? 0)
                              ? ` ${t("requests.shortageInline", {
                                  n: String((item.dispatched ?? 0) - item.quantityReceived),
                                })}`
                              : ""}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <label className="text-xs text-gray-500">{t("requests.receivedInline")}</label>
                            <input
                              type="number"
                              min="1"
                              max={item.dispatched ?? 0}
                              value={item.quantityReceived}
                              onChange={(e) => {
                                const received = Math.min(
                                  Number(e.target.value),
                                  item.dispatched ?? 0,
                                );
                                updateSaleItem(item.requestItemId, {
                                  quantityReceived: received,
                                  quantity: Math.min(item.quantity, received),
                                });
                              }}
                              className="border p-1.5 rounded-lg w-20 text-sm"
                            />
                            <label className="text-xs text-gray-500">{t("requests.sellInline")}</label>
                            <input
                              type="number"
                              min="0"
                              max={item.quantityReceived}
                              value={item.quantity}
                              onChange={(e) => {
                                const q = Math.max(
                                  0,
                                  Math.min(
                                    Number(e.target.value) || 0,
                                    item.quantityReceived || 0,
                                  ),
                                );
                                updateSaleItem(item.requestItemId, {
                                  quantity: q,
                                });
                              }}
                              className="border p-1.5 rounded-lg w-20 text-sm"
                            />
                            <label className="text-xs text-gray-500">{t("requests.priceInline")}</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unitSellPrice === 0 ? "" : item.unitSellPrice}
                              onChange={(e) => {
                                updateSaleItem(item.requestItemId, {
                                  unitSellPrice:
                                    e.target.value === ""
                                      ? 0
                                      : Number(e.target.value),
                                });
                              }}
                              placeholder={item.suggestedPrice
                                ? `${item.suggestedPrice.toFixed(2)}${t("requests.defaultSuffix")}`
                                : `0.00${t("requests.defaultSuffix")}`}
                              className="border p-1.5 rounded-lg w-24 text-sm"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
                {saleItems.length === 0 && (
                  <p className="text-sm text-gray-400">
                    {t("requests.noItemsPending")}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-sm font-medium text-gray-600">{t("requests.totalLabelSell")}</span>
                <span className="text-lg font-bold text-gray-900">
                  {fmtCurrency(
                    saleItems.reduce(
                      (sum, i) => sum + (i.quantity || 0) * (i.unitSellPrice || 0),
                      0,
                    ),
                  )}
                </span>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500 mb-1">
                  {t("requests.saleTypeLabel")}
                </p>
                <div className="flex gap-2">
                  {(["FULLY_PAID", "PARTIALLY_PAID", "CREDITED"] as const).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setSaleType(st)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                          saleType === st
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300"
                        }`}
                      >
                        {st === "FULLY_PAID"
                          ? t("sales.typePaid")
                          : st === "PARTIALLY_PAID"
                            ? t("sales.typePartial")
                            : t("sales.typeCredit")}
                      </button>
                    ),
                  )}
                </div>
              </div>

              {(saleType === "FULLY_PAID" || saleType === "PARTIALLY_PAID") && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">
                    {t("sales.paymentMethod")}
                  </label>
                  <select
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="border p-2 rounded-lg w-full bg-white text-sm"
                  >
                    {!cashMethod && <option value="">{t("requests.selectPayment")}</option>}
                    {paymentMethods.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 mt-1">
                    <input
                      value={newPaymentMethodName}
                      onChange={(e) => setNewPaymentMethodName(e.target.value)}
                      placeholder={t("requests.newPaymentMethodPlaceholder")}
                      className="border p-2 rounded-lg flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddPaymentMethod}
                      className="bg-gray-200 px-3 rounded-lg text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              {saleType === "PARTIALLY_PAID" && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">
                    {t("sales.paidAmount")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="border p-2 rounded-lg w-full text-sm"
                    placeholder="0.00"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-500">
                    {t("sales.customer")}{" "}
                    {(saleType === "PARTIALLY_PAID" ||
                      saleType === "CREDITED") && (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                </div>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="border p-2 rounded-lg w-full bg-white text-sm"
                >
                  <option value="">{t("sales.selectCustomer")}</option>
                  {customers.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2 mt-1">
                  <input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder={t("requests.newCustomerNamePlaceholder")}
                    className="border p-2 rounded-lg flex-1 text-sm"
                  />
                  <input
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder={t("auth.phone")}
                    className="border p-2 rounded-lg w-32 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomer}
                    className="bg-gray-200 px-3 rounded-lg text-sm"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  {t("common.notes")}
                </label>
                <textarea
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  className="border p-2 rounded-lg w-full text-sm"
                  rows={2}
                  placeholder={t("common.optional")}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSubmitSale}
                  disabled={savingSale || saleItems.length === 0}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {savingSale && <Loading size="sm" />}
                  {savingSale ? t("purchases.saving") : t("requests.confirmAndSell")}
                </button>
                <button
                  onClick={() => setSaleReq(null)}
                  className="bg-gray-200 px-4 py-2 rounded-lg"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </>
          )}
        </div>

      </Modal>
    </div>
  );
}
