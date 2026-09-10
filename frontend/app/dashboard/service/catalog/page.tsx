"use client";

import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

export default function ServiceCatalogPage() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", price: "", durationMins: "30", categoryId: "" });
  const [error, setError] = useState("");
  const [catModal, setCatModal] = useState(false);
  const [catName, setCatName] = useState("");

  const load = useCallback(async () => {
    try {
      const [i, c] = await Promise.all([api.get("/service/items"), api.get("/service/categories")]);
      setItems(i.data);
      setCategories(c.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load catalog");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/service/items", {
        name: form.name,
        price: Number(form.price) || 0,
        durationMins: Number(form.durationMins) || 30,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
      });
      setForm({ name: "", price: "", durationMins: "30", categoryId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create item");
    }
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setError("");
    try {
      await api.post("/service/categories", { name: catName.trim() });
      setCatName("");
      setCatModal(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create category");
    }
  };

  const toggleActive = async (id: number, active: boolean) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    try {
      await api.patch(`/service/items/${id}`, { ...item, active: !active });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update item");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Service Catalog</h1>
        <button
          onClick={() => {
            setCatName("");
            setCatModal(true);
          }}
          className="text-sm border border-gray-300 rounded px-3 py-2 text-gray-700"
        >
          + Category
        </button>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <form onSubmit={create} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Service name" className="border border-gray-300 rounded p-2 text-sm" required />
        <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price (ETB)" type="number" min="0" className="border border-gray-300 rounded p-2 text-sm" />
        <input value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: e.target.value })} placeholder="Duration (min)" type="number" min="5" className="border border-gray-300 rounded p-2 text-sm" />
        <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="md:col-span-4 bg-blue-600 text-white rounded p-2 text-sm font-medium">Add Service</button>
      </form>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Duration</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2 font-medium">{i.name}</td>
                <td className="px-4 py-2 text-gray-500">{i.category?.name ?? "—"}</td>
                <td className="px-4 py-2">{i.price}</td>
                <td className="px-4 py-2">{i.durationMins} min</td>
                <td className="px-4 py-2">
                  <button onClick={() => toggleActive(i.id, i.active)} className={`text-xs px-2 py-0.5 rounded-full ${i.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {i.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => toggleActive(i.id, i.active)} className="text-xs text-blue-600 hover:underline">{i.active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No services yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {catModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">New Category</h2>
            <form onSubmit={submitCategory} className="space-y-3">
              <input
                autoFocus
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Category name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCatModal(false)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
