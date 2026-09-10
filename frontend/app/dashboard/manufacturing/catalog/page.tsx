"use client";
import api from "@/lib/api";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

/**
 * Manufacturing Design Catalog — customer-facing designs/products with specs,
 * blueprints/media and a default production BOM. Job orders can link to these
 * items; picking a design auto-applies its default BOM when none is chosen.
 */
export default function DesignCatalogPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manufacturing.manage");

  const [cats, setCats] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [filterCat, setFilterCat] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const empty = () => ({
    id: null,
    categoryId: filterCat || "",
    sku: "",
    name: "",
    description: "",
    dims: "",
    materials: "",
    finish: "",
    details: "",
    mediaInput: "",
    defaultBomId: "",
  });
  const [form, setForm] = useState<any>(null);
  const [catForm, setCatForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cRes, iRes, bRes] = await Promise.all([
        api
          .get("/manufacturing/catalog/categories")
          .catch(() => ({ data: { tree: [], categories: [] } })),
        api.get("/manufacturing/catalog/items").catch(() => ({ data: [] })),
        api.get("/manufacturing/boms").catch(() => ({ data: [] })),
      ]);
      setCats(cRes.data?.tree ?? []);
      setItems(iRes.data ?? []);
      setBoms(bRes.data ?? []);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load design catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => setForm(empty());
  const openEdit = (item: any) => {
    const f = empty();
    f.id = item.id;
    f.categoryId = item.categoryId ? String(item.categoryId) : "";
    f.sku = item.sku ?? "";
    f.name = item.name ?? "";
    f.description = item.description ?? "";
    f.mediaInput = (item.mediaUrls ?? []).join("\n");
    f.defaultBomId = item.defaultBomId ? String(item.defaultBomId) : "";
    setForm(fillSpec(f, item));
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    const payload = {
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      sku: form.sku.trim() || undefined,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      specifications: specObj() ?? undefined,
      mediaUrls: form.mediaInput
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean),
      defaultBomId: form.defaultBomId ? Number(form.defaultBomId) : null,
    };
    try {
      if (form.id)
        await api.patch(`/manufacturing/catalog/items/${form.id}`, payload);
      else await api.post("/manufacturing/catalog/items", payload);
      setForm(null);
      await load();
    } catch (ex: any) {
      setError(ex?.response?.data?.message ?? "Failed to save catalog item");
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (item: any) => {
    if (!window.confirm(`Delete design "${item.name}"?`)) return;
    try {
      await api.delete(`/manufacturing/catalog/items/${item.id}`);
      await load();
    } catch (ex: any) {
      setError(ex?.response?.data?.message ?? "Failed to delete design");
    }
  };

  const openNewCat = (parentId = "") =>
    setCatForm({ id: null, parentId, name: "", description: "" });
  const saveCat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catForm?.name?.trim()) return;
    setSaving(true);
    setError("");
    const payload = {
      name: catForm.name.trim(),
      parentId: catForm.parentId ? Number(catForm.parentId) : undefined,
      description: catForm.description?.trim() || undefined,
    };
    try {
      if (catForm.id)
        await api.patch(
          `/manufacturing/catalog/categories/${catForm.id}`,
          payload,
        );
      else await api.post("/manufacturing/catalog/categories", payload);
      setCatForm(null);
      await load();
    } catch (ex: any) {
      setError(ex?.response?.data?.message ?? "Failed to save category");
    } finally {
      setSaving(false);
    }
  };
  const deleteCat = async (c: any) => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try {
      await api.delete(`/manufacturing/catalog/categories/${c.id}`);
      await load();
    } catch (ex: any) {
      setError(ex?.response?.data?.message ?? "Failed to delete category");
    }
  };

  const flatten = (list: any[]): any[] =>
    list.flatMap((c) => [c, ...flatten(c.children ?? [])]);
  const catName = (id?: number | string | null) =>
    flatten(cats).find((c) => String(c.id) === String(id))?.name ?? "";
  const catPath = (id?: number | string | null) => {
    const findTrail = (nodes: any[], trail: string[]): string[] | null => {
      for (const n of nodes) {
        if (String(n.id) === String(id)) return [...trail, n.name];
        const r = findTrail(n.children ?? [], [...trail, n.name]);
        if (r) return r;
      }
      return null;
    };
    return findTrail(cats, [])?.join(" / ") ?? "";
  };
  const bomLabel = (id?: number | string | null) => {
    const b = boms.find((x) => String(x.id) === String(id));
    return b
      ? `${b.finishedProduct?.baseName ?? "BOM"} #${b.id}`
      : "—";
  };
  const firstMedia = (urls: any) => {
    const list = Array.isArray(urls) ? urls : [];
    return (
      list.find((u) => /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(u)) ??
      list[0] ??
      ""
    );
  };

  const specObj = () => {
    const s: Record<string, string> = {};
    if (form.dims) s.dimensions = form.dims;
    if (form.materials) s.materials = form.materials;
    if (form.finish) s.finish = form.finish;
    if (form.details) s.details = form.details;
    return Object.keys(s).length ? s : null;
  };
  const fillSpec = (f: any, item: any) => {
    const s = item?.specifications ?? {};
    f.dims = s.dimensions ?? "";
    f.materials = s.materials ?? "";
    f.finish = s.finish ?? "";
    f.details = s.details ?? "";
    return f;
  };

  if (loading) return <p className="text-gray-500 p-6">Loading design catalog…</p>;
  const shown = items.filter(
    (i) =>
      (!filterCat || String(i.categoryId) === String(filterCat)) &&
      (!search ||
        `${i.name} ${i.sku ?? ""} ${i.description ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Design Catalog</h1>
          <p className="text-sm text-gray-400">
            Product &amp; design registry with specs, blueprints and default
            production BOMs — linked from job orders and work orders.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openNew}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium"
          >
            + New Design
          </button>
        )}
      </div>
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>
      )}

      <div className="grid md:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Categories */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 space-y-1">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Categories
            </p>
            {canManage && (
              <button
                onClick={() => openNewCat()}
                className="text-xs text-blue-600 hover:underline"
              >
                + Add
              </button>
            )}
          </div>
          <button
            onClick={() => setFilterCat("")}
            className={`w-full text-left text-sm px-2 py-1.5 rounded ${
              !filterCat
                ? "bg-blue-50 text-blue-700 font-medium"
                : "hover:bg-gray-50 text-gray-600"
            }`}
          >
            All designs
          </button>
          {cats.map((c) => (
            <CatRow
              key={c.id}
              node={c}
              depth={0}
              selected={filterCat}
              onSelect={(id: any) => setFilterCat(String(id))}
              canManage={canManage}
              onNewChild={openNewCat}
              onEdit={(cc: any) =>
                setCatForm({
                  id: cc.id,
                  parentId: String(cc.parentId ?? ""),
                  name: cc.name,
                  description: cc.description ?? "",
                })
              }
              onDelete={deleteCat}
            />
          ))}
        </div>


        {/* Items */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search designs, SKUs, descriptions…"
              className="border border-gray-300 rounded p-2 text-sm flex-1 min-w-[180px]"
            />
            <span className="text-xs text-gray-400 self-center">
              {shown.length} designs
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">
              No designs yet{filterCat ? " in this category" : ""}.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {shown.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
                >
                  <div className="h-32 bg-gray-100 flex items-center justify-center overflow-hidden">
                    {firstMedia(item.mediaUrls) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={firstMedia(item.mediaUrls)}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-3xl text-gray-300">🛠</span>
                    )}
                  </div>
                  <div className="p-3 space-y-1.5 flex-1">
                    <p className="font-medium text-gray-800 truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.sku ? `${item.sku} · ` : ""}
                      {item.category
                        ? catPath(item.category.id) || catName(item.category.id)
                        : "Uncategorized"}
                    </p>
                    {(item.specifications?.dimensions ||
                      item.specifications?.materials ||
                      item.specifications?.finish) && (
                      <p className="text-[11px] text-gray-500">
                        {[
                          item.specifications.dimensions,
                          item.specifications.materials,
                          item.specifications.finish,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400">
                      Default BOM: {bomLabel(item.defaultBomId)}
                    </p>
                  </div>
                  {canManage && (
                    <div className="px-3 pb-3 flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(item)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteItem(item)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* Catalog item modal */}
      {form && (
        <Modal
          isOpen
          onClose={() => setForm(null)}
          title={form.id ? "Edit Design" : "New Design"}
        >
          <form onSubmit={saveItem} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full">
                <option value="">Uncategorized</option>
                {flatten(cats).map((c) => (
                  <option key={c.id} value={c.id}>
                    {catPath(c.id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="border border-gray-300 rounded p-2 text-sm w-full" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["dims", "Dimensions"],
                ["materials", "Materials"],
                ["finish", "Finish options"],
              ].map(([k, label]) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Additional spec notes</label>
              <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} rows={2} className="border border-gray-300 rounded p-2 text-sm w-full" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Media URLs (one per line — blueprints / renders)
              </label>
              <textarea
                value={form.mediaInput}
                onChange={(e) => setForm({ ...form, mediaInput: e.target.value })}
                rows={3}
                className="border border-gray-300 rounded p-2 text-sm w-full font-mono"
                placeholder="https://…/blueprint.png"
              />
              {form.mediaInput
                .split("\n")
                .map((s: string) => s.trim())
                .filter(Boolean)
                .slice(0, 3)
                .map((u: string, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={u}
                    alt=""
                    className="mt-2 h-16 w-24 object-cover rounded border border-gray-200 inline-block mr-2"
                  />
                ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Default BOM (auto-applied to job orders)
              </label>
              <select
                value={form.defaultBomId}
                onChange={(e) => setForm({ ...form, defaultBomId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              >
                <option value="">None</option>
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {bomLabel(b.id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} disabled={saving} className="px-3 py-2 text-sm text-gray-600">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium"
              >
                {saving ? "Saving…" : "Save Design"}
              </button>
            </div>
          </form>
        </Modal>
      )}


      {/* Category modal */}
      {catForm && (
        <Modal
          isOpen
          onClose={() => setCatForm(null)}
          title={catForm.id ? "Edit Category" : "New Category"}
        >
          <form onSubmit={saveCat} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Parent</label>
              <select
                value={catForm.parentId}
                onChange={(e) => setCatForm({ ...catForm, parentId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              >
                <option value="">Top level</option>
                {flatten(cats)
                  .filter((c) => c.id !== catForm.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {catPath(c.id)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
              <input
                value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
              <textarea
                value={catForm.description}
                onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                rows={2}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCatForm(null)}
                disabled={saving}
                className="px-3 py-2 text-sm text-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium"
              >
                {saving ? "Saving…" : "Save Category"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function CatRow({
  node,
  depth,
  selected,
  onSelect,
  canManage,
  onNewChild,
  onEdit,
  onDelete,
}: any) {
  return (
    <div>
      <div className="group flex items-center gap-1">
        <button
          onClick={() => onSelect(node.id)}
          style={{ marginLeft: depth * 10 }}
          className={`flex-1 text-left text-sm px-2 py-1.5 rounded ${
            selected === String(node.id)
              ? "bg-blue-50 text-blue-700 font-medium"
              : "hover:bg-gray-50 text-gray-600"
          }`}
        >
          {node.name}
        </button>
        {canManage && (
          <div className="hidden group-hover:flex items-center gap-1 pr-1">
            <button
              onClick={() => onNewChild(node.id)}
              title="Add sub-category"
              className="text-[11px] text-blue-600 hover:underline"
            >
              +
            </button>
            <button
              onClick={() => onEdit(node)}
              className="text-[11px] text-gray-400 hover:text-gray-600"
            >
              ✎
            </button>
            <button
              onClick={() => onDelete(node)}
              className="text-[11px] text-red-400 hover:text-red-600"
            >
              ×
            </button>
          </div>
        )}
      </div>
      {(node.children ?? []).map((c: any) => (
        <CatRow
          key={c.id}
          node={c}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          canManage={canManage}
          onNewChild={onNewChild}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

