"use client";

import api from "@/lib/api";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import AiAutofillCapture from "@/app/components/AiAutofillCapture";
import CustomerForm from "@/app/components/CustomerForm";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashWashesPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [washes, setWashes] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [form, setForm] = useState({ washerId: "", participantIds: [] as number[], customerId: "", vehicleType: "", washTypeId: "", amount: "", notes: "", plateNumber: "", makeModel: "" });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [washerId, setWasherId] = useState("");
  const [washTypeId, setWashTypeId] = useState("");
  const wsInit = getDateRange("month");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(wsInit.start);
  const [endDate, setEndDate] = useState(wsInit.end);
  const [aiDetected, setAiDetected] = useState<string | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  // Settlement modal (choose the payment method the money was received in).
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [payMethodId, setPayMethodId] = useState("");
  const [newMethodName, setNewMethodName] = useState("");
  const [showNewMethod, setShowNewMethod] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState("");

  const canCreate = hasPermission("carwash.washes.create");
  const canEdit = hasPermission("carwash.washes.edit");
  const canDelete = hasPermission("carwash.washes.delete");

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        startDate,
        endDate,
        ...(washerId ? { washerId } : {}),
        ...(washTypeId ? { washTypeId } : {}),
      });
      const [w, list, wt, pr, vt] = await Promise.all([
        api.get(`/carwash/washes?${q.toString()}`),
        api.get("/carwash/washers?activeOnly=1"),
        api.get("/carwash/wash-types"),
        api.get("/carwash/prices"),
        api.get("/carwash/vehicle-types"),
      ]);
      setWashes(w.data);
      setWashers(list.data);
      setWashTypes(wt.data);
      setPrices(pr.data);
      setVehicleTypes(vt.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t, startDate, endDate, washerId, washTypeId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, []);

  const toggleParticipant = (id: number) => {
    setForm((f) => ({ ...f, participantIds: f.participantIds.includes(id) ? f.participantIds.filter((p) => p !== id) : [...f.participantIds, id] }));
  };

  const priceFor = (vehicleType: string, washTypeId: string) => {
    const p = prices.find((x) => x.vehicleType === vehicleType && String(x.washTypeId ?? "") === washTypeId);
    return p ? String(p.amount) : "";
  };

  const updateVehicleType = (vehicleType: string) => {
    setForm((f) => ({ ...f, vehicleType, amount: priceFor(vehicleType, f.washTypeId) }));
  };

  const updateWashType = (washTypeId: string) => {
    setForm((f) => ({ ...f, washTypeId, amount: priceFor(f.vehicleType, washTypeId) }));
  };

  const initialForm = () => {
    const vehicleType = vehicleTypes[0]?.name ?? "";
    const washTypeId = washTypes[0] ? String(washTypes[0].id) : "";
    return {
      washerId: "",
      participantIds: [] as number[],
      customerId: "",
      vehicleType,
      washTypeId,
      amount: priceFor(vehicleType, washTypeId),
      notes: "",
      plateNumber: "",
      makeModel: "",
    };
  };

  const analyzeVehicle = async (images: string[]) => {
    const r = await api.post(
      "/ai/carwash/analyze-vehicle-photo",
      { base64Image: images[0] },
      { timeout: 60000 },
    );
    return r.data;
  };

  const applyVehicleResult = (d: any) => {
    setForm((f) => {
      const tv = (d?.vehicleType ?? "").trim();
      const matched = vehicleTypes.find((v) => v.name.toLowerCase() === tv.toLowerCase());
      const vehicleType = matched ? matched.name : f.vehicleType;
      return {
        ...f,
        vehicleType,
        amount: priceFor(vehicleType, f.washTypeId),
        plateNumber: d?.plateNumber ?? f.plateNumber,
        makeModel: d?.makeModel ?? f.makeModel,
      };
    });
    setAiDetected([d?.vehicleType, d?.plateNumber, d?.makeModel].filter(Boolean).join(" · "));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/carwash/washes", {
        customerId: form.customerId ? Number(form.customerId) : null,
        washerId: form.washerId ? Number(form.washerId) : null,
        participantWasherIds: form.participantIds,
        vehicleType: form.vehicleType.trim() || "Car",
        washTypeId: form.washTypeId ? Number(form.washTypeId) : null,
        amount: Number(form.amount) || 0,
        notes: form.notes.trim() || undefined,
        plateNumber: form.plateNumber.trim() || undefined,
        makeModel: form.makeModel.trim() || undefined,
      });
      setOpen(false);
      setForm(initialForm());
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  // Advance the wash to its next status: QUEUED → IN_PROGRESS → COMPLETED →
  // SETTLED. Called from the clickable status cell.
  // Status flow: QUEUED → Washing → Washed → Complete. From "Washed" a single
  // "Paid" action opens the settlement modal; after Complete no action remains.
  const runAction = async (w: any, action: string, next: string) => {
    setError("");
    try {
      await api.patch(`/carwash/washes/${w.id}/${action}`);
      await load();
      setDetail((d: any) => (d && d.id === w.id ? { ...d, status: next } : d));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  // Open the settlement modal and load the tenant's payment methods (Cash is
  // seeded by the backend, so the list is never empty).
  const openPay = async (w: any) => {
    setPayTarget(w);
    setPayMethodId("");
    setNewMethodName("");
    setShowNewMethod(false);
    setError("");
    try {
      const r = await api.get("/payment-methods");
      const methods = Array.isArray(r.data) ? r.data : [];
      setPaymentMethods(methods);
      const cash = methods.find((m: any) => String(m.name).toLowerCase() === "cash");
      setPayMethodId(String((cash ?? methods[0])?.id ?? ""));
    } catch {
      setPaymentMethods([]);
    }
  };

  const addPaymentMethod = async () => {
    const name = newMethodName.trim();
    if (!name) return;
    try {
      const r = await api.post("/payment-methods", { name });
      setPaymentMethods((prev) => [...prev, r.data]);
      setPayMethodId(String(r.data.id));
      setNewMethodName("");
      setShowNewMethod(false);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const confirmPayment = async () => {
    if (!payTarget) return;
    setPayBusy(true);
    setError("");
    try {
      await api.patch(`/carwash/washes/${payTarget.id}/settle`, {
        ...(payMethodId ? { paymentMethodId: Number(payMethodId) } : {}),
      });
      setDetail((d: any) => (d && d.id === payTarget.id ? { ...d, status: "SETTLED" } : d));
      setPayTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setPayBusy(false);
    }
  };

  const statusLabel = (s: string) => t(`carwash.status_${s}`, { defaultValue: s });
  const statusClass = (s: string) =>
    s === "SETTLED"
      ? "bg-emerald-100 text-emerald-700"
      : s === "COMPLETED"
        ? "bg-green-100 text-green-700"
        : s === "IN_PROGRESS"
          ? "bg-blue-100 text-blue-700"
          : "bg-amber-100 text-amber-700";

  /** The action buttons for a wash, by current status. Empty when Complete. */
  const statusActions = (w: any) => {
    if (!canEdit) return [];
    if (w.status === "QUEUED")
      return [{ label: t("carwash.actionStartWashing"), run: () => runAction(w, "start", "IN_PROGRESS") }];
    if (w.status === "IN_PROGRESS")
      return [{ label: t("carwash.actionWashed"), run: () => runAction(w, "complete", "COMPLETED") }];
    if (w.status === "COMPLETED")
      return [{ label: t("carwash.actionPaid"), run: () => openPay(w) }];
    return [];
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/carwash/washes/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const filtered = washes.filter((w) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (w.vehicleType ?? "").toLowerCase().includes(q) ||
      (w.washer?.name ?? "").toLowerCase().includes(q) ||
      w.participantWashers.some((p: any) => p.name.toLowerCase().includes(q));
    const matchesStatus = !statusFilter || w.status === statusFilter;
    const matchesWasher =
      !washerId ||
      String(w.washerId) === washerId ||
      w.participantWashers.some((p: any) => String(p.id) === washerId);
    const matchesWashType = !washTypeId || String(w.washTypeId) === washTypeId;
    return matchesSearch && matchesStatus && matchesWasher && matchesWashType;
  });

  // Status totals for the current (filtered) list: queue / washing / washed / paid.
  const counts = {
    QUEUED: filtered.filter((w) => w.status === "QUEUED").length,
    IN_PROGRESS: filtered.filter((w) => w.status === "IN_PROGRESS").length,
    COMPLETED: filtered.filter((w) => w.status === "COMPLETED").length,
    SETTLED: filtered.filter((w) => w.status === "SETTLED").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.washes")}</h1>
        {canCreate && (
          <button onClick={() => { setForm(initialForm()); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.recordWash")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Status totals — one row (2×2 on small screens), compact font */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {([
          ["QUEUED", "bg-amber-100 text-amber-700"],
          ["IN_PROGRESS", "bg-blue-100 text-blue-700"],
          ["COMPLETED", "bg-green-100 text-green-700"],
          ["SETTLED", "bg-emerald-100 text-emerald-700"],
        ] as const).map(([key, cls]) => (
          <div key={key} className="bg-white px-3 py-2 rounded-lg border border-gray-200">
            <p className="text-[11px] text-gray-500">{t(`carwash.status_${key}`)}</p>
            <p className="mt-0.5">
              <span className={`text-base font-semibold px-1.5 py-0.5 rounded ${cls}`}>{counts[key]}</span>
            </p>
          </div>
        ))}
      </div>

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.washer") + " / " + t("carwash.vehicleType")}
        extra={
          <>
            <FilterSelect
              value={washerId}
              onChange={setWasherId}
              label={t("carwash.washer")}
              allLabel={t("carwash.allWashers")}
              options={washers.map((w) => ({ value: String(w.id), label: w.name }))}
            />
            <FilterSelect
              value={washTypeId}
              onChange={setWashTypeId}
              label={t("carwash.washType")}
              allLabel={t("carwash.allWashTypes")}
              options={washTypes.map((w) => ({ value: String(w.id), label: w.name }))}
            />
            <FilterSelect
              value={statusFilter}
              onChange={setStatusFilter}
              label={t("carwash.status")}
              allLabel={t("carwash.allStatus")}
              options={[
                { value: "QUEUED", label: t("carwash.status_QUEUED") },
                { value: "IN_PROGRESS", label: t("carwash.status_IN_PROGRESS") },
                { value: "COMPLETED", label: t("carwash.status_COMPLETED") },
                { value: "SETTLED", label: t("carwash.status_SETTLED") },
              ]}
            />
          </>
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.date")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.plateNumber")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washersLabel")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.amount")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((w) => (
              <tr
                key={w.id}
                onClick={() => setDetail(w)}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(w.date).toLocaleString()}
                  {w.queueNumber != null && (
                    <span className="ml-2 text-[11px] text-gray-400">#{w.queueNumber}</span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{w.plateNumber ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{[w.washer?.name, ...w.participantWashers.map((p: any) => p.name)].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.amount}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusClass(w.status)}`}>
                      {statusLabel(w.status)}
                    </span>
                    <span onClick={(e) => e.stopPropagation()} className="flex gap-2">
                      {statusActions(w).map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          onClick={a.run}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                        >
                          {a.label}
                        </button>
                      ))}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("carwash.noWashes")}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Wash detail modal: full data + status timeline with explicit actions. */}
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${t("carwash.washersLabel")} #${detail.id}` : ""}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500">{t("carwash.status")}</span>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full ${statusClass(detail.status)}`}>
                  {statusLabel(detail.status)}
                </span>
                {statusActions(detail).map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            {detail.queueNumber != null && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{t("carwash.queueNumber")}</span>
                <span className="font-medium">#{detail.queueNumber}</span>
              </div>
            )}
            {[
              [t("carwash.date"), new Date(detail.date).toLocaleString()],
              [t("carwash.customer"), detail.customer?.name ?? "—"],
              [t("carwash.vehicleType"), detail.vehicleType],
              [t("carwash.washType"), detail.washType?.name ?? "—"],
              [t("carwash.plateNumber"), detail.plateNumber ?? "—"],
              [t("carwash.makeModel"), detail.makeModel ?? "—"],
              [t("carwash.washersLabel"), [detail.washer?.name, ...detail.participantWashers.map((p: any) => p.name)].filter(Boolean).join(", ") || "—"],
              [t("carwash.amount"), detail.amount],
              [t("carwash.paymentMethod"), detail.paymentMethod?.name ?? "—"],
              [t("carwash.notes"), detail.notes ?? "—"],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between gap-3">
                <span className="text-gray-500">{k}</span>
                <span className="font-medium text-right">{v}</span>
              </div>
            ))}

            {/* Status timeline (time only). */}
            <div className="pt-3 border-t">
              <p className="text-xs uppercase text-gray-400 mb-2">{t("carwash.statusTimeline")}</p>
              <ul className="space-y-1.5">
                {[
                  [t("carwash.status_QUEUED"), detail.queuedAt],
                  [t("carwash.status_IN_PROGRESS"), detail.startedAt],
                  [t("carwash.status_COMPLETED"), detail.completedAt],
                  [t("carwash.status_SETTLED"), detail.settledAt],
                ].map(([label, ts]) => (
                  <li key={String(label)} className="flex items-center justify-between">
                    <span className={ts ? "text-gray-700" : "text-gray-300"}>{label}</span>
                    <span className={ts ? "text-gray-600" : "text-gray-300"}>
                      {ts ? new Date(ts as string).toLocaleTimeString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {canDelete && (
              <div className="pt-3 border-t text-right">
                <button onClick={() => remove(detail.id)} className="text-xs text-red-600 hover:underline">
                  {t("carwash.delete")}
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t("carwash.recordWash")}>
        <form onSubmit={submit} className="space-y-3">
          <AiAutofillCapture
            enabled={canCreate}
            analyze={analyzeVehicle}
            onResult={applyVehicleResult}
            buttonLabel={t("carwash.aiCaptureVehicle")}
          />
          {aiDetected && <p className="text-xs text-indigo-600 mt-1">✨ {t("carwash.aiDetected")}: {aiDetected}</p>}

          <div>
            <label className="block text-sm text-gray-600">{t("carwash.customerOptional")}</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchableSelect value={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} placeholder={t("carwash.customerOptional")} />
              </div>
              <button type="button" onClick={() => setShowCustomerModal(true)} title={t("carwash.addCustomer")} className="border border-gray-300 rounded-lg px-3 text-gray-600 font-bold">+</button>
            </div>
          </div>

          <label className="block text-sm text-gray-600">{t("carwash.primaryWasher")}
            <SearchableSelect value={form.washerId} onChange={(v) => setForm({ ...form, washerId: v })} options={washers.map((w) => ({ value: String(w.id), label: `${w.name} (${w.commissionRate}%)` }))} placeholder={t("carwash.primaryWasher")} />
          </label>

          <label className="block text-sm text-gray-600">{t("carwash.vehicleType")}
            <select value={form.vehicleType} onChange={(e) => updateVehicleType(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white">
              <option value="">{t("carwash.vehicleType")}</option>
              {vehicleTypes.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </label>

          <label className="block text-sm text-gray-600">{t("carwash.washType")}
            <select value={form.washTypeId} onChange={(e) => updateWashType(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white">
              {washTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>

          <label className="block text-sm text-gray-600">{t("carwash.plateNumber")}
            <input value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} placeholder={t("carwash.plateNumber")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>

          <label className="block text-sm text-gray-600">{t("carwash.makeModel")}
            <input value={form.makeModel} onChange={(e) => setForm({ ...form, makeModel: e.target.value })} placeholder={t("carwash.makeModel")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.price")}
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t("carwash.price")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("carwash.notes")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div>
            <p className="text-xs text-gray-500 mb-2">{t("carwash.participants")}</p>
            <div className="flex flex-wrap gap-2">
              {washers.filter((w) => String(w.id) !== form.washerId).map((w) => (
                <label key={w.id} className="flex items-center gap-1 text-sm text-gray-600 border border-gray-200 rounded px-2 py-1">
                  <input type="checkbox" checked={form.participantIds.includes(w.id)} onChange={() => toggleParticipant(w.id)} />
                  {w.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.recordWash")}</button>
          </div>
        </form>
      </Modal>

      {/* Settlement modal — choose the payment method the money was received in. */}
      <Modal
        isOpen={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={t("carwash.paymentMethod")}
      >
        <div className="space-y-3">
          <label className="block text-sm text-gray-600">
            {t("carwash.paymentMethod")}
            <select
              value={payMethodId}
              onChange={(e) => setPayMethodId(e.target.value)}
              disabled={paymentMethods.length === 0}
              className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
            >
              {paymentMethods.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>

          {showNewMethod ? (
            <div className="flex gap-2 items-end">
              <input
                value={newMethodName}
                onChange={(e) => setNewMethodName(e.target.value)}
                placeholder={t("carwash.paymentMethod")}
                className="border border-gray-300 rounded p-2 text-sm flex-1"
              />
              <button type="button" onClick={addPaymentMethod} className="text-sm px-3 py-2 rounded bg-blue-600 text-white">
                {t("common.save")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewMethod(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              + {t("carwash.addPaymentMethod")}
            </button>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPayTarget(null)} className="px-3 py-2 text-sm text-gray-600">
              {t("carwash.cancel")}
            </button>
            <button
              type="button"
              onClick={confirmPayment}
              disabled={payBusy}
              className="bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {t("carwash.actionPaid")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCustomerModal} onClose={() => setShowCustomerModal(false)} title={t("carwash.addCustomer")}>
        <CustomerForm
          onCreated={(c) => {
            setCustomers((prev) => [c, ...prev]);
            setForm((f) => ({ ...f, customerId: String(c.id) }));
            setShowCustomerModal(false);
          }}
          onCancel={() => setShowCustomerModal(false)}
        />
      </Modal>
    </div>
  );
}
