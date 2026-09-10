"use client";
import { getDateRange } from "@/app/components/DateFilter";
import FilterBar from "@/app/components/FilterBar";
import FilterPanel from "@/app/components/FilterPanel";
import SalesReport from "@/app/components/SalesReport";
import HospitalityDashboard from "@/app/components/HospitalityDashboard";
import ManufacturingDashboard from "@/app/components/ManufacturingDashboard";
import Loading from "@/app/components/Loading";
import { useAuth } from "@/context/AuthContext";
import { variantLabel } from "@/lib/variantLabel";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

type DatePreset = "today" | "week" | "month" | "year";

export default function DashboardPage() {
  const { user, activeMembership } = useAuth();
  const router = useRouter();

  // Every business type lands on the Dashboard home. Only the platform admin
  // is sent to the Admin screen.
  useEffect(() => {
    if (user?.isPlatformAdmin) router.replace("/dashboard/admin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isPlatformAdmin, router]);

  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(() => getDateRange("today").start);
  const [endDate, setEndDate] = useState(() => getDateRange("today").end);

  // data
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isOwner = user?.isSuperuser === true;

  // Hospitality tenants get the hospitality dashboard (no retail inventory).
  const isHospitality =
    (activeMembership?.businessType ?? user?.businessType) === "HOSPITALITY";
  const isManufacturing =
    (activeMembership?.businessType ?? user?.businessType) === "MANUFACTURING";

  // Group my-inventory rows by base product so each product appears once (its
  // variants repeat the base name otherwise). Expand a row to see the
  // per-variant stock breakdown.
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(
    new Set(),
  );
  const groupedInventory = useMemo(() => {
    const map = new Map<number, any>();
    for (const inv of inventory) {
      if (!map.has(inv.productId)) {
        map.set(inv.productId, {
          productId: inv.productId,
          productName: inv.productName,
          sku: inv.sku,
          total: 0,
          hasVariants: false,
          variants: [] as any[],
        });
      }
      const g = map.get(inv.productId)!;
      g.total += inv.quantity;
      if (inv.variantId != null) {
        g.hasVariants = true;
        g.variants.push(inv);
      }
    }
    return Array.from(map.values());
  }, [inventory]);

  const toggleProduct = (productId: number) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  useEffect(() => {
    api.get("/categories").then((r) => setCategories(r.data));
    if (isOwner) api.get("/locations").then((r) => setLocations(r.data));
  }, [isOwner]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    if (isHospitality) {
      setLoading(false);
    } else if (isOwner) {
      setLoading(false);
    } else {
      api
        .get(
          `/products/my-inventory?categoryId=${categoryFilter}&search=${search}`,
        )
        .then((r) => {
          setInventory(r.data || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [user, categoryFilter, search, isOwner, isHospitality]);

  if (loading) return <Loading className="py-24" />;

  if (user?.isPlatformAdmin) {
    return <div className="p-8 text-gray-400">Redirecting…</div>;
  }

  // --- HOSPITALITY DASHBOARD (owner + staff) ---
  if (isHospitality) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            Dashboard
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            Welcome back, {isOwner ? "Owner" : user?.roleName}.
          </p>
        </div>
        <HospitalityDashboard />
      </div>
    );
  }

  // --- MANUFACTURING DASHBOARD (owner + staff) ---
  if (isManufacturing) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            Dashboard
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            Welcome back, {isOwner ? "Owner" : user?.roleName}.
          </p>
        </div>
        <ManufacturingDashboard />
      </div>
    );
  }

  // --- SCOPED (shop/store) VIEW ---
  if (!isOwner) {
    return (
      <div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
              Dashboard
            </h1>
            <p className="text-gray-500 text-xs sm:text-sm mt-1">
              Welcome back, <span className="font-semibold">{user?.roleName}</span>.
            </p>
          </div>
        </div>
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          category={categoryFilter}
          onCategoryChange={setCategoryFilter}
          categories={categories}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 mt-6 gap-6">
          {/* Inventory table */}
          <div
            className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col"
            style={{ height: "calc(100vh - 13rem)" }}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0">
              <h3 className="text-gray-700 text-base sm:text-lg font-semibold">
                {user?.locationType === "SHOP"
                  ? "Your Shop Inventory"
                  : "Your Store Inventory"}
              </h3>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="p-2 sm:p-3 pl-4 sm:pl-6">Product</th>
                    <th className="p-2 sm:p-3 text-center w-20 sm:w-24">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedInventory.map((g: any) => {
                    const expanded = expandedProducts.has(g.productId);
                    return (
                      <Fragment key={g.productId}>
                        <tr
                          className={
                            "border-b hover:bg-gray-50" +
                            (g.hasVariants ? " cursor-pointer" : "")
                          }
                          onClick={() => g.hasVariants && toggleProduct(g.productId)}
                        >
                          <td className="p-2 sm:p-3 pl-4 sm:pl-6 font-medium text-gray-800">
                            {g.hasVariants && (
                              <span className="mr-1 text-gray-400">
                                {expanded ? "▾" : "▸"}
                              </span>
                            )}
                            {g.productName}
                          </td>
                          <td
                            className={`p-2 sm:p-3 text-center font-bold text-xs sm:text-sm ${g.total < 10 ? "text-red-500" : "text-blue-600"}`}
                          >
                            {g.total}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-gray-50">
                            <td colSpan={2} className="p-2 pl-8 sm:pl-12">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400">
                                    <th className="text-left p-1 font-medium">
                                      Variant
                                    </th>
                                    <th className="text-right p-1 font-medium">
                                      Stock
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.variants.map((v: any, idx: number) => (
                                    <tr key={idx} className="border-t border-gray-200">
                                      <td className="p-1">
                                        {variantLabel({
                                          attributes: v.variantAttributes,
                                          sku: v.variantSku,
                                        }) || "Standard"}
                                      </td>
                                      <td className="p-1 text-right">
                                        {v.quantity}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {groupedInventory.length === 0 && (
                    <tr>
                      <td colSpan={2} className="p-4 sm:p-6 text-center text-gray-400">
                        No inventory yet. Request stock from your store to get
                        started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bar chart */}
          <div
            className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col"
            style={{ height: "calc(100vh - 12rem)" }}
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0">
              <h3 className="text-gray-700 text-base sm:text-lg font-semibold">
                Stock Overview
              </h3>
            </div>
            <div className="p-3 sm:p-4 overflow-auto flex-1 flex items-center justify-center">
              <div
                className="w-full"
                style={{ minHeight: `${groupedInventory.slice(0, 20).length * 32}px` }}
              >
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(250, groupedInventory.slice(0, 20).length * 32)}
                >
                  <BarChart
                    data={groupedInventory.slice(0, 20)}
                    layout="vertical"
                    margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="#f0f0f0"
                    />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis
                      type="category"
                      dataKey="productName"
                      tick={{ fontSize: 10 }}
                      width={110}
                      interval={0}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                      }}
                      cursor={{ fill: "#f9fafb" }}
                    />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={16}>
                      {groupedInventory.slice(0, 20).map((_: any, i: number) => (
                        <Cell
                          key={i}
                          fill={_.total < 10 ? "#ef4444" : "#3b82f6"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- SUPERUSER VIEW ---
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          Dashboard
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">Welcome back, Owner.</p>
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
        category={categoryFilter}
        onCategoryChange={setCategoryFilter}
        categories={categories}
        location={locationFilter}
        onLocationChange={setLocationFilter}
        locations={locations}
        showLocation
      />
      <div className="mt-6">
        <SalesReport
          startDate={startDate}
          endDate={endDate}
          categoryId={categoryFilter}
          locationId={locationFilter}
          search={search}
          compact
        />
      </div>
    </div>
  );
}
