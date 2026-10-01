"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatWeekdayDate, weekdayShort } from "@/lib/datetime";
import { statusLabel } from "@/lib/statusLabel";

const BADGE: Record<string, string> = { SCHEDULED: "bg-gray-100 text-gray-600", ACTIVE: "bg-green-100 text-green-800", ENDED: "bg-blue-100 text-blue-800" };
// Shift patterns repeat on weekday numbers 0=Sunday … 6=Saturday; the labels are
// localized at render time via weekdayShort().
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const isoDate = (d: Date | string) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const emptyTemplate = () => ({ name: "", startTime: "08:00", endTime: "16:00", type: "repeats" as "repeats" | "oneTime", repeatDays: [1, 2, 3, 4, 5], date: isoDate(new Date()) });
const emptyShift = () => ({ templateId: "", date: isoDate(new Date()), workers: [] as number[] });

export default function ManufacturingShiftsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSession, setShowSession] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [shiftForm, setShiftForm] = useState(emptyShift());
  const [templateForm, setTemplateForm] = useState(emptyTemplate());
  const [workersFor, setWorkersFor] = useState<any | null>(null);
  const [workerIds, setWorkerIds] = useState<number[]>([]);
  const canManage = hasPermission("manufacturing.manage");
  const workerName = (id: number | null) => staff.find((u) => u.id === id)?.name ?? (id == null ? "—" : `#${id}`);
  const daysTxt = (days: number[]) => (days ?? []).map((d) => weekdayShort(d)).join(", ");

  const load = useCallback(async () => {
    try {
      const [s, t, u] = await Promise.all([
        api.get("/manufacturing/shift-sessions"),
        api.get("/manufacturing/shift-templates").catch(() => ({ data: [] })),
        api.get("/users?page=1&pageSize=100").catch(() => ({ data: [] })),
      ]);
      setSessions(s.data ?? []);
      setTemplates(t.data ?? []);
      setStaff(Array.isArray(u.data) ? u.data : (u.data?.data ?? []));
    } catch {
      toast.error(t("mfg.shifts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  const selectedPattern = templates.find((tpl) => tpl.id === Number(shiftForm.templateId)) ?? null;
  const recurring = selectedPattern ? (selectedPattern.repeatDays ?? []).length > 0 : false;
  const dayErr = useMemo(() => {
    if (!selectedPattern || !recurring || !shiftForm.date) return "";
    const wd = new Date(shiftForm.date).getDay();
    return selectedPattern.repeatDays.includes(wd) ? "" : t("mfg.shifts.patternDaysMismatch", { days: daysTxt(selectedPattern.repeatDays) });
  }, [selectedPattern, recurring, shiftForm.date, t]);
  const canSubmitShift = !!selectedPattern && dayErr === "";
  const openShiftFrom = (tpl: any) => { setShiftForm({ templateId: String(tpl.id), date: isoDate(new Date()), workers: [] }); setShowSession(true); };

  const addShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPattern) return;
    if (recurring) {
      if (!shiftForm.date) { toast.error(t("mfg.shifts.pickShiftDay")); return; }
      const wd = new Date(shiftForm.date).getDay();
      if (!selectedPattern.repeatDays.includes(wd)) { toast.error(t("mfg.shifts.patternNotOnDay")); return; }
    }
    try {
      const payload: any = { templateId: selectedPattern.id, workers: shiftForm.workers };
      if (recurring) payload.date = shiftForm.date;
      await api.post("/manufacturing/shift-sessions/from-template", payload);
      toast.success(t("mfg.shifts.added"));
      setShowSession(false);
      setShiftForm(emptyShift());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.shifts.addFailed"));
    }
  };

  const createPattern = async (e: React.FormEvent) => {
    e.preventDefault();
    const repeat = templateForm.type === "repeats";
    if (repeat && templateForm.repeatDays.length === 0) { toast.error(t("mfg.shifts.pickPatternDay")); return; }
    if (!repeat && !templateForm.date) { toast.error(t("mfg.shifts.pickOneTimeDate")); return; }
    try {
      await api.post("/manufacturing/shift-templates", {
        name: templateForm.name,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        repeatDays: repeat ? templateForm.repeatDays : [],
        date: repeat ? undefined : templateForm.date,
      });
      toast.success(t("mfg.shifts.patternSaved"));
      setShowTemplate(false);
      setTemplateForm(emptyTemplate());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.shifts.patternFailed"));
    }
  };

  const act = async (id: number, action: string) => {
    try {
      const r = await api.post(`/manufacturing/shift-sessions/${id}/${action}`);
      if (action === "end" && r.data) {
        const tools = (r.data.unreturnedIssuances ?? []).length;
        if (r.data.handoverClean === false) toast.error(t("mfg.shifts.endHadUnreturned"));
        else if (tools > 0) toast.error(t("mfg.shifts.endHadTools", { count: tools }));
        else toast.success(t("mfg.shifts.updated"));
      } else {
        toast.success(t("mfg.shifts.updated"));
      }
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.shifts.updateFailed"));
    }
  };

  const addWorkers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workersFor || workerIds.length === 0) return;
    try {
      await api.post(`/manufacturing/shift-sessions/${workersFor.id}/workers`, { workerIds });
      toast.success(t("mfg.shifts.workersAssigned"));
      setWorkersFor(null);
      setWorkerIds([]);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.shifts.assignFailed"));
    }
  };

  if (loading) return <Loading className="py-24" />;
  const inputCls = "border p-2 rounded-lg w-full bg-white";
  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.shifts.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("mfg.shifts.subtitle")}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => { setShowSession(true); setShiftForm(emptyShift()); }} disabled={templates.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40">{t("mfg.shifts.addShift")}</button>
            <button onClick={() => { setShowTemplate(true); setTemplateForm(emptyTemplate()); }} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm">{t("mfg.shifts.addPattern")}</button>
          </div>
        )}
      </div>
      {canManage && templates.length === 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 mb-4">{t("mfg.shifts.noPatternsWarning")}</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto mb-6">
        <table className="w-full text-left min-w-[720px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">{t("mfg.shifts.colShift")}</th><th className="p-3">{t("mfg.shifts.colDate")}</th><th className="p-3">{t("mfg.shifts.colHours")}</th>
              <th className="p-3">{t("mfg.shifts.colWorkers")}</th><th className="p-3">{t("common.status")}</th><th className="p-3">{t("mfg.shifts.colHandover")}</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{formatWeekdayDate(s.date)}</td>
                <td className="p-3">{s.startTime} – {s.endTime}</td>
                <td className="p-3">
                  {(() => {
                    const names = (s.assignments ?? []).map((a: any) => workerName(a.workerId)).filter(Boolean);
                    if (names.length === 0) return <span className="text-gray-400">{t("mfg.common.noneYet")}</span>;
                    return <span title={names.join(", ")}>{names.slice(0, 2).join(", ")}{names.length > 2 ? ` ${t("mfg.shifts.moreCount", { count: names.length - 2 })}` : ""}</span>;
                  })()}
                </td>
                <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${BADGE[s.status] ?? "bg-gray-100"}`}>{statusLabel(s.status)}</span></td>
                <td className="p-3">{s.status === "ENDED" ? (s.handoverClean ? t("mfg.shifts.handoverClean") : t("mfg.shifts.handoverMissing")) : "—"}</td>
                <td className="p-3 whitespace-nowrap">
                  {canManage && s.status === "SCHEDULED" && <button onClick={() => act(s.id, "start")} className="text-xs text-green-600 hover:underline mr-2">{t("mfg.shifts.start")}</button>}
                  {canManage && s.status === "ACTIVE" && <button onClick={() => act(s.id, "end")} className="text-xs text-red-600 hover:underline mr-2">{t("mfg.shifts.end")}</button>}
                  {canManage && <button onClick={() => { setWorkersFor(s); setWorkerIds([]); }} className="text-xs text-blue-600 hover:underline">{t("mfg.shifts.assignWorkers")}</button>}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">{t("mfg.shifts.noShifts")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold">{t("mfg.shifts.patternsTitle")}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t("mfg.shifts.patternsHint")}</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {templates.map((tpl) => {
            const rep = (tpl.repeatDays ?? []).length > 0;
            return (
              <li key={tpl.id} className="px-4 py-2 text-sm flex justify-between gap-3 items-center">
                <div>
                  <span className="font-medium text-gray-700">{tpl.name}</span>
                  <span className="text-gray-500"> · {tpl.startTime} – {tpl.endTime}</span>
                  <div className="text-xs text-gray-400 mt-0.5">{rep ? <>{t("mfg.shifts.repeatsDays", { days: daysTxt(tpl.repeatDays) })}</> : <>{t("mfg.shifts.oneTimeShort", { date: tpl.date ? formatWeekdayDate(tpl.date) : "—" })}</>}</div>
                </div>
                {canManage && <button onClick={() => openShiftFrom(tpl)} className="text-xs text-blue-600 hover:underline shrink-0">{t("mfg.shifts.useForShift")}</button>}
              </li>
            );
          })}
          {templates.length === 0 && <li className="px-4 py-3 text-gray-400 text-sm">{t("mfg.shifts.noPatterns")}</li>}
        </ul>
      </div>

      <Modal isOpen={showSession} onClose={() => setShowSession(false)} title={t("mfg.shifts.addTitle")}>
        <form onSubmit={addShift} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.shiftPatternLabel")} *</label>
            <select value={shiftForm.templateId} onChange={(e) => setShiftForm((f) => ({ ...f, templateId: e.target.value }))} className={inputCls} required>
              <option value="">{t("mfg.shifts.choosePattern")}</option>
              {templates.filter((tpl: any) => (tpl.repeatDays ?? []).length > 0).map((tpl: any) => (
                <option key={tpl.id} value={tpl.id}>{t("mfg.shifts.repeatsOption", { name: tpl.name, days: daysTxt(tpl.repeatDays) })}</option>
              ))}
              {templates.filter((tpl: any) => (tpl.repeatDays ?? []).length === 0).map((tpl: any) => (
                <option key={tpl.id} value={tpl.id}>{t("mfg.shifts.oneTimeOption", { name: tpl.name, date: tpl.date ? formatWeekdayDate(tpl.date) : "—" })}</option>
              ))}
            </select>
          </div>
          {selectedPattern && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              {selectedPattern.name} · {selectedPattern.startTime} – {selectedPattern.endTime} · {recurring ? t("mfg.shifts.repeatsDays", { days: daysTxt(selectedPattern.repeatDays) }) : t("mfg.shifts.oneTimeOn", { date: selectedPattern.date ? formatWeekdayDate(selectedPattern.date) : "—" })}
            </p>
          )}
          {selectedPattern && recurring && (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.dayOfShiftLabel")} *</label>
              <input type="date" value={shiftForm.date} onChange={(e) => setShiftForm((f) => ({ ...f, date: e.target.value }))} className={inputCls} required />
              {dayErr && <p className="text-xs text-red-600 mt-1">{dayErr}</p>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.whoIsWorkingLabel")} <span className="text-gray-400 font-normal">({t("mfg.common.optional")})</span></label>
            {staff.length === 0 ? (
              <p className="text-xs text-gray-400">{t("mfg.shifts.noTeamMembers")}</p>
            ) : (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100 bg-white">
                {staff.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" className="accent-blue-600" checked={shiftForm.workers.includes(u.id)} onChange={() => setShiftForm((f) => ({ ...f, workers: f.workers.includes(u.id) ? f.workers.filter((x) => x !== u.id) : [...f.workers, u.id] }))} />
                    <span className="text-gray-700">{u.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSession(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" disabled={!canSubmitShift} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{t("mfg.shifts.addTitle")}</button>
          </div>
        </form>
      </Modal>
      <Modal isOpen={showTemplate} onClose={() => setShowTemplate(false)} title={t("mfg.shifts.patternTitle")}>
        <form onSubmit={createPattern} className="grid grid-cols-1 gap-4">
          <div>
            <span className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.patternKindLabel")}</span>
            <div className="flex gap-2">
              {(["repeats", "oneTime"] as const).map((tp) => (
                <button key={tp} type="button" onClick={() => setTemplateForm((f) => ({ ...f, type: tp, date: tp === "repeats" ? isoDate(new Date()) : f.date }))}
                  className={`px-4 py-2 rounded-lg text-sm border ${templateForm.type === tp ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300"}`}>
                  {tp === "repeats" ? t("mfg.shifts.repeats") : t("mfg.shifts.oneTime")}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">{templateForm.type === "repeats" ? t("mfg.shifts.patternKindRepeatsHint") : t("mfg.shifts.patternKindOneTimeHint")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.patternNameLabel")} *</label>
            <input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder={templateForm.type === "repeats" ? t("mfg.shifts.patternNameRepeatsPlaceholder") : t("mfg.shifts.patternNameOneTimePlaceholder")} className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.startTimeLabel")}</label>
              <input type="time" value={templateForm.startTime} onChange={(e) => setTemplateForm({ ...templateForm, startTime: e.target.value })} className={inputCls} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.endTimeLabel")}</label>
              <input type="time" value={templateForm.endTime} onChange={(e) => setTemplateForm({ ...templateForm, endTime: e.target.value })} className={inputCls} required />
            </div>
          </div>
          {templateForm.type === "repeats" ? (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.repeatsOnLabel")} <span className="text-gray-400 font-normal">{t("mfg.shifts.repeatsOnHint")}</span></label>
              <div className="flex flex-wrap gap-2">
                {DAY_INDEXES.map((n) => {
                  const on = templateForm.repeatDays.includes(n);
                  return (
                    <button key={n} type="button" onClick={() => setTemplateForm((f) => ({ ...f, repeatDays: on ? f.repeatDays.filter((x) => x !== n) : [...f.repeatDays, n] }))}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300"}`}>
                      {weekdayShort(n)}
                    </button>
                  );
                })}
              </div>
              {templateForm.repeatDays.length === 0 && <p className="text-xs text-amber-600 mt-1">{t("mfg.shifts.pickDayHint")}</p>}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.onWhichDateLabel")} *</label>
              <input type="date" value={templateForm.date} onChange={(e) => setTemplateForm({ ...templateForm, date: e.target.value })} className={inputCls} required />
              <p className="text-xs text-gray-400 mt-1">{t("mfg.shifts.oneTimeHint")}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowTemplate(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.shifts.savePattern")}</button>
          </div>
        </form>
      </Modal>
      <Modal isOpen={!!workersFor} onClose={() => setWorkersFor(null)} title={t("mfg.shifts.workersForTitle", { name: workersFor?.name ?? "" })}>
        <form onSubmit={addWorkers} className="grid grid-cols-1 gap-4">
          {(() => {
            const assigned = (workersFor?.assignments ?? []).map((a: any) => a.workerId).filter(Boolean);
            return (
              <>
                {assigned.length > 0 && (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    {t("mfg.shifts.alreadyAssigned")} <span className="text-gray-700 font-medium">{assigned.map(workerName).join(", ")}</span>
                  </p>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.shifts.addMoreWorkers")}</label>
                  {staff.length === 0 ? (
                    <p className="text-xs text-gray-400">{t("mfg.shifts.noTeamMembers")}</p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100 bg-white">
                      {staff.filter((u) => !assigned.includes(u.id)).map((u) => (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                          <input type="checkbox" className="accent-blue-600" checked={workerIds.includes(u.id)} onChange={() => setWorkerIds((prev) => (prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]))} />
                          <span className="text-gray-700">{u.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setWorkersFor(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" disabled={workerIds.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{t("mfg.shifts.assignSelected")}</button>
          </div>
        </form>
      </Modal>



    </div>
  );
}

