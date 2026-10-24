"use client";

import { useConfirm } from "@/app/components/ConfirmProvider";
import Button from "@/app/components/Button";
import { getDateRange } from "@/app/components/DateFilter";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import FinanceOverview from "@/app/components/FinanceOverview";
import DualExpenseModal from "@/app/components/DualExpenseModal";
import FinanceComparison from "@/app/components/FinanceComparison";
import FinancialBreakdown from "@/app/components/FinancialBreakdown";
import ItemizedPerformanceTable from "@/app/components/ItemizedPerformanceTable";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import api from "@/lib/api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Tab *ids* — internal identifiers, not labels: the visible text is
// `fin.tab<Id>`, translated at the call site below. Silenced for the i18n audit
// with the per-line ignore it documents for non-prose literals.
const TABS = [
  "Overview", // i18n-ignore
  "Breakdown", // i18n-ignore
  "Comparison", // i18n-ignore
  "Expenses", // i18n-ignore
  "Income", // i18n-ignore
  "Itemized", // i18n-ignore
];

export default function FinancePage() {
  const { hasPermission, activeMembership, user } = useAuth();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const canManage = hasPermission("finance.manage");
  const isOwner = user?.isSuperuser === true;
  const businessType =
    activeMembership?.businessType ?? user?.businessType ?? "";

  const [tab, setTab] = useState("Overview");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [location, setLocation] = useState("");
  const [locations, setLocations] = useState<any[]>([]);
  const [expenseLedger, setExpenseLedger] = useState<any>({
    overhead: [],
    procurements: [],
    cogs: [],
    totals: {
      overheadTotal: 0,
      procurementTotal: 0,
      cogsTotal: 0,
      totalMoneyOut: 0,
    },
  });
  const [expenseView, setExpenseView] = useState<
    "all" | "OPERATIONAL" | "INVENTORY_RESTOCK" | "COGS"
  >("all");
  const [incomes, setIncomes] = useState<any[]>([]);
  const [incomeView, setIncomeView] = useState<"all" | "manual" | "system">(
    "all",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [datePreset, setDatePreset] = useState<
    "today" | "week" | "month" | "year"
  >("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);

  const [expForm, setExpForm] = useState<any>(null);
  const [incForm, setIncForm] = useState<any>(null);
  const [savingIncome, setSavingIncome] = useState(false);
  const [addingIncomeCat, setAddingIncomeCat] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [incomeMapping, setIncomeMapping] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [extraIncome, setExtraIncome] = useState<any[]>([]);
  const [showNewIncomeCat, setShowNewIncomeCat] = useState(false);
  const [newIncomeCatName, setNewIncomeCatName] = useState("");

  const load = useCallback(async () => {
    try {
      const [accRes, ledRes, incRes, mapRes, pmRes] = await Promise.all([
        api.get("/finance/accounts"),
        api.get(
          `/finance/expense-ledger?startDate=${startDate}&endDate=${endDate}${
            location ? `&locationId=${location}` : ""
          }`,
        ),
        api.get(`/finance/incomes?startDate=${startDate}&endDate=${endDate}`),
        api.get("/finance/account-mappings").catch(() => ({ data: [] })),
        api.get("/payment-methods").catch(() => ({ data: [] })),
      ]);
      setAccounts(accRes.data);
      setExpenseLedger(
        ledRes.data ?? { overhead: [], procurements: [], totals: {} },
      );
      setIncomes(incRes.data);
      setIncomeMapping(
        (mapRes.data ?? []).find((m: any) => m.transactionType === "INCOME")
          ?.mapping ?? null,
      );
      setPaymentMethods(pmRes.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("fin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, location, t]);

  useEffect(() => {
    if (!isOwner) return;
    api.get("/locations").then((r) => setLocations(r.data ?? [])).catch(() => {});
  }, [isOwner]);

  useSingleLocationAutofill(locations, location, setLocation);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 1500);
  };

  // Strict expense boundary: system-managed inventory accounts (COGS,
  // Spoilage & Wastage) never appear in the manual expense form — inventory
  // purchases belong in Restock / Procurement, not the overhead expense list.
  const expenseAccounts = accounts.filter(
    (a) =>
      a.type === "EXPENSE" &&
      !["Cost of Goods Sold", "Spoilage & Wastage"].includes(a.name),
  );
  const incomeAccounts = accounts.filter((a) => a.type === "INCOME");

  // --- Expenses ---
  const openNewExpense = () =>
    setExpForm({
      id: null,
      accountId: expenseAccounts[0]?.id ? String(expenseAccounts[0].id) : "",
      amount: "",
      vendor: "",
      notes: "",
    });
  const openEditExpense = (x: any) =>
    setExpForm({
      id: x.id,
      accountId: x.accountId ? String(x.accountId) : "",
      amount: String(x.amount),
      vendor: x.vendor ?? "",
      notes: x.notes ?? "",
    });
  const deleteExpense = async (x: any) => {
    if (!(await confirm(t("fin.delExpenseConfirm")))) return;
    setBusyKey(`exp-${x.id}`);
    try {
      await api.delete(`/finance/expenses/${x.id}`);
      flash(t("fin.expenseDeleted"));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("fin.delExpenseFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  // --- Income ---
  const openNewIncome = () => {
    setShowNewIncomeCat(false);
    setNewIncomeCatName("");
    setIncForm({
      id: null,
      accountId: incomeAccounts[0]?.id ? String(incomeAccounts[0].id) : "",
      description: "",
      amount: "",
      incomeDate: new Date().toISOString().slice(0, 10),
      paymentMethodId: "",
    });
  };
  const openEditIncome = (x: any) => {
    setShowNewIncomeCat(false);
    setNewIncomeCatName("");
    setIncForm({
      id: x.id,
      accountId: x.accountId ? String(x.accountId) : "",
      description: x.description ?? "",
      amount: String(x.amount),
      incomeDate: x.incomeDate
        ? new Date(x.incomeDate).toISOString().slice(0, 10)
        : "",
      paymentMethodId: x.paymentMethodId ? String(x.paymentMethodId) : "",
    });
  };
  const addIncomeCategory = async () => {
    if (!newIncomeCatName.trim()) {
      setError(t("fin.catNameRequired"));
      return;
    }
    setAddingIncomeCat(true);
    try {
      const res = await api.post("/finance/accounts", {
        name: newIncomeCatName.trim(),
        type: "INCOME",
      });
      setExtraIncome((prev) => [...prev, res.data]);
      setIncForm((f: any) =>
        f ? { ...f, accountId: String(res.data.id) } : f,
      );
      setShowNewIncomeCat(false);
      setNewIncomeCatName("");
      flash(t("fin.categoryCreated"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("fin.createCatFailed"));
    } finally {
      setAddingIncomeCat(false);
    }
  };
  const saveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSavingIncome(true);
    try {
      const payload = {
        accountId: Number(incForm.accountId),
        amount: Number(incForm.amount),
        description: incForm.description || undefined,
        ...(incForm.incomeDate ? { incomeDate: incForm.incomeDate } : {}),
        ...(incForm.paymentMethodId
          ? { paymentMethodId: Number(incForm.paymentMethodId) }
          : {}),
      };
      if (incForm.id)
        await api.patch(`/finance/incomes/${incForm.id}`, payload);
      else await api.post("/finance/incomes", payload);
      setIncForm(null);
      flash(t("fin.incomeSaved"));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("fin.saveIncomeFailed"));
    } finally {
      setSavingIncome(false);
    }
  };
  const deleteIncome = async (x: any) => {
    if (!(await confirm(t("fin.delIncomeConfirm")))) return;
    setBusyKey(`inc-${x.id}`);
    try {
      await api.delete(`/finance/incomes/${x.id}`);
      flash(t("fin.incomeDeleted"));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("fin.delIncomeFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <p className="text-gray-500 p-6">{t("fin.loading")}</p>;

  const money = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const totalMoneyOut = expenseLedger.totals?.totalMoneyOut ?? 0;
  const totalIncomes = incomes.reduce((s, x) => s + x.amount, 0);
  const isManualIncome = (x: any) => !x.source || x.source === "MANUAL";
  const manualIncomes = incomes.filter(isManualIncome);
  const systemIncomes = incomes.filter((x: any) => !isManualIncome(x));
  const manualIncomeTotal = manualIncomes.reduce((s, x) => s + x.amount, 0);
  const systemIncomeTotal = systemIncomes.reduce((s, x) => s + x.amount, 0);
  const visibleIncomes =
    incomeView === "manual"
      ? manualIncomes
      : incomeView === "system"
        ? systemIncomes
        : incomes;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("nav.finance")}</h1>
        <Link
          href="/dashboard/accounts"
          className="text-sm text-blue-600 hover:underline font-medium"
        >
          {t("accounts.title")} →
        </Link>
      </div>
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
          {error}
        </div>
      )}
      {msg && (
        <div className="bg-green-50 text-green-700 p-3 rounded text-sm">
          {msg}
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 pb-2 overflow-x-auto">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === tb
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t(`fin.tab${tb}`)}
          </button>
        ))}
      </div>

      <CollapsibleFilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        location={location}
        onLocationChange={setLocation}
        locations={locations}
        showLocation={isOwner}
      />

      {tab === "Overview" && (
        <FinanceOverview
          startDate={startDate}
          endDate={endDate}
          businessType={businessType}
          locationId={location || undefined}
        />
      )}

      {tab === "Breakdown" && (
        <FinancialBreakdown
          startDate={startDate}
          endDate={endDate}
          businessType={businessType}
          locationId={location || undefined}
        />
      )}

      {tab === "Comparison" && (
        <FinanceComparison
          startDate={startDate}
          endDate={endDate}
          locationId={location || undefined}
        />
      )}

      {tab === "Expenses" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">
                {t("fin.expensesOutgoings")}
              </h2>
              {canManage && (
                <button
                  onClick={openNewExpense}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {t("fin.addExpense")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">
                  {t("fin.totalMoneyOut")}
                </p>
                <p className="font-semibold text-gray-800">
                  {money(totalMoneyOut)} ETB
                </p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">
                  {t("fin.plOverheadImpact")}
                </p>
                <p className="font-semibold text-gray-800">
                  {money(expenseLedger.totals?.overheadTotal ?? 0)} ETB
                </p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">
                  {t("fin.procurementTotal")}
                </p>
                <p className="font-semibold text-gray-800">
                  {money(expenseLedger.totals?.procurementTotal ?? 0)} ETB
                </p>
              </div>
              <div className="bg-blue-50 rounded p-3">
                <p className="text-xs text-blue-500">{t("fin.cogsTotal")}</p>
                <p className="font-semibold text-blue-800">
                  {money(expenseLedger.totals?.cogsTotal ?? 0)} ETB
                </p>
                <p className="mt-1 text-[10px] leading-tight text-blue-500">
                  {t("fin.cogsHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {[
                ["all", t("fin.expenseViewAll")],
                ["OPERATIONAL", t("fin.expenseViewOperational")],
                ["INVENTORY_RESTOCK", t("fin.expenseViewProcurement")],
                ["COGS", t("fin.expenseViewCogs")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setExpenseView(value as typeof expenseView)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    expenseView === value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {[
                ...(expenseLedger.overhead ?? []).map((x: any) => ({
                  ...x,
                  badge: "OPERATIONAL",
                })),
                ...(expenseLedger.procurements ?? []).map((x: any) => ({
                  ...x,
                  badge: "INVENTORY_RESTOCK",
                })),
                ...(expenseLedger.cogs ?? []).map((x: any) => ({
                  ...x,
                  badge: "COGS",
                })),
              ]
                .filter(
                  (x: any) =>
                    expenseView === "all" || x.badge === expenseView,
                )
                .sort(
                  (a: any, b: any) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime(),
                )
                .map((x: any) => (
                  <li
                    key={`${x.kind}-${x.id}`}
                    className="py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {x.badge === "INVENTORY_RESTOCK" ? (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                            {t("fin.badgeInventoryRestock")}
                          </span>
                        ) : x.badge === "COGS" ? (
                          <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                            {t("fin.badgeCogs")}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">
                            {t("fin.badgeOperationalExpense")}
                          </span>
                        )}
                        <p className="text-gray-800 truncate">
                          {x.kind === "COGS"
                            ? x.description
                            : x.categoryName ??
                              x.description ??
                              t("status.expense")}
                        </p>
                      </div>
                      <p className="text-xs text-gray-400">
                        {x.kind === "COGS"
                          ? [
                              x.categoryName,
                              x.source
                                ? `${x.source}${
                                    x.sourceId ? `-${x.sourceId}` : ""
                                  }`
                                : "",
                              x.date
                                ? new Date(x.date).toLocaleDateString()
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : x.badge === "INVENTORY_RESTOCK"
                            ? [
                                x.reference,
                                x.date
                                  ? new Date(x.date).toLocaleDateString()
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : [
                                x.vendor,
                                x.paymentMethodName,
                                x.taxAmount
                                  ? `Tax ${money(x.taxAmount)}`
                                  : "",
                                x.date
                                  ? new Date(x.date).toLocaleDateString()
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-red-600 font-medium">
                        -{money(x.amount)}
                      </span>
                      {x.badge === "OPERATIONAL" && canManage && (
                        <>
                          <button
                            onClick={() => openEditExpense(x)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {t("common.edit")}
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyKey === `exp-${x.id}`}
                            onClick={() => deleteExpense(x)}
                            className="!px-0 text-xs text-red-600 hover:underline"
                          >
                            {t("common.del")}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              {(expenseLedger.overhead?.length ?? 0) +
                (expenseLedger.procurements?.length ?? 0) +
                (expenseLedger.cogs?.length ?? 0) ===
                0 && (
                <li className="text-gray-400 py-2">{t("fin.noOutgoings")}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "Income" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold text-gray-800">
                  {t("fin.incomeLedger")}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t("fin.incomeLedgerHint")}
                </p>
              </div>
              {canManage && (
                <button
                  onClick={openNewIncome}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {t("fin.addIncome")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">{t("fin.totalIncome")}</p>
                <p className="font-semibold text-gray-800">
                  {money(totalIncomes)} ETB
                </p>
              </div>
              <div className="bg-green-50 rounded p-3">
                <p className="text-xs text-green-600">
                  {t("fin.manualIncome")}
                </p>
                <p className="font-semibold text-green-800">
                  {money(manualIncomeTotal)} ETB
                </p>
              </div>
              <div className="bg-blue-50 rounded p-3">
                <p className="text-xs text-blue-600">
                  {t("fin.systemIncome")}
                </p>
                <p className="font-semibold text-blue-800">
                  {money(systemIncomeTotal)} ETB
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {[
                ["all", t("fin.incomeViewAll")],
                ["manual", t("fin.incomeViewManual")],
                ["system", t("fin.incomeViewSystem")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIncomeView(value as typeof incomeView)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    incomeView === value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {visibleIncomes.map((x) => {
                const manual = isManualIncome(x);
                const reference =
                  x.sourceRef ??
                  (x.source && x.sourceId
                    ? `${x.source}-${x.sourceId}`
                    : null);
                return (
                  <li
                    key={x.id}
                    className="py-2.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            manual
                              ? "bg-green-100 text-green-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {manual
                            ? t("fin.manual")
                            : x.source ?? t("fin.system")}
                        </span>
                        <p className="text-gray-800 truncate">
                          {x.description ?? x.account?.name}
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[
                          x.account?.name,
                          x.account?.code,
                          x.paymentMethod?.name,
                          reference,
                          x.incomeDate
                            ? new Date(x.incomeDate).toLocaleDateString()
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-green-600 font-medium">
                        +{money(x.amount)}
                      </span>
                      {manual && canManage && (
                        <>
                          <button
                            onClick={() => openEditIncome(x)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {t("common.edit")}
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyKey === `inc-${x.id}`}
                            onClick={() => deleteIncome(x)}
                            className="!px-0 text-xs text-red-600 hover:underline"
                          >
                            {t("common.del")}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
              {visibleIncomes.length === 0 && (
                <li className="text-gray-400 py-2">{t("fin.noIncome")}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "Itemized" && (
        <ItemizedPerformanceTable
          startDate={startDate}
          endDate={endDate}
          businessType={businessType}
          locationId={location || undefined}
        />
      )}

      <DualExpenseModal
        open={!!expForm}
        editing={expForm?.id ? expForm : null}
        expenseAccounts={expenseAccounts}
        onClose={() => setExpForm(null)}
        onSaved={() => {
          setExpForm(null);
          flash(t("fin.saved"));
          load();
        }}
      />

      {incForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">
              {incForm.id ? t("fin.editIncome") : t("fin.newIncome")}
            </h2>
            <form onSubmit={saveIncome} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("fin.categoryRequired")}
                </label>
                {!showNewIncomeCat ? (
                  <SearchableSelect
                    options={[...incomeAccounts, ...extraIncome].map(
                      (a: any) => ({
                        value: String(a.id),
                        label: a.code ? `${a.name} (${a.code})` : a.name,
                        searchText: `${a.name} ${a.code ?? ""}`,
                      }),
                    )}
                    value={incForm.accountId}
                    onChange={(v: string) =>
                      setIncForm({ ...incForm, accountId: v })
                    }
                    placeholder={t("fin.selectCategory")}
                    className="w-full"
                  />
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={newIncomeCatName}
                      onChange={(e) => setNewIncomeCatName(e.target.value)}
                      placeholder={t("fin.newCategoryName")}
                      className="border border-gray-300 rounded p-2 text-sm flex-1"
                    />
                    <Button
                      type="button"
                      loading={addingIncomeCat}
                      onClick={addIncomeCategory}
                      className="!px-3 !text-sm"
                    >
                      {t("common.add")}
                    </Button>
                  </div>
                )}
                {!showNewIncomeCat && (
                  <button
                    type="button"
                    onClick={() => setShowNewIncomeCat(true)}
                    className="text-xs text-blue-600 hover:underline mt-1"
                  >
                    {t("fin.newCategoryHint")}
                  </button>
                )}
                {incForm.accountId &&
                  !showNewIncomeCat &&
                  (() => {
                    const sel = [...incomeAccounts, ...extraIncome].find(
                      (a: any) => String(a.id) === incForm.accountId,
                    );
                    const debitName =
                      incomeMapping?.debitAccount?.name ?? t("fin.cash");
                    return sel ? (
                      <p className="text-[11px] text-gray-400 mt-1">
                        {t("fin.postsHint", {
                          debit: debitName,
                          credit: sel.name,
                        })}
                      </p>
                    ) : null;
                  })()}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("fin.incomeDate")}
                </label>
                <input
                  type="date"
                  value={incForm.incomeDate ?? ""}
                  onChange={(e) =>
                    setIncForm({ ...incForm, incomeDate: e.target.value })
                  }
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("de.paymentMethod")}
                </label>
                <select
                  value={incForm.paymentMethodId ?? ""}
                  onChange={(e) =>
                    setIncForm({ ...incForm, paymentMethodId: e.target.value })
                  }
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="">{t("de.paymentMethodOptional")}</option>
                  {paymentMethods.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("fin.amountEtb")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={incForm.amount}
                  onChange={(e) =>
                    setIncForm({ ...incForm, amount: e.target.value })
                  }
                  placeholder={t("common.amount")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("common.description")}
                </label>
                <input
                  value={incForm.description}
                  onChange={(e) =>
                    setIncForm({ ...incForm, description: e.target.value })
                  }
                  placeholder={t("fin.descriptionPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIncForm(null)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  {t("common.cancel")}
                </button>
                <Button
                  type="submit"
                  loading={savingIncome}
                  className="!px-3 !text-sm"
                >
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
