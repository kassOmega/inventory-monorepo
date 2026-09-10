"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface LineState {
  rawMaterialProductId: string;
  quantityRequired: string;
}

interface FormState {
  finishedProductId: string;
  quantityProduced: string;
  scrapPercentage: string;
  notes: string;
  lines: LineState[];
}

const emptyForm = (): FormState => ({
  finishedProductId: "",
  quantityProduced: "1",
  scrapPercentage: "0",
  notes: "",
  lines: [{ rawMaterialProductId: "", quantityRequired: "" }],
});

const productName = (p: any) =>
  p ? `${p.brand ?? ""} ${p.baseName ?? ""}`.trim() : "";

export default function ManufacturingBomsPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [boms, setBoms] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [detail, setDetail] = useState<any | null>(null);

  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        api.get("/manufacturing/boms"),
        api.get("/products").catch(() => ({ data: [] })),
      ]);
      setBoms(b.data ?? []);
      setProducts(p.data ?? []);
    } catch {
      toast.error(t("mfg.boms.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boms;
    return boms.filter((b) => {
      const fp = b.finishedProduct;
      const hay = [productName(fp), ...(b.items ?? []).map((it: any) => productName(it.rawMaterial))]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [boms, search]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (b: any) => {
    setEditing(b);
    setForm({
      finishedProductId: String(b.finishedProductId),
      quantityProduced: String(b.quantityProduced ?? 1),
      scrapPercentage: String(b.scrapPercentage ?? 0),
      notes: b.notes ?? "",
      lines: (b.items ?? []).map((it: any) => ({
        rawMaterialProductId: String(it.rawMaterialProductId),
        quantityRequired: String(it.quantityRequired),
      })),
    });
    setShowForm(true);
  };

  const remove = async (b: any) => {
    const ok = await confirm(t("mfg.boms.deleteConfirm", { name: productName(b.finishedProduct) }));
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/boms/${b.id}`);
      toast.success(t("mfg.boms.bomDeleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.boms.failedDelete"));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = form.lines
      .filter((l) => l.rawMaterialProductId && l.quantityRequired)
      .map((l) => ({
        rawMaterialProductId: Number(l.rawMaterialProductId),
        quantityRequired: Number(l.quantityRequired),
      }));
    if (!form.finishedProductId || items.length === 0) return;
    const payload = {
      finishedProductId: Number(form.finishedProductId),
      quantityProduced: Number(form.quantityProduced) || 1,
      scrapPercentage: Number(form.scrapPercentage) || 0,
      notes: form.notes.trim() || undefined,
      items,
    };
    try {
      if (editing) await api.patch(`/manufacturing/boms/${editing.id}`, payload);
      else await api.post("/manufacturing/boms", payload);
      toast.success(t("mfg.boms.bomSaved"));
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.boms.failedSave"));
    }
  };


  const setLine = (i: number, patch: Partial<LineState>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));

  if (loading) return <Loading className="py-24" />;

  const label = (text: string, required?: boolean) => (
    <label className="block text-sm font-medium text-gray-500 mb-1">
      {text}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("nav.billOfMaterials")}
        </h1>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm"
          >
            {t("mfg.boms.newBom")}
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("mfg.boms.searchPlaceholder")}
        aria-label={t("mfg.boms.searchPlaceholder")}
        className="border p-2 rounded-lg w-full sm:w-96 mb-6 text-sm"
      />

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[720px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4"></th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.boms.colProduct")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.boms.colYield")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.boms.colScrap")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.boms.colComponents")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.boms.colUpdated")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const open = expanded.has(b.id);
                return (
                  <Fragment key={b.id}>
                    <tr onClick={() => setDetail(b)} className="border-b hover:bg-gray-50 cursor-pointer">
                      <td className="p-2 sm:p-3 md:p-4">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(b.id);
                          }}
                          className="text-gray-400 cursor-pointer align-middle"
                          aria-label={open ? t("mfg.boms.colComponents") : t("mfg.boms.colComponents")}
                        >
                          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4 font-medium">
                        {productName(b.finishedProduct) || `#${b.finishedProductId}`}
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">{b.quantityProduced}</td>
                      <td className="p-2 sm:p-3 md:p-4">
                        <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-semibold">
                          {b.scrapPercentage}%
                        </span>
                      </td>
                      <td className="p-2 sm:p-3 md:p-4">{(b.items ?? []).length}</td>
                      <td className="p-2 sm:p-3 md:p-4 text-gray-500">
                        {new Date(b.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="p-2 sm:p-3 md:p-4" onClick={(e) => e.stopPropagation()}>
                        {canManage && (
                          <RowActionsMenu
                            items={[
                              { label: t("mfg.common.edit"), onClick: () => openEdit(b) },
                              {
                                label: t("mfg.common.delete"),
                                color: "text-red-600",
                                onClick: () => remove(b),
                              },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50">
                        <td colSpan={7} className="p-2 sm:p-3 md:p-4">
                          {(b.items ?? []).length === 0 ? (
                            <p className="text-sm text-gray-400">{t("mfg.common.noResults")}</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
                                  <th className="text-left p-1 font-medium">{t("mfg.boms.componentProductLabel")}</th>
                                  <th className="text-right p-1 font-medium">{t("mfg.boms.quantityRequiredLabel")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(b.items ?? []).map((it: any) => (
                                  <tr key={it.id} className="border-t border-gray-200">
                                    <td className="p-1">
                                      {productName(it.rawMaterial) || `#${it.rawMaterialProductId}`}
                                    </td>
                                    <td className="p-1 text-right">
                                      {it.quantityRequired} {t("mfg.boms.perUnit")}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    {t("mfg.boms.noBoms")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>



      {/* Create / Edit BOM modal */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("mfg.boms.editTitle") : t("mfg.boms.createTitle")}
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <div>
            {label(t("mfg.boms.finishedProductLabel"), true)}
            <select
              id="bom-finished"
              value={form.finishedProductId}
              onChange={(e) => setForm({ ...form, finishedProductId: e.target.value })}
              className="border p-2 rounded-lg w-full bg-white"
              required
            >
              <option value="">{t("mfg.common.required")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {productName(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.boms.quantityProducedLabel"), true)}
              <input
                id="bom-qty"
                type="number" min="1" step="any"
                value={form.quantityProduced}
                onChange={(e) => setForm({ ...form, quantityProduced: e.target.value })}
                className="border p-2 rounded-lg w-full"
                required
              />
            </div>
            <div>
              {label(t("mfg.boms.scrapPercentageLabel"))}
              <input
                id="bom-scrap"
                type="number" min="0" step="any"
                value={form.scrapPercentage}
                onChange={(e) => setForm({ ...form, scrapPercentage: e.target.value })}
                className="border p-2 rounded-lg w-full"
              />
            </div>
          </div>
          <div>
            {label(t("mfg.boms.notesLabel"))}
            <textarea
              id="bom-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="border p-2 rounded-lg w-full"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">
              {t("mfg.boms.componentsTitle")}
            </p>
            <div className="space-y-2">
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-6">
                    {label(t("mfg.boms.componentProductLabel"), true)}
                    <select
                      value={l.rawMaterialProductId}
                      onChange={(e) => setLine(i, { rawMaterialProductId: e.target.value })}
                      className="border p-2 rounded-lg w-full bg-white"
                      required
                    >
                      <option value="">{t("mfg.common.required")}</option>
                      {products
                        .filter((p) => String(p.id) !== form.finishedProductId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{productName(p)}</option>
                        ))}
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    {label(t("mfg.boms.quantityRequiredLabel"), true)}
                    <input
                      type="number" min="0.0001" step="any"
                      value={l.quantityRequired}
                      onChange={(e) => setLine(i, { quantityRequired: e.target.value })}
                      className="border p-2 rounded-lg w-full"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))}
                      className="text-xs text-red-600"
                    >
                      {t("mfg.boms.removeComponent")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  lines: [...f.lines, { rawMaterialProductId: "", quantityRequired: "" }],
                }))
              }
              className="text-xs text-blue-600 mt-2"
            >
              {t("mfg.boms.addComponent")}
            </button>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm"
            >
              {t("mfg.common.cancel")}
            </button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              {t("mfg.common.save")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail modal */}
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={t("mfg.boms.detailTitle", { name: productName(detail?.finishedProduct) })}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="text-gray-500">
              {t("mfg.boms.colYield")}: <b>{detail.quantityProduced}</b> · {t("mfg.boms.colScrap")}: <b>{detail.scrapPercentage}%</b>
            </p>
            {detail.notes && <p className="text-gray-600">{detail.notes}</p>}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b">
                  <th className="text-left p-1 font-medium">{t("mfg.boms.componentProductLabel")}</th>
                  <th className="text-right p-1 font-medium">{t("mfg.boms.quantityRequiredLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items ?? []).map((it: any) => (
                  <tr key={it.id} className="border-b border-gray-100">
                    <td className="p-1">{productName(it.rawMaterial)}</td>
                    <td className="p-1 text-right">
                      {it.quantityRequired} {t("mfg.boms.perUnit")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

