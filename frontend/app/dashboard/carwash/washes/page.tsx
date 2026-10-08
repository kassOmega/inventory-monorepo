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
  const [lastCommission, setLastCommission] = useState<{ ownerShare: number; totalCommission: number } | null>(null);
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
        api.get("/carwash/washers"),
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
      const r = await api.post("/carwash/washes", {
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
      setLastCommission({ ownerShare: r.data.ownerShare, totalCommission: r.data.totalCommission });
      setOpen(false);
      setForm(initialForm());
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const complete = async (id: number) => {
    setError("");
    try {
      await api.patch(`/carwash/washes/${id}/complete`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
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
      {lastCommission && (
        <div className="bg-green-50 text-green-700 p-3 rounded text-sm">
          {t("carwash.washRecorded")} — {t("carwash.totalCommission")} {lastCommission.totalCommission.toLocaleString()}, {t("carwash.ownerShare")} {lastCommission.ownerShare.toLocaleString()}.
        </div>
      )}

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
                { value: "IN_PROGRESS", label: "IN_PROGRESS" },
                { value: "COMPLETED", label: "COMPLETED" },
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
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.type")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washType")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.plateNumber")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washersLabel")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.amount")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.status")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((w) => (
              <tr key={w.id}>
                <td className="px-4 py-2 whitespace-nowrap">{new Date(w.date).toLocaleString()}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.vehicleType}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.washType?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.plateNumber ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{[w.washer?.name, ...w.participantWashers.map((p: any) => p.name)].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.amount}</td>
                <td className="px-4 py-2 whitespace-nowrap"><span className={`text-xs px-2 py-0.5 rounded-full ${w.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{w.status}</span></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && w.status === "IN_PROGRESS" && <button onClick={() => complete(w.id)} className="text-xs text-green-600 hover:underline mr-2">{t("carwash.complete")}</button>}
                  {canDelete && <button onClick={() => remove(w.id)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">{t("carwash.noWashes")}</td></tr>}
          </tbody>
        </table>
      </div>

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
