"use client";
import PurchaseForm from "@/app/components/PurchaseForm";
import SaleForm from "@/app/components/SaleForm";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import CustomerForm from "@/app/components/CustomerForm";
import Modal from "@/app/components/Modal";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import { FilterSelect } from "@/app/components/FilterPanel";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function CreditsPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const isOwner = user?.isSuperuser === true;
  // Taking stock from a vendor and editing the ledger are different rights, so
  // the row offers the purchase entry only to someone who may record it.
  const canBuyFromVendor = hasPermission("purchases.create");
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState(
    isOwner ? "" : String(user?.locationId || ""),
  );
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, locationFilter, setLocationFilter);
  // Credit-specific status filter, mapped to the customers API params:
  //   debt    -> onlyDebt=true
  //   blocked -> canTakeCredit=false
  //   archived-> archivedOnly=true
  //   eligible-> canTakeCredit=true
  const [statusFilter, setStatusFilter] = useState<
    "all" | "debt" | "eligible" | "blocked" | "archived"
  >("all");
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saleCustomer, setSaleCustomer] = useState<any>(null);
  const [showSaleModal, setShowSaleModal] = useState(false);
  // The mirror of a credit sale: stock taken *from* this person as a vendor,
  // recorded from the ledger row that shows what is still owed to them.
  const [purchaseCustomer, setPurchaseCustomer] = useState<any>(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const creditPaged = useServerPaging({ pageSize: 20 });

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const shopId = locationFilter || (isOwner ? "" : user?.locationId);
      const params = new URLSearchParams();
      if (shopId) params.set("shopId", String(shopId));
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter === "debt") params.set("onlyDebt", "true");
      if (statusFilter === "eligible") params.set("canTakeCredit", "true");
      if (statusFilter === "blocked") params.set("canTakeCredit", "false");
      if (statusFilter === "archived") params.set("archivedOnly", "true");
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
  const filterSig = `${locationFilter}|${search}|${statusFilter}`;
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
    const ok = await confirm(t("crm.deleteConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/customers/${id}`);
      fetchCustomers();
      toast.success(t("crm.customerDeleted"));
    } catch (err: any) {
      markHandled(err);
      // A customer with history cannot be deleted: the API explains that and
      // points at archiving, so surface its message instead of a generic one.
      toast.error(
        err?.response?.data?.message ?? t("crm.deleteFailed"),
      );
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

      {/* The shared Sales-style filter panel, collapsible (starts expanded). */}
      <CollapsibleFilterPanel
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("credits.searchByName")}
        location={locationFilter}
        onLocationChange={setLocationFilter}
        locations={isOwner ? locations : undefined}
        showLocation={isOwner}
        extra={
          <FilterSelect
            label={t("common.status")}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: "all", label: t("crm.filterAll") },
              { value: "debt", label: t("credits.filterDebt") },
              { value: "eligible", label: t("credits.filterEligible") },
              { value: "blocked", label: t("crm.filterBlocked") },
              { value: "archived", label: t("crm.filterArchived") },
            ]}
          />
        }
      />

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm min-w-[820px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("credits.name")}</th>
              <th className="p-2 sm:p-3 md:p-4 hidden sm:table-cell whitespace-nowrap">{t("credits.phone")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">{t("credits.totalCredits")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right hidden sm:table-cell whitespace-nowrap">
                {t("credits.totalPaid")}
              </th>
              <th
                className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap"
                title={t("credits.netHint")}
              >
                {t("credits.remaining")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-right hidden sm:table-cell whitespace-nowrap">
                {t("credits.takenOnCredit")}
              </th>
              <th
                className="p-2 sm:p-3 md:p-4 text-right hidden sm:table-cell whitespace-nowrap"
                title={t("credits.netHint")}
              >
                {t("credits.remainingToPay")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">{t("credits.netBalance")}</th>
              <th className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">{t("common.actions")}</th>
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
                    {/* Credit-blocked is the one flag that changes what the
                        cashier may do, so it is called out on the row. */}
                    {c.canTakeCredit === false && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                        {t("crm.creditBlocked")}
                      </span>
                    )}
                    {c.loyaltyPoints > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                        {c.loyaltyPoints} {t("crm.points")}
                      </span>
                    )}
                    {(c.tags ?? []).map((tag: string) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-500 hidden sm:table-cell whitespace-nowrap">
                  {c.phone || "—"}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">
                  {fmtCurrency(c.totalCredits)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right text-green-600 hidden sm:table-cell whitespace-nowrap">
                  {fmtCurrency(c.totalPaid)}
                </td>
                <td
                  className={`p-2 sm:p-3 md:p-4 text-right font-bold whitespace-nowrap ${c.remaining > 0 ? "text-red-500" : "text-green-600"}`}
                >
                  {fmtCurrency(c.remaining)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right text-gray-500 hidden sm:table-cell whitespace-nowrap">
                  {fmtCurrency(c.totalTakenOnCredit ?? 0)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right text-amber-600 hidden sm:table-cell whitespace-nowrap">
                  {fmtCurrency(c.remainingToPay ?? 0)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">
                  <NetPill amount={c.netBalance ?? 0} />
                </td>
                <td className="p-2 sm:p-3 md:p-4 whitespace-nowrap">
                  <RowActionsMenu
                    items={[
                      {
                        label: t("credits.view"),
                        onClick: () => router.push(`/dashboard/credits/${c.publicId ?? c.id}`),
                      },
                      {
                        label: t("crm.viewProfile"),
                        onClick: () =>
                          router.push(
                            `/dashboard/customers/${c.publicId ?? c.id}`,
                          ),
                      },
                      {
                        label: t("credits.sale"),
                        color: "text-green-600",
                        onClick: () => {
                          setSaleCustomer(c);
                          setShowSaleModal(true);
                        },
                      },
                      // Mirror entry: the goods moving the other way. Offered
                      // only when the person is a vendor and the user may buy.
                      ...(canBuyFromVendor
                        ? [
                            {
                              label: t("credits.purchase"),
                              color: "text-blue-600",
                              onClick: () => {
                                setPurchaseCustomer(c);
                                setShowPurchaseModal(true);
                              },
                            },
                          ]
                        : []),
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
                  colSpan={9}
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

      <SaleForm
        isOpen={showSaleModal && !!saleCustomer}
        onClose={() => {
          setShowSaleModal(false);
          setSaleCustomer(null);
        }}
        title={t("credits.addCreditSale")}
        defaultSaleType="CREDITED"
        defaultCustomerId={saleCustomer?.id ?? null}
        defaultCustomerName={saleCustomer?.name ?? ""}
        creditCustomersOnly
        onSaved={() => {
          setShowSaleModal(false);
          setSaleCustomer(null);
          fetchCustomers();
        }}
      />

      {/* Same form as the Purchases page, opened on the CREDIT settlement with
          this ledger row's person already chosen as the vendor — so a payable
          can be added where it is read, without a detour through the purchases
          page and a second lookup. The settlement switch stays visible; a paid
          purchase from the same vendor is recorded here too. */}
      <PurchaseForm
        isOpen={showPurchaseModal && !!purchaseCustomer}
        onClose={() => {
          setShowPurchaseModal(false);
          setPurchaseCustomer(null);
        }}
        mode="CREDIT"
        defaultVendorId={purchaseCustomer?.id ?? null}
        onSaved={() => {
          setShowPurchaseModal(false);
          setPurchaseCustomer(null);
          fetchCustomers();
        }}
      />
    </div>
  );
}

/**
 * A customer's net position with the business, signed so the direction is
 * unmistakable: green means they still owe us, red means we still owe them.
 * This person is also one of our vendors, so the receivable and the payable are
 * netted off each other first — the pill is the signed form of whichever of the
 * two netted columns is non-zero, and "settled" when neither is.
 */
function NetPill({ amount }: { amount: number }) {
  const { t } = useTranslation();
  const cls =
    amount > 0
      ? "bg-green-50 text-green-700"
      : amount < 0
        ? "bg-red-50 text-red-600"
        : "bg-gray-100 text-gray-500";
  const label =
    amount > 0
      ? t("credits.toReceive")
      : amount < 0
        ? t("credits.toPay")
        : t("credits.settled");
  return (
    <span
      className={
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold whitespace-nowrap " +
        cls
      }
    >
      {amount > 0 ? `+${fmtCurrency(amount)}` : fmtCurrency(amount)}
      <span className="font-normal">{label}</span>
    </span>
  );
}

