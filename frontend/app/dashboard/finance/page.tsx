"use client";

import api from "@/lib/api";
import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import FinancialBreakdown from "@/app/components/FinancialBreakdown";
import FinanceComparison from "@/app/components/FinanceComparison";
import ItemizedPerformanceTable from "@/app/components/ItemizedPerformanceTable";
import DualExpenseModal from "@/app/components/DualExpenseModal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const TABS = ["Overview", "Breakdown", "Comparison", "Expenses", "Income", "Itemized"];

export default function FinancePage() {
  const { hasPermission, activeMembership, user } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("finance.manage");
  const businessType = activeMembership?.businessType ?? user?.businessType ?? "";

  const [tab, setTab] = useState("Overview");
  const [pl, setPl] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenseLedger, setExpenseLedger] = useState<any>({
    overhead: [],
    procurements: [],
    totals: { overheadTotal: 0, procurementTotal: 0, totalMoneyOut: 0 },
  });
  const [incomes, setIncomes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [datePreset, setDatePreset] = useState<"today" | "week" | "month" | "year">("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);

  const [expForm, setExpForm] = useState<any>(null);
  const [incForm, setIncForm] = useState<any>(null);
  const [opsSummary, setOpsSummary] = useState<any>(null);
  const [incomeMapping, setIncomeMapping] = useState<any>(null);
  const [extraIncome, setExtraIncome] = useState<any[]>([]);
  const [showNewIncomeCat, setShowNewIncomeCat] = useState(false);
  const [newIncomeCatName, setNewIncomeCatName] = useState("");

  const load = useCallback(async () => {
    try {
      const [plRes, accRes, ledRes, incRes, opsRes, mapRes] = await Promise.all([
        api.get(`/finance/profit-loss?startDate=${startDate}&endDate=${endDate}`),
        api.get("/finance/accounts"),
        api.get(`/finance/expense-ledger?startDate=${startDate}&endDate=${endDate}`),
        api.get(`/finance/incomes?startDate=${startDate}&endDate=${endDate}`),
        api.get(`/finance/operational-summary?startDate=${startDate}&endDate=${endDate}`).catch(() => ({ data: null })),
        api.get("/finance/account-mappings").catch(() => ({ data: [] })),
      ]);
      setPl(plRes.data);
      setAccounts(accRes.data);
      setExpenseLedger(ledRes.data ?? { overhead: [], procurements: [], totals: {} });
      setIncomes(incRes.data);
      setOpsSummary(opsRes.data);
      setIncomeMapping(
        (mapRes.data ?? []).find((m: any) => m.transactionType === "INCOME")?.mapping ?? null,
      );
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load finance data");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

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
    setExpForm({ id: null, accountId: expenseAccounts[0]?.id ? String(expenseAccounts[0].id) : "", amount: "", vendor: "", notes: "" });
  const openEditExpense = (x: any) =>
    setExpForm({
      id: x.id,
      accountId: x.accountId ? String(x.accountId) : "",
      amount: String(x.amount),
      vendor: x.vendor ?? "",
      notes: x.notes ?? "",
    });
  const deleteExpense = async (x: any) => {
    if (!(await confirm("Delete this expense?"))) return;
    try {
      await api.delete(`/finance/expenses/${x.id}`);
      flash("Expense deleted");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete expense");
    }
  };

  // --- Income ---
  const openNewIncome = () => {
    setShowNewIncomeCat(false);
    setNewIncomeCatName("");
    setIncForm({ id: null, accountId: incomeAccounts[0]?.id ? String(incomeAccounts[0].id) : "", description: "", amount: "" });
  };
  const openEditIncome = (x: any) => {
    setShowNewIncomeCat(false);
    setNewIncomeCatName("");
    setIncForm({ id: x.id, accountId: x.accountId ? String(x.accountId) : "", description: x.description ?? "", amount: String(x.amount) });
  };
  const addIncomeCategory = async () => {
    if (!newIncomeCatName.trim()) {
      setError("Enter a category name first.");
      return;
    }
    try {
      const res = await api.post("/finance/accounts", {
        name: newIncomeCatName.trim(),
        type: "INCOME",
      });
      setExtraIncome((prev) => [...prev, res.data]);
      setIncForm((f: any) => (f ? { ...f, accountId: String(res.data.id) } : f));
      setShowNewIncomeCat(false);
      setNewIncomeCatName("");
      flash("Category created");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create category");
    }
  };
  const saveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        accountId: Number(incForm.accountId),
        amount: Number(incForm.amount),
        description: incForm.description || undefined,
      };
      if (incForm.id) await api.patch(`/finance/incomes/${incForm.id}`, payload);
      else await api.post("/finance/incomes", payload);
      setIncForm(null);
      flash("Income saved");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save income");
    }
  };
  const deleteIncome = async (x: any) => {
    if (!(await confirm("Delete this income entry?"))) return;
    try {
      await api.delete(`/finance/incomes/${x.id}`);
      flash("Income deleted");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete income");
    }
  };

  if (loading) return <p className="text-gray-500 p-6">Loading finance…</p>;

  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const totalMoneyOut = expenseLedger.totals?.totalMoneyOut ?? 0;
  const totalIncomes = incomes.reduce((s, x) => s + x.amount, 0);

  // Vertical-tailored operational pulse, computed from the same journal lines
  // the GL/reports use (GET /finance/operational-summary).
  const opsRows = opsSummary?.rows ?? [];
  const accountAmount = (type: string, names: string[], codes: string[]) =>
    opsRows
      .filter(
        (r: any) =>
          r.type === type &&
          (names.includes(r.name) ||
            codes.some((c) => String(r.code ?? "").startsWith(c))),
      )
      .reduce((s: number, r: any) => s + (r.amount ?? 0), 0);
  const incomeCard = (names: string[], codes: string[]) =>
    accountAmount("INCOME", names, codes);
  const expenseCard = (names: string[], codes: string[]) =>
    accountAmount("EXPENSE", names, codes);
  const verticalCards = (() => {
    if (businessType === "MANUFACTURING")
      return [
        { label: "Production Revenue", value: incomeCard(["Production Revenue"], ["4010"]), tone: "gray" },
        { label: "Raw Materials + Labor", value: expenseCard(["Raw Materials Cost", "Direct Labor"], ["5020", "5030"]), tone: "red" },
        { label: "Spoilage & Scrap", value: expenseCard(["Spoilage & Wastage"], ["7100"]), tone: "red" },
        { label: "Finished COGS", value: expenseCard(["Cost of Goods Sold"], ["5000"]), tone: "red" },
      ];
    if (businessType === "HOSPITALITY")
      return [
        { label: "Room Revenue", value: incomeCard(["Room Revenue"], ["4030"]), tone: "gray" },
        { label: "Food Sales", value: incomeCard(["Food Sales"], ["4010"]), tone: "gray" },
        { label: "Beverage Sales", value: incomeCard(["Beverage Sales"], ["4020"]), tone: "gray" },
        { label: "Food & Beverage Cost", value: expenseCard(["Food Cost", "Beverage Cost"], ["5020", "5030"]), tone: "red" },
      ];
    if (businessType === "SERVICE")
      return [
        { label: "Service Revenue", value: incomeCard(["Service Revenue", "Sales Revenue"], ["4000", "4010"]), tone: "gray" },
        { label: "Cost of Service", value: expenseCard(["Cost of Service"], ["5010"]), tone: "red" },
      ];
    // Retail & Distribution (default)
    return [
      { label: "Retail Sales Revenue", value: incomeCard(["Sales Revenue", "Production Revenue"], ["4000", "4010"]), tone: "gray" },
      { label: "Cost of Goods Sold", value: expenseCard(["Cost of Goods Sold", "Raw Materials Cost"], ["5000", "5020"]), tone: "red" },
      { label: "Spoilage / Stock Variance", value: expenseCard(["Spoilage & Wastage", "Inventory Adjustment"], ["7100", "7200"]), tone: "red" },
    ];
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Finance</h1>
        <Link href="/dashboard/accounts" className="text-sm text-blue-600 hover:underline font-medium">
          Chart of Accounts →
        </Link>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab !== "Accounts" && (
        <DateFilter
          preset={datePreset}
          onPresetChange={setDatePreset}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
        />
      )}

      {tab === "Overview" && pl && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Total Revenue</p>
            <p className="text-lg font-bold text-gray-800">{money(pl.totalRevenue)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Cost of Goods Expense</p>
            <p className="text-lg font-bold text-red-600">{money(pl.costOfGoodsSold)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Operational Expenses</p>
            <p className="text-lg font-bold text-red-600">{money(pl.expenses)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Total Expenses</p>
            <p className="text-lg font-bold text-red-600">{money(pl.totalCosts)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Gross Profit</p>
            <p className="text-lg font-bold text-gray-800">{money(pl.grossProfit)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-400">Net Profit</p>
            <p className={`text-lg font-bold ${(pl.netProfit ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>{money(pl.netProfit)}</p>
          </div>
        </div>
        {verticalCards.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="col-span-full">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {businessType} pulse · this period
              </p>
            </div>
            {verticalCards.map((c) => (
              <div key={c.label} className="bg-gradient-to-b from-white to-gray-50 p-4 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-400">{c.label}</p>
                <p className={`text-lg font-bold ${c.tone === "red" ? "text-red-600" : "text-gray-800"}`}>
                  {c.value ? money(c.value) : "—"}
                </p>
              </div>
            ))}
          </div>
        )}
        </>
      )}

      {tab === "Breakdown" && (
        <FinancialBreakdown
          startDate={startDate}
          endDate={endDate}
          businessType={businessType}
        />
      )}

      {tab === "Comparison" && (
        <FinanceComparison startDate={startDate} endDate={endDate} />
      )}


      {tab === "Expenses" && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">Expenses & Outgoings</h2>
              {canManage && (
                <button onClick={openNewExpense} className="text-sm text-blue-600 hover:underline">
                  + Add Expense
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">Total Money Out</p>
                <p className="font-semibold text-gray-800">{money(totalMoneyOut)} ETB</p>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-400">P&L Overhead Impact</p>
                <p className="font-semibold text-gray-800">{money(expenseLedger.totals?.overheadTotal ?? 0)} ETB</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <ul className="divide-y divide-gray-100 text-sm">
              {[
                ...(expenseLedger.overhead ?? []).map((x: any) => ({ ...x, badge: "OPERATIONAL" })),
                ...(expenseLedger.procurements ?? []).map((x: any) => ({ ...x, badge: "INVENTORY_RESTOCK" })),
              ]
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((x: any) => (
                  <li key={`${x.kind}-${x.id}`} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {x.badge === "INVENTORY_RESTOCK" ? (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">[Inventory Restock]</span>
                        ) : (
                          <span className="text-[10px] font-semibold bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">[Operational Expense]</span>
                        )}
                        <p className="text-gray-800 truncate">{x.categoryName ?? x.description ?? "Expense"}</p>
                      </div>
                      <p className="text-xs text-gray-400">
                        {x.vendor ? `${x.vendor} · ` : ""}
                        {x.date ? new Date(x.date).toLocaleDateString() : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-red-600 font-medium">-{money(x.amount)}</span>
                      {x.badge === "OPERATIONAL" && canManage && (
                        <>
                          <button onClick={() => openEditExpense(x)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button onClick={() => deleteExpense(x)} className="text-xs text-red-600 hover:underline">Del</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              {(expenseLedger.overhead?.length ?? 0) + (expenseLedger.procurements?.length ?? 0) === 0 && (
                <li className="text-gray-400 py-2">No outgoings yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "Income" && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">Income <span className="text-green-600 font-normal">· {money(totalIncomes)}</span></h2>
            {canManage && (
              <button onClick={openNewIncome} className="text-sm text-blue-600 hover:underline">
                + Add Income
              </button>
            )}
          </div>
          <ul className="divide-y divide-gray-100 text-sm">
            {incomes.map((x) => (
              <li key={x.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-gray-800 truncate">{x.description ?? x.account?.name}</p>
                  <p className="text-xs text-gray-400">{new Date(x.incomeDate).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-green-600 font-medium">+{money(x.amount)}</span>
                  {canManage && (
                    <>
                      <button onClick={() => openEditIncome(x)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteIncome(x)} className="text-xs text-red-600 hover:underline">Del</button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {incomes.length === 0 && <li className="text-gray-400 py-2">No income yet.</li>}
          </ul>
        </div>
      )}

      {tab === "Itemized" && (
        <ItemizedPerformanceTable
          startDate={startDate}
          endDate={endDate}
          businessType={businessType}
        />
      )}

      <DualExpenseModal
        open={!!expForm}
        editing={expForm?.id ? expForm : null}
        expenseAccounts={expenseAccounts}
        onClose={() => setExpForm(null)}
        onSaved={() => {
          setExpForm(null);
          flash("Saved");
          load();
        }}
      />

      {incForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{incForm.id ? "Edit Income" : "New Income"}</h2>
            <form onSubmit={saveIncome} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category *</label>
                {!showNewIncomeCat ? (
                  <SearchableSelect
                    options={[...incomeAccounts, ...extraIncome].map((a: any) => ({
                      value: String(a.id),
                      label: a.code ? `${a.name} (${a.code})` : a.name,
                      searchText: `${a.name} ${a.code ?? ""}`,
                    }))}
                    value={incForm.accountId}
                    onChange={(v: string) => setIncForm({ ...incForm, accountId: v })}
                    placeholder="Select a category…"
                    className="w-full"
                  />
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={newIncomeCatName}
                      onChange={(e) => setNewIncomeCatName(e.target.value)}
                      placeholder="New category name"
                      className="border border-gray-300 rounded p-2 text-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={addIncomeCategory}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium"
                    >
                      Add
                    </button>
                  </div>
                )}
                {!showNewIncomeCat && (
                  <button
                    type="button"
                    onClick={() => setShowNewIncomeCat(true)}
                    className="text-xs text-blue-600 hover:underline mt-1"
                  >
                    + New category (create an account)
                  </button>
                )}
                {incForm.accountId &&
                  !showNewIncomeCat &&
                  (() => {
                    const sel = [...incomeAccounts, ...extraIncome].find(
                      (a: any) => String(a.id) === incForm.accountId,
                    );
                    const debitName = incomeMapping?.debitAccount?.name ?? "Cash";
                    return sel ? (
                      <p className="text-[11px] text-gray-400 mt-1">
                        Posts: Debit {debitName} ↔ Credit {sel.name}
                      </p>
                    ) : null;
                  })()}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount (ETB) *</label>
                <input type="number" step="0.01" value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} placeholder="Amount" className="border border-gray-300 rounded p-2 text-sm w-full" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <input value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} placeholder="e.g. Equipment sale, Refund" className="border border-gray-300 rounded p-2 text-sm w-full" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIncForm(null)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
