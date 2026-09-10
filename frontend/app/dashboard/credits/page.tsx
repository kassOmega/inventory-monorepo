"use client";
import CreditSaleForm from "@/app/components/CreditSaleForm";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import CustomerForm from "@/app/components/CustomerForm";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function CreditsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isOwner = user?.isSuperuser === true;
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState(
    isOwner ? "" : String(user?.locationId || ""),
  );
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, locationFilter, setLocationFilter);
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saleCustomer, setSaleCustomer] = useState<any>(null);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const creditPaged = useServerPaging({ pageSize: 20 });

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const shopId = locationFilter || (isOwner ? "" : user?.locationId);
      const params = new URLSearchParams();
      if (shopId) params.set("shopId", String(shopId));
      if (search.trim()) params.set("search", search.trim());
      if (onlyDebt) params.set("onlyDebt", "true");
      params.set("page", String(creditPaged.page));
      params.set("pageSize", String(creditPaged.pageSize));
      const res = await api.get(`/customers?${params}`);
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setCustomers(rows);
      creditPaged.setTotal(
        Array.isArray(body) ? rows.length : (body?.total ?? rows.length),
      );
    } finally {
      setLoading(false);
    }
  };

  // Reset to page 1 whenever the filters change, then fetch the new page.
  const filterSig = `${locationFilter}|${search}|${onlyDebt}`;
  const lastFilterRef = useRef(filterSig);

  useEffect(() => {
    if (lastFilterRef.current !== filterSig) {
      lastFilterRef.current = filterSig;
      if (creditPaged.page !== 1) {
        creditPaged.setPage(1);
        return;
      }
    }
    if (isOwner)
      api
        .get("/locations")
        .then((r) =>
          setLocations(r.data.filter((l: any) => l.type === "SHOP")),
        );
    fetchCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, creditPaged.page, creditPaged.pageSize, isOwner]);

  const handleDelete = async (id: number) => {
    const ok = await confirm(t("credits.deleteCustomerConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/customers/${id}`);
      fetchCustomers();
      toast.success(t("credits.customerDeleted"));
    } catch (err: any) {
      markHandled(err);
      toast.error(t("credits.failedDeleteCustomer"));
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("credits.title")}
        </h1>
        <button
          onClick={() => setShowNewModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
        >
          {t("credits.newCustomer")}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          placeholder={t("credits.searchByName")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded-lg flex-1 text-sm"
        />
        {isOwner && (
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="border p-2 rounded-lg bg-white text-sm"
          >
            <option value="">{t("credits.allShops")}</option>
            {locations.map((l: any) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyDebt}
            onChange={(e) => setOnlyDebt(e.target.checked)}
            className="rounded"
          />{" "}
          {t("credits.onlyWithDebt")}
        </label>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4">{t("credits.name")}</th>
              <th className="p-2 sm:p-3 md:p-4 hidden sm:table-cell">{t("credits.phone")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right">{t("credits.totalCredits")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right hidden sm:table-cell">
                {t("credits.totalPaid")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-right">{t("credits.remaining")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-2 sm:p-3 md:p-4 font-medium">
                  {c.name}
                  {(c.numberLabel ??
                    formatBusinessNumber("CUST", c.number)) && (
                    <span className="block text-[10px] font-normal text-gray-400">
                      {c.numberLabel ??
                        formatBusinessNumber("CUST", c.number)}
                    </span>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-500 hidden sm:table-cell">
                  {c.phone || "—"}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right">
                  {fmtCurrency(c.totalCredits)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right text-green-600 hidden sm:table-cell">
                  {fmtCurrency(c.totalPaid)}
                </td>
                <td
                  className={`p-2 sm:p-3 md:p-4 text-right font-bold ${c.remaining > 0 ? "text-red-500" : "text-green-600"}`}
                >
                  {fmtCurrency(c.remaining)}
                </td>
                <td className="p-2 sm:p-3 md:p-4">
                  <RowActionsMenu
                    items={[
                      {
                        label: t("credits.view"),
                        onClick: () => router.push(`/dashboard/credits/${c.publicId ?? c.id}`),
                      },
                      {
                        label: t("credits.sale"),
                        color: "text-green-600",
                        onClick: () => {
                          setSaleCustomer(c);
                          setShowSaleModal(true);
                        },
                      },
                      {
                        label: t("common.edit"),
                        onClick: () => {
                          setEditingCustomer(c);
                          setShowEditModal(true);
                        },
                      },
                      {
                        label: t("common.delete"),
                        color: "text-red-500",
                        onClick: () => handleDelete(c.id),
                      },
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
                  {t("credits.noCustomers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={creditPaged.page}
          totalPages={creditPaged.totalPages}
          total={creditPaged.total}
          rangeStart={creditPaged.rangeStart}
          rangeEnd={creditPaged.rangeEnd}
          onPrev={creditPaged.prev}
          onNext={creditPaged.next}
          onPage={creditPaged.setPage}
          onPageSizeChange={creditPaged.setPageSize}
          pageSize={creditPaged.pageSize}
        />
      </div>

      <Modal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        title={t("credits.newCustomerTitle")}
      >
        <CustomerForm
          onCreated={() => {
            setShowNewModal(false);
            fetchCustomers();
          }}
          onCancel={() => setShowNewModal(false)}
        />
      </Modal>

      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingCustomer(null); }}
        title={t("credits.editCustomerTitle")}
      >
        <CustomerForm
          initialData={editingCustomer}
          onCreated={() => {}}
          onUpdated={() => {
            setShowEditModal(false);
            setEditingCustomer(null);
            fetchCustomers();
          }}
          onCancel={() => { setShowEditModal(false); setEditingCustomer(null); }}
        />
      </Modal>

      <Modal
        isOpen={showSaleModal}
        onClose={() => { setShowSaleModal(false); setSaleCustomer(null); }}
        title={t("credits.addCreditSale")}
      >
        {saleCustomer && (
          <CreditSaleForm
            customerId={saleCustomer.id}
            customerName={saleCustomer.name}
            onCreated={() => { setShowSaleModal(false); setSaleCustomer(null); fetchCustomers(); }}
            onCancel={() => { setShowSaleModal(false); setSaleCustomer(null); }}
          />
        )}
      </Modal>
    </div>
  );
}
