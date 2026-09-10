"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const MODEL_LABEL: Record<string, string> = {
  ONE_TIME: "mfg.services.modelOneTime",
  PER_UNIT: "mfg.services.modelPerUnit",
  PER_PERIOD: "mfg.services.modelPerPeriod",
};

const emptySvc = () => ({
  name: "",
  description: "",
  pricingModel: "ONE_TIME",
  price: "0",
  periodUnit: "",
});

const emptyIncome = () => ({
  serviceId: "",
  quantity: "1",
  incomeDate: "",
  notes: "",
});

export default function ManufacturingServicesPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<"services" | "income">("services");
  const [services, setServices] = useState<any[]>([]);
  const [incomes, setIncomes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSvcForm, setShowSvcForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [svcForm, setSvcForm] = useState(emptySvc());
  const [showIncome, setShowIncome] = useState(false);
  const [incomeForm, setIncomeForm] = useState(emptyIncome());

  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        api.get("/manufacturing/services"),
        api.get("/manufacturing/service-incomes").catch(() => ({ data: [] })),
      ]);
      setServices(s.data ?? []);
      setIncomes(i.data ?? []);
    } catch {
      toast.error(t("mfg.services.failedSave"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setSvcForm(emptySvc());
    setShowSvcForm(true);
  };

  const openEdit = (svc: any) => {
    setEditing(svc);
    setSvcForm({
      name: svc.name,
      description: svc.description ?? "",
      pricingModel: svc.pricingModel,
      price: String(svc.price ?? 0),
      periodUnit: svc.periodUnit ?? "",
    });
    setShowSvcForm(true);
  };

  const submitService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!svcForm.name) return;
    const payload = {
      name: svcForm.name,
      description: svcForm.description || undefined,
      pricingModel: svcForm.pricingModel,
      price: Number(svcForm.price) || 0,
      periodUnit: svcForm.periodUnit || undefined,
    };
    try {
      if (editing) await api.patch(`/manufacturing/services/${editing.id}`, payload);
      else await api.post("/manufacturing/services", payload);
      toast.success(t("mfg.services.serviceSaved"));
      setShowSvcForm(false);
      setEditing(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.services.failedSave"));
    }
  };

  const removeService = async (svc: any) => {
    const ok = await confirm(t("mfg.services.deleteConfirm", { name: svc.name }));
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/services/${svc.id}`);
      toast.success(t("mfg.services.serviceDeleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.services.failedDelete"));
    }
  };

  const submitIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incomeForm.serviceId) return;
    try {
      await api.post("/manufacturing/service-incomes", {
        serviceId: Number(incomeForm.serviceId),
        quantity: Number(incomeForm.quantity) || 1,
        incomeDate: incomeForm.incomeDate || undefined,
        notes: incomeForm.notes || undefined,
      });
      toast.success(t("mfg.services.incomeRecorded"));
      setShowIncome(false);
      setIncomeForm(emptyIncome());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.services.failedIncome"));
    }
  };

  const selectedService = services.find((s) => String(s.id) === incomeForm.serviceId);
  const previewAmount =
    (selectedService?.price ?? 0) * (Number(incomeForm.quantity) || 1);

  const label = (text: string, required?: boolean) => (
    <label className="block text-sm font-medium text-gray-500 mb-1">
      {text}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );

  if (loading) return <Loading className="py-24" />;

  const money = (n: number) =>
    `${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB`;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">{t("mfg.services.title")}</h1>
        {canManage && tab === "services" && (
          <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm">
            {t("mfg.services.newService")}
          </button>
        )}
        {canManage && tab === "income" && (
          <button onClick={() => setShowIncome(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm">
            {t("mfg.services.newIncome")}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <button type="button" onClick={() => setTab("services")} className={"px-4 py-2 rounded text-sm " + (tab === "services" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600")}>
          {t("mfg.services.tabServices")}
        </button>
        <button type="button" onClick={() => setTab("income")} className={"px-4 py-2 rounded text-sm " + (tab === "income" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600")}>
          {t("mfg.services.tabIncome")}
        </button>
      </div>

      {tab === "services" ? (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px] text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.colService")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.colModel")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.colPrice")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.activeLabel")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 sm:p-3 md:p-4 font-medium">
                      {s.name}
                      {s.description && <span className="block text-[11px] text-gray-400">{s.description}</span>}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4">{t(MODEL_LABEL[s.pricingModel] ?? "mfg.services.modelOneTime")}</td>
                    <td className="p-2 sm:p-3 md:p-4">{money(s.price)}</td>
                    <td className="p-2 sm:p-3 md:p-4">{s.active ? t("mfg.services.activeLabel") : "—"}</td>
                    <td className="p-2 sm:p-3 md:p-4">
                      {canManage && (
                        <RowActionsMenu
                          items={[
                            { label: t("mfg.common.edit"), onClick: () => openEdit(s) },
                            { label: t("mfg.common.delete"), color: "text-red-600", onClick: () => removeService(s) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {services.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-gray-400">{t("mfg.services.noServices")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px] text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.colDate")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("mfg.services.colIncomeService")}</th>
                  <th className="p-2 sm:p-3 md:p-4 text-center">{t("mfg.services.colQuantity")}</th>
                  <th className="p-2 sm:p-3 md:p-4 text-right">{t("mfg.services.colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {incomes.map((inc) => (
                  <tr key={inc.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 sm:p-3 md:p-4 text-gray-500">{new Date(inc.incomeDate).toLocaleDateString()}</td>
                    <td className="p-2 sm:p-3 md:p-4 font-medium">{inc.service?.name ?? `#${inc.serviceId}`}</td>
                    <td className="p-2 sm:p-3 md:p-4 text-center">{inc.quantity}</td>
                    <td className="p-2 sm:p-3 md:p-4 text-right font-semibold text-green-700">{money(inc.amount)}</td>
                  </tr>
                ))}
                {incomes.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-gray-400">{t("mfg.services.noIncome")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Service create/edit modal */}
      <Modal isOpen={showSvcForm} onClose={() => setShowSvcForm(false)} title={editing ? t("mfg.services.editTitle") : t("mfg.services.createTitle")}>
        <form onSubmit={submitService} className="grid grid-cols-1 gap-4">
          <div>
            {label(t("mfg.services.serviceNameLabel"), true)}
            <input id="svc-name" value={svcForm.name} onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })} className="border p-2 rounded-lg w-full" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.services.modelLabel"), true)}
              <select id="svc-model" value={svcForm.pricingModel} onChange={(e) => setSvcForm({ ...svcForm, pricingModel: e.target.value })} className="border p-2 rounded-lg w-full bg-white">
                <option value="ONE_TIME">{t("mfg.services.modelOneTime")}</option>
                <option value="PER_UNIT">{t("mfg.services.modelPerUnit")}</option>
                <option value="PER_PERIOD">{t("mfg.services.modelPerPeriod")}</option>
              </select>
            </div>
            <div>
              {label(t("mfg.services.priceLabel"), true)}
              <input id="svc-price" type="number" min="0" step="any" value={svcForm.price} onChange={(e) => setSvcForm({ ...svcForm, price: e.target.value })} className="border p-2 rounded-lg w-full" required />
            </div>
          </div>
          {svcForm.pricingModel === "PER_PERIOD" && (
            <div>
              {label(t("mfg.services.periodUnitLabel"))}
              <input id="svc-period" value={svcForm.periodUnit} onChange={(e) => setSvcForm({ ...svcForm, periodUnit: e.target.value })} placeholder="hour" className="border p-2 rounded-lg w-full" />
            </div>
          )}
          <div>
            {label(t("mfg.services.descriptionLabel"))}
            <textarea id="svc-desc" rows={2} value={svcForm.description} onChange={(e) => setSvcForm({ ...svcForm, description: e.target.value })} className="border p-2 rounded-lg w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSvcForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.common.save")}</button>
          </div>
        </form>
      </Modal>

      {/* Record income modal */}
      <Modal isOpen={showIncome} onClose={() => setShowIncome(false)} title={t("mfg.services.recordIncomeTitle")}>
        <form onSubmit={submitIncome} className="grid grid-cols-1 gap-4">
          <div>
            {label(t("mfg.services.incomeServiceLabel"), true)}
            <select id="inc-service" value={incomeForm.serviceId} onChange={(e) => setIncomeForm({ ...incomeForm, serviceId: e.target.value })} className="border p-2 rounded-lg w-full bg-white" required>
              <option value="">{t("mfg.services.selectService")}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.services.incomeQtyLabel"), true)}
              <input id="inc-qty" type="number" min="0.0001" step="any" value={incomeForm.quantity} onChange={(e) => setIncomeForm({ ...incomeForm, quantity: e.target.value })} className="border p-2 rounded-lg w-full" required />
            </div>
            <div>
              {label(t("mfg.services.incomeDateLabel"))}
              <input id="inc-date" type="date" value={incomeForm.incomeDate} onChange={(e) => setIncomeForm({ ...incomeForm, incomeDate: e.target.value })} className="border p-2 rounded-lg w-full" />
            </div>
          </div>
          <div>
            {label(t("mfg.services.amountAuto"))}
            <input id="inc-amount" value={selectedService ? money(previewAmount) : "—"} readOnly className="border p-2 rounded-lg w-full bg-gray-100 text-gray-600" />
          </div>
          <div>
            {label(t("mfg.services.incomeNotesLabel"))}
            <input id="inc-notes" value={incomeForm.notes} onChange={(e) => setIncomeForm({ ...incomeForm, notes: e.target.value })} className="border p-2 rounded-lg w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowIncome(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.services.newIncome").replace("+ ", "")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
