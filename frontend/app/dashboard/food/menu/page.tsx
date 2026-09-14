"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function FoodMenuPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("restaurant.manage");

  const [categories, setCategories] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  const [catOpen, setCatOpen] = useState(false);
  const [catForm, setCatForm] = useState<{ id: number | null; name: string; route: number[] }>({
    id: null,
    name: "",
    route: [],
  });

  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState<any>({
    id: null,
    categoryId: null,
    name: "",
    description: "",
    price: "",
    cost: "",
    trackingMode: "SIMPLE",
    estimatedCogs: "",
    durationMins: "",
    useCategoryRoute: true,
    route: [],
  });

  // Recipe (ingredient) costing
  const [recipeLines, setRecipeLines] = useState<
    {
      productId: number;
      name: string;
      unit: string | null;
      quantityPerUnit: string;
      currentBuyPrice: number;
    }[]
  >([]);
  const [productOptions, setProductOptions] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState("");

  // "Create Ingredient" quick-create modal
  const [ingOpen, setIngOpen] = useState(false);
  const [ingSaving, setIngSaving] = useState(false);
  const [ingError, setIngError] = useState("");
  const [ingredientCategories, setIngredientCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [ingForm, setIngForm] = useState<{
    brand: string;
    baseName: string;
    buyPrice: string;
    quantity: string;
    unitId: string;
    categoryId: string;
  }>({ brand: "Ingredient", baseName: "", buyPrice: "", quantity: "0", unitId: "", categoryId: "" });
  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");

  const [optOpen, setOptOpen] = useState(false);
  const [optTarget, setOptTarget] = useState<any>(null);
  const [optForm, setOptForm] = useState<{ id: number | null; name: string; extraPrice: string }>({
    id: null,
    name: "",
    extraPrice: "",
  });

  // Station management
  const [stationOpen, setStationOpen] = useState(false);
  const [stationForm, setStationForm] = useState<{
    id: number | null;
    name: string;
    roleName: string;
    roleId: number | null;
  }>({
    id: null,
    name: "",
    roleName: "",
    roleId: null,
  });
  const [stationUsers, setStationUsers] = useState<any[]>([]);

  const stationById = (id: number | null | undefined) =>
    stations.find((s) => s.id === id);

  const stationRouteLabel = (c: any) => {
    const route: any[] = c?.stationRoute ?? [];
    return route.map((r) => r.name).join(" → ") || t("menu.noStation");
  };

  const itemRouteLabel = (it: any) => {
    const route: any[] = Array.isArray(it?.stationRoute) ? it.stationRoute : [];
    return route.length ? route.map((r: any) => r.name).join(" → ") : null;
  };

  const load = useCallback(async () => {
    try {
      // Always merge in any missing default categories (idempotent) and return
      // the full menu, so the predefined categories show up for existing menus.
      const r = await api.post("/restaurant/menu-categories/defaults");
      setCategories(r.data);
      setSelectedId((prev) => prev ?? r.data?.[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("menu.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStations = useCallback(async () => {
    try {
      const r = await api.get("/restaurant/stations");
      setStations(Array.isArray(r.data) ? r.data : []);
    } catch {
      setStations([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadStations();
  }, [load, loadStations]);

  const selected = categories.find((c) => c.id === selectedId) ?? categories[0];

  const openNewCategory = () => {
    setCatForm({ id: null, name: "", route: [] });
    setCatOpen(true);
  };
  const openEditCategory = (c: any) => {
    setCatForm({
      id: c.id,
      name: c.name,
      route: (c.stationRoute ?? []).map((r: any) => r.id),
    });
    setCatOpen(true);
  };
  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (catForm.id) await api.patch(`/restaurant/menu-categories/${catForm.id}`, { name: catForm.name, route: catForm.route });
      else await api.post("/restaurant/menu-categories", { name: catForm.name, route: catForm.route });
      setCatOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedSaveCategory"));
    }
  };

  const addStationToRoute = (id: number) => {
    if (catForm.route.includes(id)) return;
    setCatForm((prev) => ({ ...prev, route: [...prev.route, id] }));
  };
  const removeStationFromRoute = (id: number) => {
    setCatForm((prev) => ({ ...prev, route: prev.route.filter((r) => r !== id) }));
  };
  const moveRouteStation = (index: number, dir: -1 | 1) => {
    setCatForm((prev) => {
      const route = [...prev.route];
      const j = index + dir;
      if (j < 0 || j >= route.length) return prev;
      [route[index], route[j]] = [route[j], route[index]];
      return { ...prev, route };
    });
  };

  // --- Per-item station route control (item override > category route) ---
  const addItemStation = (id: number) => {
    if (itemForm.route.includes(id)) return;
    setItemForm((prev: any) => ({ ...prev, route: [...prev.route, id] }));
  };
  const removeItemStation = (id: number) => {
    setItemForm((prev: any) => ({ ...prev, route: prev.route.filter((r: number) => r !== id) }));
  };
  const moveItemStation = (index: number, dir: -1 | 1) => {
    setItemForm((prev: any) => {
      const route = [...prev.route];
      const j = index + dir;
      if (j < 0 || j >= route.length) return prev;
      [route[index], route[j]] = [route[j], route[index]];
      return { ...prev, route };
    });
  };

  const openNewStation = () => {
    setStationForm({ id: null, name: "", roleName: "", roleId: null });
    setStationUsers([]);
    setStationOpen(true);
  };
  const openEditStation = (s: any) => {
    setStationForm({ id: s.id, name: s.name, roleName: s.roleName ?? "", roleId: s.roleId ?? null });
    setStationOpen(true);
    if (s.id && s.roleId) {
      api
        .get(`/restaurant/stations/${s.id}/users`)
        .then((r) => setStationUsers(Array.isArray(r.data) ? r.data : []))
        .catch(() => setStationUsers([]));
    } else {
      setStationUsers([]);
    }
  };
  const loadStationUsers = async (id: number) => {
    try {
      const r = await api.get(`/restaurant/stations/${id}/users`);
      setStationUsers(Array.isArray(r.data) ? r.data : []);
    } catch {
      setStationUsers([]);
    }
  };
  const toggleStationUser = async (u: any) => {
    if (!stationForm.id || !stationForm.roleId) return;
    setError("");
    try {
      await api.put(`/restaurant/stations/${stationForm.id}/assign`, {
        userId: u.userId,
        assign: !u.assigned,
      });
      await loadStationUsers(stationForm.id);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedUpdateUser"));
    }
  };
  const saveStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationForm.name.trim()) return;
    setError("");
    try {
      const payload = {
        name: stationForm.name.trim(),
        roleName: stationForm.roleName.trim() || undefined,
      };
      if (stationForm.id) await api.patch(`/restaurant/stations/${stationForm.id}`, payload);
      else await api.post("/restaurant/stations", payload);
      setStationOpen(false);
      await loadStations();
      window.dispatchEvent(new Event("stations:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedSaveStation"));
    }
  };
  const deleteStation = async (s: any) => {
    if (!(await confirm(t("menu.removeStationConfirm", { name: s.name })))) return;
    setError("");
    try {
      await api.delete(`/restaurant/stations/${s.id}`);
      await loadStations();
      await load();
      window.dispatchEvent(new Event("stations:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedRemoveStation"));
    }
  };

  const seedDefaults = async () => {
    if (!(await confirm(t("menu.seedDefaultsConfirm")))) return;
    setError("");
    try {
      await api.post("/restaurant/menu-categories/defaults");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedSeedDefaults"));
    }
  };

  const deleteCategory = async (c: any) => {
    if (!(await confirm(t("menu.deleteCategoryConfirm", { name: c.name })))) return;
    try {
      await api.delete(`/restaurant/menu-categories/${c.id}`);
      if (selectedId === c.id) setSelectedId(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedDeleteCategory"));
    }
  };

  const openNewItem = () => {
    setItemForm({ id: null, categoryId: selected?.id ?? null, name: "", description: "", price: "", cost: "", trackingMode: "SIMPLE", estimatedCogs: "", useCategoryRoute: true, route: [] });
    setRecipeLines([]);
    setProductSearch("");
    setItemOpen(true);
  };
  const openEditItem = (it: any) => {
    const itemRoute: any[] = Array.isArray(it.stationRoute) && it.stationRoute.length ? it.stationRoute : [];
    const mode = it.trackingMode ?? "SIMPLE";
    setItemForm({
      id: it.id,
      categoryId: it.menuCategoryId ?? selected?.id ?? null,
      name: it.name,
      description: it.description ?? "",
      price: String(it.price),
      cost: String(it.cost ?? ""),
      trackingMode: mode,
      estimatedCogs: String(it.estimatedCogs ?? ""),
      durationMins: it.durationMins != null ? String(it.durationMins) : "",
      useCategoryRoute: itemRoute.length === 0,
      route: itemRoute.map((r) => r.id),
    });
    setRecipeLines([]);
    setProductSearch("");
    setItemOpen(true);
    // Fresh recipe + ingredient picker options — only Perpetual items use a
    // recipe; SIMPLE/BENCHMARK items skip the recipe fetch entirely.
    if (mode === "PERPETUAL") {
      api
        .get(`/restaurant/menu-items/${it.id}/recipe`)
        .then((r) =>
          setRecipeLines(
            (r.data?.ingredients ?? []).map((ing: any) => ({
              productId: ing.productId,
              name: ing.name,
              unit: ing.unit ?? null,
              quantityPerUnit: String(ing.quantityPerUnit ?? ""),
              currentBuyPrice: ing.currentBuyPrice ?? 0,
            })),
          ),
        )
        .catch(() => setRecipeLines([]));
    }
    api
      .get("/products")
      .then((r) => setProductOptions(r.data ?? []))
      .catch(() => setProductOptions([]));
  };
  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const categoryId = itemForm.categoryId ?? selected?.id;
    if (!categoryId) return setError(t("menu.pleaseSelectCategory"));
    const payload: any = {
      menuCategoryId: Number(categoryId),
      name: itemForm.name,
      description: itemForm.description || undefined,
      price: Number(itemForm.price),
      trackingMode: itemForm.trackingMode || "SIMPLE",
    };
    if (itemForm.trackingMode === "BENCHMARK") {
      if (!(Number(itemForm.estimatedCogs) > 0)) {
        return setError(t("menu.benchmarkCostError"));
      }
      payload.estimatedCogs = Number(itemForm.estimatedCogs);
    }
    if (itemForm.trackingMode === "PERPETUAL") {
      // Manual fallback cost only applies to Perpetual items (until a recipe
      // is defined); SIMPLE/BENCHMARK costs are derived by the backend.
      payload.cost = itemForm.cost ? Number(itemForm.cost) : undefined;
    }
    // Spa/wellness treatment duration (optional; minutes).
    if (itemForm.durationMins !== "" && itemForm.durationMins != null) {
      payload.durationMins = Number(itemForm.durationMins);
    }
    if (itemForm.useCategoryRoute) {
      // Follow the category's route. On an existing item an empty array tells
      // the backend to clear any stored override (back to inheriting).
      if (itemForm.id) payload.stationRoute = [];
    } else {
      payload.stationRoute = itemForm.route;
    }
    try {
      const res = itemForm.id
        ? await api.patch(`/restaurant/menu-items/${itemForm.id}`, payload)
        : await api.post("/restaurant/menu-items", payload);
      const itemId = itemForm.id ?? res.data?.id;
      if (itemId) {
        if (itemForm.trackingMode === "PERPETUAL") {
          // Save the recipe (bulk replace — an empty array clears it so the
          // manual cost fallback takes over).
          await api.put(`/restaurant/menu-items/${itemId}/recipe`, {
            ingredients: recipeLines.map((l) => ({
              productId: l.productId,
              quantityPerUnit: Number(l.quantityPerUnit || 0),
            })),
          });
        } else {
          // Recipes are Perpetual-only: clear any legacy recipe rows when the
          // item is switched to SIMPLE or BENCHMARK.
          await api.put(`/restaurant/menu-items/${itemId}/recipe`, {
            ingredients: [],
          }).catch(() => undefined);
        }
      }
      setItemOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedSaveItem"));
    }
  };
  // --- Recipe (ingredient costing) handlers ---
  const recipeCost = recipeLines.reduce(
    (s, l) => s + (Number(l.quantityPerUnit) || 0) * (l.currentBuyPrice || 0),
    0,
  );
  const addIngredient = (p: any) => {
    if (recipeLines.some((l) => l.productId === p.id)) return;
    setRecipeLines([
      ...recipeLines,
      {
        productId: p.id,
        name: `${p.brand ?? ""} ${p.baseName ?? ""}`.trim() || `Product #${p.id}`,
        unit: p.unit?.name ?? null,
        quantityPerUnit: "",
        currentBuyPrice: p.currentBuyPrice ?? 0,
      },
    ]);
  };
  const updateIngredientQty = (idx: number, qty: string) => {
    setRecipeLines(
      recipeLines.map((l, i) => (i === idx ? { ...l, quantityPerUnit: qty } : l)),
    );
  };
  const removeIngredient = (idx: number) => {
    setRecipeLines(recipeLines.filter((_, i) => i !== idx));
  };
  const filteredProducts = productOptions.filter(
    (p) =>
      !recipeLines.some((l) => l.productId === p.id) &&
      (productSearch.trim() === "" ||
        `${p.brand ?? ""} ${p.baseName ?? ""}`
          .toLowerCase()
          .includes(productSearch.toLowerCase()) ||
        (p.category?.name ?? "").toLowerCase().includes(productSearch.toLowerCase())),
  );

  // --- Create Ingredient shortcut ---
  const openNewIngredient = () => {
    setIngError("");
    setIngForm({
      brand: "Ingredient",
      baseName: "",
      buyPrice: "",
      quantity: "0",
      unitId: "",
      categoryId: "",
    });
    setIngOpen(true);
    Promise.all([
      api.get("/categories").catch(() => ({ data: [] })),
      api.get("/units").catch(() => ({ data: [] })),
    ]).then(([c, u]) => {
      const cats = c.data ?? [];
      setIngredientCategories(cats);
      setUnits(u.data ?? []);
      // Default to the org's "Ingredients" category when available.
      const ingCat = cats.find(
        (x: any) => (x.name ?? "").toLowerCase() === "ingredients",
      );
      setIngForm((f) => ({
        ...f,
        categoryId: ingCat ? String(ingCat.id) : cats[0] ? String(cats[0].id) : "",
      }));
    });
  };
  const addUnit = async () => {
    const name = newUnitName.trim();
    if (!name) return;
    setIngError("");
    try {
      const res = await api.post("/units", { name });
      const created = res.data;
      setUnits((prev) => (prev.some((u: any) => u.id === created.id) ? prev : [...prev, created]));
      setIngForm((f) => ({ ...f, unitId: String(created.id) }));
      setNewUnitName("");
      setNewUnitOpen(false);
    } catch (err: any) {
      setIngError(err?.response?.data?.message ?? t("menu.failedCreateUnit"));
    }
  };

  const saveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngError("");
    if (!ingForm.baseName.trim()) return setIngError(t("menu.ingNameRequiredError"));
    if (!ingForm.unitId) return setIngError(t("menu.unitRequiredError"));
    const buyPrice = Number(ingForm.buyPrice);
    if (!(buyPrice > 0)) return setIngError(t("menu.buyPriceRequiredError"));
    setIngSaving(true);
    try {
      const res = await api.post("/products", {
        brand: ingForm.brand.trim() || "Ingredient",
        baseName: ingForm.baseName.trim(),
        currentBuyPrice: buyPrice,
        currentSellPrice: buyPrice, // ingredients are consumed, not sold
        categoryId: Number(ingForm.categoryId),
        unitId: Number(ingForm.unitId),
        kind: "INGREDIENT",
        quantity: Math.max(0, Number(ingForm.quantity) || 0),
      });
      const created = res.data;
      // Refresh the picker and auto-add the new ingredient to the recipe.
      const opts = await api.get("/products").catch(() => ({ data: [] }));
      setProductOptions(opts.data ?? []);
      if (created?.id) {
        setRecipeLines((prev) => [
          ...prev,
          {
            productId: created.id,
            name: `${created.brand ?? ""} ${created.baseName ?? ""}`.trim() || `Product #${created.id}`,
            unit: units.find((u: any) => u.id === Number(ingForm.unitId))?.name ?? null,
            quantityPerUnit: "",
            currentBuyPrice: created.currentBuyPrice ?? buyPrice,
          },
        ]);
      }
      setIngOpen(false);
    } catch (err: any) {
      setIngError(
        err?.response?.data?.message ?? t("menu.failedCreateIngredient"),
      );
    } finally {
      setIngSaving(false);
    }
  };

  const deleteItem = async (it: any) => {
    if (!(await confirm(t("menu.deleteItemConfirm", { name: it.name })))) return;
    try {
      await api.delete(`/restaurant/menu-items/${it.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedDeleteItem"));
    }
  };
  const toggleItem = async (it: any) => {
    try {
      await api.patch(`/restaurant/menu-items/${it.id}/availability`, { isAvailable: !it.isAvailable });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedUpdateItem"));
    }
  };

  const openNewOption = (it: any) => {
    setOptTarget(it);
    setOptForm({ id: null, name: "", extraPrice: "" });
    setOptOpen(true);
  };
  const openEditOption = (it: any, o: any) => {
    setOptTarget(it);
    setOptForm({ id: o.id, name: o.name, extraPrice: String(o.extraPrice ?? 0) });
    setOptOpen(true);
  };
  const saveOption = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload = { name: optForm.name, extraPrice: Number(optForm.extraPrice || 0) };
      if (optForm.id) await api.patch(`/restaurant/menu-item-options/${optForm.id}`, payload);
      else await api.post(`/restaurant/menu-items/${optTarget.id}/options`, payload);
      setOptOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedSaveOption"));
    }
  };
  const deleteOption = async (o: any) => {
    if (!(await confirm(t("menu.deleteOptionConfirm", { name: o.name })))) return;
    try {
      await api.delete(`/restaurant/menu-item-options/${o.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("menu.failedDeleteOption"));
    }
  };

  if (loading) return <p className="text-gray-500 p-6">{t("menu.loading")}</p>;

  if (!canManage) {
    return <p className="p-6 text-gray-500">{t("menu.noPermission")}</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("menu.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Stations management (owner-managed) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold text-gray-800">{t("menu.stations")}</h2>
          <button onClick={openNewStation} className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium shrink-0">
            {t("menu.addStation")}
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {t("menu.stationHint")}
        </p>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {stations.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{s.name}</p>
                {s.roleName && (
                  <p className="text-[11px] text-gray-400 truncate">{t("menu.notifies")} {s.roleName}</p>
                )}
              </div>
              <button
                onClick={() => openEditStation(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 shrink-0"
              >
                {t("common.edit")}
              </button>
              <button
                onClick={() => deleteStation(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 shrink-0"
              >
                {t("common.del")}
              </button>
            </li>
          ))}
          {stations.length === 0 && (
            <li className="px-3 py-4 text-sm text-gray-400">{t("menu.noStations")}</li>
          )}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <h2 className="font-semibold text-gray-800">{t("menu.categories")}</h2>
            <button onClick={openNewCategory} className="bg-gray-800 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-gray-900 shrink-0">
              {t("menu.addCategory")}
            </button>
          </div>
          <ul className="space-y-1">
            {categories.map((c) => (
              <li key={c.id}>
                <div
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                    selected?.id === c.id ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <button className="flex-1 text-left min-w-0" onClick={() => setSelectedId(c.id)}>
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{stationRouteLabel(c)}</span>
                  </button>
                  <button onClick={() => openEditCategory(c)} className="text-xs text-blue-600 hover:underline mr-1 shrink-0">
                    {t("common.edit")}
                  </button>
                  <button onClick={() => deleteCategory(c)} className="text-xs text-red-600 hover:underline shrink-0">
                    {t("common.del")}
                  </button>
                </div>
              </li>
            ))}
            {categories.length === 0 && <li className="text-gray-400 text-sm p-2">{t("menu.noCategories")}</li>}
          </ul>
          <div className="mt-2 px-1">
            <button onClick={seedDefaults} className="w-full bg-green-50 text-green-700 border border-green-200 rounded px-3 py-1.5 text-xs font-medium hover:bg-green-100">
              {t("menu.addDefaults")}
            </button>
          </div>
        </div>

        <div className="md:col-span-2 bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="font-semibold text-gray-800">{selected?.name ?? t("menu.itemsTitle")}</h2>
            {selected && (
              <button onClick={openNewItem} className="text-sm text-blue-600 hover:underline">
                {t("menu.addItem")}
              </button>
            )}
          </div>
          {selected && (
            <input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={t("menu.searchItems")}
              className="border border-gray-300 rounded p-2 text-sm w-full mb-2"
            />
          )}
          {selected ? (
            <ul className="space-y-2">
              {selected.items
                ?.filter((it: any) => it.name.toLowerCase().includes(itemSearch.toLowerCase()))
                .map((it: any) => (
                <li key={it.id} className="border border-gray-100 rounded p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {it.name}
                        {!it.isAvailable && <span className="ml-2 text-xs text-amber-600">{t("menu.unavailable")}</span>}
                      </p>
                      <p className="text-xs text-gray-400">
                        {Number(it.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {it.durationMins ? ` · ⏱ ${it.durationMins} min` : ""}
                        {it.description ? ` · ${it.description}` : ""}
                      </p>
                      <p className="text-[11px] truncate mt-0.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1.5 ${it.hasRecipe ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {it.hasRecipe ? t("menu.recipeCost") : t("menu.manualCost")} {Number(it.effectiveCost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB
                        </span>
                        {itemRouteLabel(it) ? (
                          <span className="text-blue-600">{t("menu.route")} {itemRouteLabel(it)}</span>
                        ) : (
                          <span className="text-gray-300">{t("menu.followsCategory")}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-xs">
                      <button onClick={() => toggleItem(it)} className="text-gray-500 hover:underline">
                        {it.isAvailable ? t("menu.hide") : t("menu.show")}
                      </button>
                      <button onClick={() => openNewOption(it)} className="text-blue-600 hover:underline">
                        {t("menu.addOption")}
                      </button>
                      <button onClick={() => openEditItem(it)} className="text-blue-600 hover:underline">
                        {t("common.edit")}
                      </button>
                      <button onClick={() => deleteItem(it)} className="text-red-600 hover:underline">
                        {t("common.del")}
                      </button>
                    </div>
                  </div>
                  {it.options?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {it.options.map((o: any) => (
                        <span key={o.id} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">
                          {o.name}
                          {o.extraPrice ? ` (+${o.extraPrice})` : ""}
                          <button onClick={() => openEditOption(it, o)} className="text-blue-600">✎</button>
                          <button onClick={() => deleteOption(o)} className="text-red-600">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              {(!selected.items || selected.items.length === 0) && <li className="text-gray-400 text-sm p-2">{t("menu.noItems")}</li>}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm p-2">{t("menu.selectCategory")}</p>
          )}
        </div>
      </div>

      {catOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{catForm.id ? t("menu.editCategory") : t("menu.newCategory")}</h2>
            <form onSubmit={saveCategory} className="space-y-3">
              <input
                value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                placeholder={t("menu.categoryName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("menu.stationRoute")} <span className="text-gray-400">{t("menu.ordered")}</span>
                </label>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                  {catForm.route.map((id, idx) => {
                    const st = stationById(id);
                    return (
                      <div key={id} className="flex items-center gap-1.5 px-2 py-2 bg-blue-50/50">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">
                          {st?.name ?? `#${id}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => moveRouteStation(idx, -1)}
                          disabled={idx === 0}
                          className="w-9 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 active:bg-gray-100 disabled:opacity-30 text-base shrink-0"
                          title={t("menu.moveEarlier")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRouteStation(idx, 1)}
                          disabled={idx === catForm.route.length - 1}
                          className="w-9 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 active:bg-gray-100 disabled:opacity-30 text-base shrink-0"
                          title={t("menu.moveLater")}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStationFromRoute(id)}
                          className="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 text-lg shrink-0"
                          title={t("menu.removeFromRoute")}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {catForm.route.length === 0 && (
                    <p className="px-3 py-3 text-xs text-gray-400">
                      {t("menu.noRouteStations")}
                    </p>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-1">{t("menu.availableStations")}</p>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {stations
                    .filter((s) => !catForm.route.includes(s.id))
                    .map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => addStationToRoute(s.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                      >
                        <span className="min-w-0 truncate font-medium">{s.name}</span>
                        <span className="text-xs font-semibold text-blue-600 shrink-0">{t("menu.addRouteStation")}</span>
                      </button>
                    ))}
                  {stations.filter((s) => !catForm.route.includes(s.id)).length === 0 && (
                    <p className="px-3 py-2.5 text-xs text-gray-400">{t("menu.allInRoute")}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCatOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stationOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-3">
              {stationForm.id ? t("menu.editStation") : t("menu.newStation")}
            </h2>
            <form onSubmit={saveStation} className="space-y-3">
              <input
                value={stationForm.name}
                onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                placeholder={t("menu.stationName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div>
                <input
                  value={stationForm.roleName}
                  onChange={(e) => setStationForm({ ...stationForm, roleName: e.target.value })}
                  placeholder={t("menu.roleName")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {t("menu.roleHint")}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStationOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>

            {stationForm.id && stationForm.roleId && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-gray-800">{t("menu.stationTeam")}</p>
                  <span className="text-[11px] text-gray-400">{t("menu.role")} {stationForm.roleName || "—"}</span>
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  {t("menu.stationTeamHint")}
                </p>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-44 overflow-y-auto">
                  {stationUsers.map((u) => (
                    <li key={u.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate text-sm text-gray-700">
                        {u.name}{" "}
                        <span className="text-xs text-gray-400">({u.email})</span>
                      </span>
                      <button
                        type="button"
                        disabled={u.isSystem}
                        onClick={() => toggleStationUser(u)}
                        title={u.isSystem ? t("menu.ownerRoleLocked") : undefined}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          u.assigned
                            ? "bg-red-50 text-red-600 hover:bg-red-100"
                            : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                        }`}
                      >
                        {u.isSystem ? t("menu.ownerRole") : u.assigned ? t("menu.remove") : t("menu.assign")}
                      </button>
                    </li>
                  ))}
                  {stationUsers.length === 0 && (
                    <li className="px-3 py-3 text-xs text-gray-400">{t("menu.noStaff")}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {itemOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-3">{itemForm.id ? t("menu.editItem") : t("menu.newItem")}</h2>
            <form onSubmit={saveItem} className="space-y-3">
              <div className="flex gap-2 items-end">
                <select
                  value={itemForm.categoryId ?? ""}
                  onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value ? Number(e.target.value) : null })}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                >
                  <option value="">{t("menu.selectCategoryItem")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({stationRouteLabel(c)})</option>
                  ))}
                </select>
                <button type="button" onClick={() => setCatOpen(true)} className="text-xs text-blue-600 hover:underline shrink-0 pb-2">
                  + New
                </button>
              </div>
              <input
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                placeholder={t("menu.itemName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                placeholder={t("menu.descriptionOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />

              {/* Tracking strategy */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {t("menu.trackingStrategy")}
                </label>
                <select
                  value={itemForm.trackingMode}
                  onChange={(e) => {
                    const trackingMode = e.target.value;
                    setItemForm({ ...itemForm, trackingMode });
                    if (trackingMode !== "PERPETUAL") setRecipeLines([]);
                  }}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="SIMPLE">{t("menu.trackingSimple")}</option>
                  <option value="BENCHMARK">{t("menu.trackingBenchmark")}</option>
                  <option value="PERPETUAL">{t("menu.trackingPerpetual")}</option>
                </select>
              </div>

              {itemForm.trackingMode === "SIMPLE" && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-700 space-y-1">
                  <p className="font-semibold">{t("menu.simpleHintTitle")}</p>
                  <p>
                    {t("menu.simpleHint")}
                  </p>
                </div>
              )}

              <input
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                placeholder={t("menu.price")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />

              {/* Optional treatment duration — spa / wellness service items. */}
              <input
                type="number"
                min="0"
                value={itemForm.durationMins}
                onChange={(e) => setItemForm({ ...itemForm, durationMins: e.target.value })}
                placeholder="Duration in minutes (spa/wellness, optional)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />

              {itemForm.trackingMode === "BENCHMARK" && (
                <div className="space-y-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.estimatedCogs}
                    onChange={(e) => setItemForm({ ...itemForm, estimatedCogs: e.target.value })}
                    placeholder={t("menu.costPerPortion")}
                    className="border border-gray-300 rounded p-2 text-sm w-full"
                    required
                  />
                  {Number(itemForm.estimatedCogs) > 0 && (
                    <p className="text-[11px] text-gray-500">
                      {t("menu.estimatedMargin")}{" "}
                      <span className="font-semibold text-emerald-600">
                        {(Number(itemForm.price) - Number(itemForm.estimatedCogs)).toFixed(2)} ETB
                      </span>{" "}
                      {t("menu.perPortion")} (
                      {Number(itemForm.price) > 0
                        ? (((Number(itemForm.price) - Number(itemForm.estimatedCogs)) / Number(itemForm.price)) * 100).toFixed(0)
                        : 0}
                      %)
                    </p>
                  )}
                </div>
              )}

              {itemForm.trackingMode === "PERPETUAL" && (
                <input
                  type="number"
                  step="0.01"
                  value={itemForm.cost}
                  onChange={(e) => setItemForm({ ...itemForm, cost: e.target.value })}
                  placeholder={t("menu.fallbackCost")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              )}

              {/* Recipe (ingredient costing) — Perpetual tracking only */}
              {itemForm.trackingMode === "PERPETUAL" && (
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <p className="text-sm font-semibold text-gray-800">{t("menu.recipeTitle")}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {recipeLines.length > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {t("menu.autoCost")} {recipeCost.toFixed(2)} ETB
                      </span>
                    )}
                    {hasPermission("products.create") && (
                      <button
                        type="button"
                        onClick={openNewIngredient}
                        className="text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full"
                        title={t("menu.newIngredientTitle")}
                      >
                        {t("menu.newIngredient")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-2">
                  {t("menu.recipeHint")}
                </p>

                {/* Recipe lines */}
                {recipeLines.length > 0 && (
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                    {recipeLines.map((l, idx) => (
                      <div key={l.productId} className="flex items-center gap-1.5 px-2 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{l.name}</p>
                          <p className="text-[10px] text-gray-400">
                            {l.currentBuyPrice.toFixed(2)} ETB{l.unit ? ` / ${l.unit}` : ""} · {t("menu.line")} {((Number(l.quantityPerUnit) || 0) * l.currentBuyPrice).toFixed(2)} ETB
                          </p>
                        </div>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={l.quantityPerUnit}
                          onChange={(e) => updateIngredientQty(idx, e.target.value)}
                          placeholder={t("menu.qtyPerUnit")}
                          className="w-20 border border-gray-300 rounded p-1 text-xs text-right"
                        />
                        <button
                          type="button"
                          onClick={() => removeIngredient(idx)}
                          className="w-7 h-7 rounded text-red-500 hover:bg-red-50 text-sm shrink-0"
                          title={t("menu.removeIngredient")}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Ingredient picker */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder={t("menu.searchIngredients")}
                    className="w-full px-3 py-2 text-sm border-b border-gray-100 outline-none"
                  />
                  <div className="max-h-32 overflow-y-auto divide-y divide-gray-50">
                    {filteredProducts.slice(0, 12).map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => addIngredient(p)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {p.brand} {p.baseName}
                        </span>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {p.category?.name ? `${p.category.name} · ` : ""}
                          {p.currentBuyPrice} ETB{p.unit?.name ? `/${p.unit.name}` : ""}
                        </span>
                      </button>
                    ))}
                    {filteredProducts.length === 0 && (
                      <p className="px-3 py-2.5 text-xs text-gray-400">
                        {productOptions.length === 0
                          ? t("menu.noIngredients")
                          : t("menu.noMatchingIngredients")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              )}

              <div className="border-t border-gray-100 pt-3">
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={itemForm.useCategoryRoute}
                    onChange={(e) => setItemForm({ ...itemForm, useCategoryRoute: e.target.checked })}
                    className="rounded mt-0.5"
                  />
                  <span>
                    {t("menu.followCategoryRoute")}
                    <span className="block text-xs text-gray-400">
                      {stationRouteLabel(categories.find((c) => c.id === itemForm.categoryId))}
                    </span>
                  </span>
                </label>

                {!itemForm.useCategoryRoute && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-gray-600 mb-1">
                      {t("menu.stationRoute")} <span className="text-gray-400">{t("menu.ordered")}</span>
                    </p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                      {itemForm.route.map((id: number, idx: number) => {
                        const st = stationById(id);
                        return (
                          <div key={id} className="flex items-center gap-1.5 px-2 py-2 bg-blue-50/50">
                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">
                              {st?.name ?? `#${id}`}
                            </span>
                            <button
                              type="button"
                              onClick={() => moveItemStation(idx, -1)}
                              disabled={idx === 0}
                              className="w-9 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 active:bg-gray-100 disabled:opacity-30 text-base shrink-0"
                              title={t("menu.moveEarlier")}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveItemStation(idx, 1)}
                              disabled={idx === itemForm.route.length - 1}
                              className="w-9 h-9 rounded-lg bg-white border border-gray-200 text-gray-600 active:bg-gray-100 disabled:opacity-30 text-base shrink-0"
                              title={t("menu.moveLater")}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItemStation(id)}
                              className="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 text-lg shrink-0"
                              title={t("menu.removeFromRoute")}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                      {itemForm.route.length === 0 && (
                        <p className="px-3 py-3 text-xs text-gray-400">
                          {t("menu.noItemRouteStations")}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-1">{t("menu.availableStations")}</p>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {stations
                        .filter((s) => !itemForm.route.includes(s.id))
                        .map((s) => (
                          <button
                            type="button"
                            key={s.id}
                            onClick={() => addItemStation(s.id)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                          >
                            <span className="min-w-0 truncate font-medium">{s.name}</span>
                            <span className="text-xs font-semibold text-blue-600 shrink-0">{t("menu.addRouteStation")}</span>
                          </button>
                        ))}
                      {stations.filter((s) => !itemForm.route.includes(s.id)).length === 0 && (
                        <p className="px-3 py-2.5 text-xs text-gray-400">{t("menu.allInRoute")}</p>
                      )}
                    </div>
                    {itemForm.route.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        {t("menu.itemNoRouteHint")}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setItemOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {optOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">
              {optForm.id ? t("menu.editOption") : t("menu.newOption")} — {optTarget?.name}
            </h2>
            <form onSubmit={saveOption} className="space-y-3">
              <input
                value={optForm.name}
                onChange={(e) => setOptForm({ ...optForm, name: e.target.value })}
                placeholder={t("menu.optionName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                type="number"
                step="0.01"
                value={optForm.extraPrice}
                onChange={(e) => setOptForm({ ...optForm, extraPrice: e.target.value })}
                placeholder={t("menu.extraPrice")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOptOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Create Ingredient shortcut modal */}
      {ingOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("menu.createIngredient")}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {t("menu.ingredientSubtitle")}
            </p>
            <form onSubmit={saveIngredient} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("menu.nameRequired")}</label>
                <input
                  value={ingForm.baseName}
                  onChange={(e) => setIngForm({ ...ingForm, baseName: e.target.value })}
                  placeholder={t("menu.ingNamePlaceholder")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  autoFocus
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("menu.buyPrice")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ingForm.buyPrice}
                    onChange={(e) => setIngForm({ ...ingForm, buyPrice: e.target.value })}
                    placeholder={t("menu.perUnit")}
                    className="border border-gray-300 rounded p-2 text-sm w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("menu.unit")}</label>
                  <div className="flex gap-1.5">
                    <select
                      value={ingForm.unitId}
                      onChange={(e) => setIngForm({ ...ingForm, unitId: e.target.value })}
                      className="flex-1 border border-gray-300 rounded p-2 text-sm bg-white"
                      required
                    >
                      <option value="">{t("menu.select")}</option>
                      {units.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setNewUnitOpen((v) => !v)}
                      className="shrink-0 px-2.5 rounded border border-gray-300 text-sm text-blue-600 hover:bg-blue-50"
                      title={t("menu.newUnit")}
                    >
                      +
                    </button>
                  </div>
                  {newUnitOpen && (
                    <div className="flex gap-1.5 mt-1.5">
                      <input
                        value={newUnitName}
                        onChange={(e) => setNewUnitName(e.target.value)}
                        placeholder={t("menu.unitNamePlaceholder")}
                        className="flex-1 border border-gray-300 rounded p-1.5 text-sm w-full"
                      />
                      <button
                        type="button"
                        onClick={addUnit}
                        className="shrink-0 px-2.5 rounded bg-gray-800 text-white text-sm"
                      >
                        {t("common.add")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("menu.ingredientCategory")}</label>
                  <select
                    value={ingForm.categoryId}
                    onChange={(e) => setIngForm({ ...ingForm, categoryId: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                    required
                  >
                    <option value="">{t("menu.select")}</option>
                    {ingredientCategories.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("menu.initialQty")}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={ingForm.quantity}
                    onChange={(e) => setIngForm({ ...ingForm, quantity: e.target.value })}
                    placeholder="0"
                    className="border border-gray-300 rounded p-2 text-sm w-full"
                  />
                </div>
              </div>
              {ingError && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{ingError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIngOpen(false)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={ingSaving}
                  className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {ingSaving ? t("menu.creating") : t("menu.createIngredient")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
