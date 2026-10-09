"use client";
// Customer CRM directory: the full record book, filtered four ways, with the
// same reusable form the till uses so a profile created here and one created
// mid-sale are identical.
import { useConfirm } from "@/app/components/ConfirmProvider";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import CustomerForm from "@/app/components/CustomerForm";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import Pagination from "@/app/components/Pagination";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import useServerPaging from "@/lib/useServerPaging";
import useDebouncedValue from "@/lib/useDebouncedValue";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type FilterKind = "all" | "debt" | "blocked" | "archived";

export default function CustomersPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = hasPermission("customers.manage");

  const [customers, setCustomers] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Debounce the term that drives the request (the input stays instant).
  const debouncedSearch = useDebouncedValue(search, 300);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const paged = useServerPaging({ pageSize: 20 });

  const fetchOverview = useCallback(() => {
    api
      .get("/customers/overview")
      .then((r) => setOverview(r.data))
      .catch(() => setOverview(null));
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (filter === "debt") params.set("onlyDebt", "true");
      // `canTakeCredit=false` asks for the blocked customers; `true` would ask
      // for the eligible ones (what the credit-sale picker does).
      if (filter === "blocked") params.set("canTakeCredit", "false");
      if (filter === "archived") params.set("archivedOnly", "true");
      params.set("page", String(paged.page));
      params.set("pageSize", String(paged.pageSize));
      const res = await api.get(`/customers?${params}`);
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setCustomers(rows);
      paged.setTotal(
        Array.isArray(body) ? rows.length : (body?.total ?? rows.length),
      );
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.loadFailed"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, paged.page, paged.pageSize]);

  // Back to page 1 whenever the filters change, then fetch.
  const filterSig = `${debouncedSearch}|${filter}`;
  const lastFilterRef = useRef(filterSig);
  useEffect(() => {
    if (lastFilterRef.current !== filterSig) {
      lastFilterRef.current = filterSig;
      if (paged.page !== 1) {
        paged.setPage(1);
        return;
      }
    }
    fetchCustomers();
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, paged.page, paged.pageSize]);

  const setArchived = async (customer: any, archived: boolean) => {
    const ok = await confirm(
      archived ? t("crm.archiveConfirm") : t("crm.restoreConfirm"),
    );
    if (!ok) return;
    try {
      await api.put(`/customers/${customer.publicId ?? customer.id}/archived`, {
        archived,
      });
      toast.success(archived ? t("crm.archivedDone") : t("crm.restoredDone"));
      fetchCustomers();
      fetchOverview();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.archiveFailed"));
    }
  };

  const remove = async (customer: any) => {
    const ok = await confirm(t("crm.deleteConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/customers/${customer.publicId ?? customer.id}`);
      toast.success(t("crm.customerDeleted"));
      fetchCustomers();
      fetchOverview();
    } catch (err: any) {
      markHandled(err);
      // The API explains that a customer with history must be archived.
      toast.error(err?.response?.data?.message ?? t("crm.deleteFailed"));
    }
  };

  const stats: [string, number][] = [
    ["crm.statTotal", overview?.total ?? 0],
    ["crm.statNewThisMonth", overview?.newThisMonth ?? 0],
    ["crm.statDebtors", overview?.debtors ?? 0],
    ["crm.statBlocked", overview?.creditBlocked ?? 0],
    ["crm.statFollowUps", overview?.followUpsDue ?? 0],
  ];

  return (
    <div>
      {/* HEADER */}
      <div className="flex justify-between items-start md:items-center mb-4 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            {t("crm.title")}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {t("crm.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Link
              href="/dashboard/customers/settings"
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 whitespace-nowrap"
            >
              {t("crm.programTitle")}
            </Link>
          )}
          {canManage && (
            <button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
            >
              {t("crm.addCustomer")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
        {stats.map(([key, value]) => (
          <div key={key} className="bg-white rounded-xl shadow-sm border p-3">
            <p className="text-[11px] text-gray-500">{t(key)}</p>
            <p className="text-lg font-bold text-gray-800">{value}</p>
          </div>
        ))}
      </div>

      {/* The shared Sales-style filter panel, collapsible (starts expanded).
          The All/Debt/Blocked/Archived switch is a view toggle and stays. */}
      <CollapsibleFilterPanel
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("crm.searchPlaceholder")}
        extra={
          <div className="flex gap-1 overflow-x-auto sm:mt-5">
            {(
              [
                ["all", "crm.filterAll"],
                ["debt", "crm.filterDebt"],
                ["blocked", "crm.filterBlocked"],
                ["archived", "crm.filterArchived"],
              ] as [FilterKind, string][]
            ).map(([value, key]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm whitespace-nowrap ${
                  filter === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
        }
      />

      {/* TABLE */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <Loading className="py-16" />
        ) : (
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("common.name")}</th>
                <th className="p-2 sm:p-3 md:p-4 hidden sm:table-cell">
                  {t("common.phone")}
                </th>
                <th className="p-2 sm:p-3 md:p-4 hidden md:table-cell">
                  {t("crm.lastPurchase")}
                </th>
                <th className="p-2 sm:p-3 md:p-4 text-right">
                  {t("crm.loyaltyPoints")}
                </th>
                <th className="p-2 sm:p-3 md:p-4 text-right">
                  {t("crm.balance")}
                </th>
                <th className="p-2 sm:p-3 md:p-4 text-right">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: any) => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 sm:p-3 md:p-4 font-medium">
                    <Link
                      href={`/dashboard/customers/${c.publicId ?? c.id}`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1 mt-0.5">
                      {(c.numberLabel ??
                        formatBusinessNumber("CUST", c.number)) && (
                        <span className="text-[10px] font-normal text-gray-400">
                          {c.numberLabel ??
                            formatBusinessNumber("CUST", c.number)}
                        </span>
                      )}
                      {c.canTakeCredit === false && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                          {t("crm.creditBlocked")}
                        </span>
                      )}
                      {c.isArchived && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {t("crm.archivedBadge")}
                        </span>
                      )}
                      {(c.tags ?? []).map((tag: string) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-gray-500 hidden sm:table-cell">
                    {c.phone || "—"}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-gray-500 hidden md:table-cell">
                    {c.lastPurchaseAt
                      ? formatDate(c.lastPurchaseAt)
                      : t("crm.never")}
                  </td>
                  {/* ROW-TAIL */}
                  <td className="p-2 sm:p-3 md:p-4 text-right">
                    {c.loyaltyPoints > 0 ? (
                      <span className="text-amber-700 font-medium">
                        {c.loyaltyPoints}
                      </span>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td
                    className={`p-2 sm:p-3 md:p-4 text-right font-bold ${
                      c.remaining > 0 ? "text-red-500" : "text-green-600"
                    }`}
                  >
                    {fmtCurrency(c.remaining)}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4">
                    <RowActionsMenu
                      items={[
                        {
                          label: t("crm.viewProfile"),
                          onClick: () =>
                            router.push(
                              `/dashboard/customers/${c.publicId ?? c.id}`,
                            ),
                        },
                        ...(canManage
                          ? [
                              {
                                label: t("common.edit"),
                                onClick: () => {
                                  setEditing(c);
                                  setShowForm(true);
                                },
                              },
                              {
                                label: c.isArchived
                                  ? t("crm.restore")
                                  : t("crm.archive"),
                                onClick: () => setArchived(c, !c.isArchived),
                              },
                              {
                                label: t("common.delete"),
                                color: "text-red-500",
                                onClick: () => remove(c),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-6 text-center text-gray-400 text-sm"
                  >
                    {t("crm.noCustomers")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          total={paged.total}
          rangeStart={paged.rangeStart}
          rangeEnd={paged.rangeEnd}
          onPrev={paged.prev}
          onNext={paged.next}
          onPage={paged.setPage}
          onPageSizeChange={paged.setPageSize}
          pageSize={paged.pageSize}
        />
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("crm.editCustomer") : t("crm.addCustomer")}
      >
        <CustomerForm
          initialData={editing}
          showSections
          onCreated={() => {
            setShowForm(false);
            toast.success(t("crm.customerSaved"));
            fetchCustomers();
            fetchOverview();
          }}
          onUpdated={() => {
            setShowForm(false);
            setEditing(null);
            toast.success(t("crm.customerSaved"));
            fetchCustomers();
            fetchOverview();
          }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}
