"use client";

import Loading from "@/app/components/Loading";
import Button from "@/app/components/Button";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/datetime";

const MSTATUS: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  ISSUED: "bg-blue-100 text-blue-800",
  UNDER_MAINTENANCE: "bg-amber-100 text-amber-800",
  DECOMMISSIONED: "bg-gray-200 text-gray-600",
};
// Machine status → `mfg.machines.st*` label key (resolved with t() at render).
const MSTATUS_KEY: Record<string, string> = {
  AVAILABLE: "mfg.machines.stAvailable",
  ISSUED: "mfg.machines.stWithWorker",
  UNDER_MAINTENANCE: "mfg.machines.stInMaintenance",
  DECOMMISSIONED: "mfg.machines.stDecommissioned",
};
const ITEM_STATUS = ["RETURNED", "DAMAGED", "MISSING"];
const emptyMachine = () => ({ code: "", name: "", type: "", kind: "STATIONARY", hourlyRate: "" });
const emptyRet = () => ({ status: "RETURNED" as string, cost: "", notes: "" });

export default function ManufacturingMachinesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const [machines, setMachines] = useState<any[]>([]);
  const [issuances, setIssuances] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState("ALL");
  const [showAdd, setShowAdd] = useState(false);
  const [editFor, setEditFor] = useState<any | null>(null);
  const [confirmDel, setConfirmDel] = useState<any | null>(null);
  const [form, setForm] = useState(emptyMachine());
  const [issueFor, setIssueFor] = useState<any | null>(null);
  const [issueWorker, setIssueWorker] = useState("");
  const [returnFor, setReturnFor] = useState<any | null>(null);
  const [retState, setRetState] = useState<Record<number, any>>({});
  const [savingMachine, setSavingMachine] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState(false);
  const [deletingMachine, setDeletingMachine] = useState(false);
  const [busyStatus, setBusyStatus] = useState<number | null>(null);
  const canManage = hasPermission("manufacturing.manage");
  const workerName = (id: number | null) => staff.find((u) => u.id === id)?.name ?? (id == null ? "—" : `#${id}`);

  const load = useCallback(async () => {
    try {
      const [m, i, u] = await Promise.all([
        api.get("/manufacturing/machines"),
        api.get("/manufacturing/machine-issuances").catch(() => ({ data: [] })),
        api.get("/users?page=1&pageSize=100").catch(() => ({ data: [] })),
      ]);
      setMachines(m.data ?? []);
      setIssuances(i.data ?? []);
      setStaff(Array.isArray(u.data) ? u.data : (u.data?.data ?? []));
    } catch {
      toast.error(t("mfg.machines.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openIssue = (m: any) => { setIssueFor(m); setIssueWorker(""); };
  const openReturn = (iss: any) => {
    const map: Record<number, any> = {};
    (iss.items ?? []).forEach((it: any) => { map[it.id] = emptyRet(); });
    setReturnFor(iss);
    setRetState(map);
  };

  const addMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = {
      code: form.code,
      name: form.name,
      type: form.type || null,
      kind: form.kind,
      hourlyRate: form.hourlyRate !== "" ? Number(form.hourlyRate) : null,
    };
    setSavingMachine(true);
    try {
      if (editFor) {
        await api.patch(`/manufacturing/machines/${editFor.id}`, body);
        toast.success(t("mfg.machines.updated"));
      } else {
        await api.post("/manufacturing/machines", body);
        toast.success(t("mfg.machines.added"));
      }
      setShowAdd(false);
      setEditFor(null);
      setForm(emptyMachine());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.machines.saveFailed"));
    } finally {
      setSavingMachine(false);
    }
  };

  const startEdit = (m: any) => {
    setEditFor(m);
    setForm({ code: m.code, name: m.name, type: m.type ?? "", kind: m.kind ?? "STATIONARY", hourlyRate: m.hourlyRate != null ? String(m.hourlyRate) : "" });
    setShowAdd(true);
  };

  const submitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueFor || !issueWorker) return;
    setIssuing(true);
    try {
      await api.post("/manufacturing/machine-issuances", { machineId: issueFor.id, workerId: Number(issueWorker) });
      toast.success(t("mfg.machines.issued"));
      setIssueFor(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.machines.issueFailed"));
    } finally {
      setIssuing(false);
    }
  };

  const submitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnFor) return;
    const items = (returnFor.items ?? [])
      .filter((it: any) => retState[it.id])
      .map((it: any) => {
        const s = retState[it.id];
        return {
          issuanceItemId: it.id,
          status: s.status,
          ...(s.status === "RETURNED" ? { returnedQuantity: it.expectedQuantity } : { returnedQuantity: 0 }),
          replacementCost: s.status !== "RETURNED" && s.cost !== "" ? Number(s.cost) : null,
          notes: s.notes || null,
        };
      });
    setReturning(true);
    try {
      const r = await api.post(`/manufacturing/machine-issuances/${returnFor.id}/return`, { items });
      const nm = (r.data as any)?.nextMachine;
      if (nm === "UNDER_MAINTENANCE") toast.error(t("mfg.machines.returnedToMaintenance"));
      else toast.success(t("mfg.machines.returned"));
      setReturnFor(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.machines.returnFailed"));
    } finally {
      setReturning(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setDeletingMachine(true);
    try {
      await api.delete(`/manufacturing/machines/${confirmDel.id}`);
      toast.success(t("mfg.machines.removed"));
      setConfirmDel(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.machines.removeFailed"));
    } finally {
      setDeletingMachine(false);
    }
  };

  const setStatus = async (url: string, value: string, id?: number) => {
    if (id != null) setBusyStatus(id);
    try {
      await api.patch(url, { status: value });
      toast.success(t("mfg.common.updated"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.common.updateFailed"));
    } finally {
      setBusyStatus(null);
    }
  };

  const listed = useMemo(() => (kindFilter === "ALL" ? machines : machines.filter((m) => m.kind === kindFilter)), [machines, kindFilter]);
  const inputCls = "border p-2 rounded-lg w-full bg-white";

  if (loading) return <Loading className="py-24" />;
  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.machines.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("mfg.machines.subtitle")}</p>
        </div>
        {canManage && <button onClick={() => { setEditFor(null); setForm(emptyMachine()); setShowAdd(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.machines.addMachine")}</button>}
      </div>
      <div className="flex gap-2 mt-3 mb-4">
        {["ALL", "STATIONARY", "ISSUABLE"].map((k) => (
          <button key={k} onClick={() => setKindFilter(k)} className={`px-3 py-1 rounded-lg text-sm border ${kindFilter === k ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300"}`}>
            {k === "ALL" ? t("common.all") : k === "STATIONARY" ? t("mfg.machines.kindStationary") : t("mfg.machines.kindIssuable")}
          </button>
        ))}
      </div>

      {issuances.filter((i) => i.status === "OUT" || i.status === "PARTIAL").length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto mb-6">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-sm">{t("mfg.machines.openCheckouts")}</div>
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr><th className="p-2">{t("mfg.machines.colMachine")}</th><th className="p-2">{t("mfg.machines.colWorker")}</th><th className="p-2">{t("mfg.machines.colIssuedOn")}</th><th className="p-2">{t("mfg.machines.colPartsOut")}</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {issuances.filter((i) => i.status === "OUT" || i.status === "PARTIAL").map((iss) => {
                const out = (iss.items ?? []).filter((it: any) => it.status === "OUT");
                return (
                  <tr key={iss.id} className="border-b">
                    <td className="p-2 font-medium">{iss.machine?.name}</td>
                    <td className="p-2">{workerName(iss.workerId)}</td>
                    <td className="p-2 text-gray-500">{formatDate(iss.issuedAt)}</td>
                    <td className="p-2">{out.length > 0 ? `${out.map((o: any) => `${o.componentName}×${o.expectedQuantity}`).join(", ")}` : "—"}</td>
                    <td className="p-2 text-right">{canManage && <button onClick={() => openReturn(iss)} className="text-xs text-green-600 hover:underline">{t("mfg.machines.return")}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {listed.map((m) => {
          const activeIss = issuances.find((i) => i.machineId === m.id && (i.status === "OUT" || i.status === "PARTIAL"));
          const issuable = m.kind === "ISSUABLE";
          return (
            <div key={m.id} className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-800">{m.name} <span className="text-gray-400 font-mono text-xs ml-1">{m.code}</span></p>
                  <p className="text-xs text-gray-400 mt-0.5">{issuable ? t("mfg.machines.issuableTool") : t("mfg.machines.stationaryMachine")}{m.type ? ` · ${m.type}` : ""}{m.hourlyRate != null ? ` · ${m.hourlyRate}${t("mfg.machines.perHour")}` : ""}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${MSTATUS[m.status] ?? "bg-gray-100"}`}>{activeIss ? t("mfg.machines.stWithWorker") : t(MSTATUS_KEY[m.status] ?? "")}</span>
              </div>
              <div className="mt-3 border-t pt-2 flex items-center justify-between gap-2 flex-wrap">
                {activeIss ? (
                  <span className="text-xs text-gray-600">{t("mfg.machines.issuedTo")} <span className="font-medium">{workerName(activeIss.workerId)}</span></span>
                ) : issuable && m.status === "AVAILABLE" && canManage ? (
                  <span className="text-xs text-gray-500">{t("mfg.machines.availableToIssue")}</span>
                ) : (
                  <span className="text-xs text-gray-400">{t("mfg.machines.partsCount", { count: (m.components ?? []).length })}</span>
                )}
                <div className="flex items-center gap-2">
                  {canManage && issuable && !activeIss && m.status === "AVAILABLE" && (
                    <button onClick={() => openIssue(m)} className="text-xs text-blue-600 hover:underline">{t("mfg.machines.issueToWorker")}</button>
                  )}
                  {canManage && activeIss && <button onClick={() => openReturn(activeIss)} className="text-xs text-green-600 hover:underline">{t("mfg.machines.return")}</button>}
                  {canManage && !activeIss && (
                    <>
                      <button onClick={() => startEdit(m)} className="text-xs text-blue-600 hover:underline">{t("mfg.common.edit")}</button>
                      <button onClick={() => setConfirmDel(m)} className="text-xs text-red-500 hover:underline">{t("common.remove")}</button>
                      <select value={m.status} onChange={(e) => setStatus(`/manufacturing/machines/${m.id}/status`, e.target.value, m.id)} disabled={busyStatus === m.id} className="border rounded p-1 text-xs disabled:opacity-60" title={t("mfg.machines.changeStatus")}>
                        {["AVAILABLE", "UNDER_MAINTENANCE", "DECOMMISSIONED"].map((s) => <option key={s} value={s}>{t(MSTATUS_KEY[s] ?? "")}</option>)}
                      </select>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {listed.length === 0 && <p className="col-span-full bg-white border rounded-xl p-6 text-center text-gray-400">{t("mfg.machines.noMachines")}</p>}
      </div>
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setEditFor(null); }} title={editFor ? t("mfg.machines.editTitle") : t("mfg.machines.addTitle")}>
        <form onSubmit={addMachine} className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.kindLabel")} *</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
                <option value="STATIONARY">{t("mfg.machines.kindStationaryLong")}</option>
                <option value="ISSUABLE">{t("mfg.machines.kindIssuableLong")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.codeLabel")} *</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("mfg.machines.codePlaceholder")} className={inputCls} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.nameLabel")} *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mfg.machines.namePlaceholder")} className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.usedForLabel")}</label>
              <input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder={t("mfg.machines.usedForPlaceholder")} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.hourlyCostLabel")}</label>
              <input type="number" min="0" step="any" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} placeholder={t("mfg.machines.hourlyCostPlaceholder")} className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowAdd(false); setEditFor(null); }} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <Button type="submit" loading={savingMachine}>{editFor ? t("mfg.machines.saveChanges") : t("mfg.common.save")}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!issueFor} onClose={() => setIssueFor(null)} title={t("mfg.machines.issueTitle", { name: issueFor?.name ?? "" })}>
        <form onSubmit={submitIssue} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.machines.issuedToLabel")} *</label>
            <select value={issueWorker} onChange={(e) => setIssueWorker(e.target.value)} className={inputCls} required>
              <option value="">{t("mfg.machines.chooseWorker")}</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIssueFor(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <Button type="submit" loading={issuing}>{t("mfg.machines.issueMachine")}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!returnFor} onClose={() => setReturnFor(null)} title={t("mfg.machines.returnTitle", { name: returnFor?.machine?.name ?? "" })}>
        <form onSubmit={submitReturn} className="grid grid-cols-1 gap-4">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            {t("mfg.machines.returnIntro", { worker: workerName(returnFor?.workerId ?? null), date: returnFor ? formatDate(returnFor.issuedAt) : "" })}
          </p>
          {(returnFor?.items ?? []).map((it: any) => {
            const s = retState[it.id] ?? emptyRet();
            return (
              <div key={it.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">{it.componentName} ×{it.expectedQuantity}</span>
                  <select value={s.status} onChange={(e) => setRetState((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? emptyRet()), status: e.target.value } }))} className="border rounded p-1 text-sm">
                    {ITEM_STATUS.map((st) => <option key={st} value={st}>{st === "RETURNED" ? t("mfg.machines.itemReturned") : st === "DAMAGED" ? t("mfg.machines.itemDamaged") : t("mfg.machines.itemMissing")}</option>)}
                  </select>
                </div>
                {s.status !== "RETURNED" && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input type="number" min="0" step="any" placeholder={t("mfg.machines.replacementCost")} value={s.cost}
                      onChange={(e) => setRetState((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? emptyRet()), cost: e.target.value } }))} className="border p-1.5 rounded text-sm w-full" />
                    <input placeholder={t("common.notes")} value={s.notes}
                      onChange={(e) => setRetState((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? emptyRet()), notes: e.target.value } }))} className="border p-1.5 rounded text-sm w-full" />
                  </div>
                )}
              </div>
            );
          })}
          {(returnFor?.items ?? []).length === 0 && <p className="text-xs text-gray-400">{t("mfg.machines.noParts")}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReturnFor(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <Button type="submit" loading={returning} variant="emerald">{t("mfg.machines.recordReturn")}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!confirmDel} onClose={() => setConfirmDel(null)} title={t("mfg.machines.removeConfirmTitle")}>
        <div className="grid grid-cols-1 gap-4">
          <p className="text-sm text-gray-600">{t("mfg.machines.removeConfirm", { name: confirmDel?.name ?? "", code: confirmDel?.code ?? "" })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDel(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <Button type="button" loading={deletingMachine} variant="danger" onClick={doDelete}>{t("mfg.machines.removeMachine")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
