"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import PublicHeader from "@/app/components/PublicHeader";
import AiAssistWidget from "@/app/components/AiAssistWidget";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface DemoAccount {
  email: string;
  password: string;
  name: string;
  role: "Admin" | "Owner" | "Storekeeper" | "Shopkeeper" | "Standalone Shop" | "Manager" | "Waiter" | "Chef";
}

interface DemoGroup {
  company: string;
  accounts: DemoAccount[];
}

const DEMO_GROUPS: DemoGroup[] = [
  {
    company: "🛡️ Platform Admin",
    accounts: [
      { email: "kass3me@gmail.com", password: "KASS@3ko", name: "Kassahun Takele", role: "Admin" },
    ],
  },
  {
    company: "🏪 Standalone Shop",
    accounts: [
      { email: "standalone@inventory.com", password: "password123", name: "Meron Girma", role: "Standalone Shop" },
    ],
  },
  {
    company: "⚡ Nejat Electrical — Retail",
    accounts: [
      { email: "owner@inventory.com", password: "password123", name: "Abebe Bikila", role: "Owner" },
      { email: "storekeeper@inventory.com", password: "password123", name: "Chala Gemechu", role: "Storekeeper" },
      { email: "cablestore@inventory.com", password: "password123", name: "Taye Desta", role: "Storekeeper" },
      { email: "shopkeeper1@inventory.com", password: "password123", name: "Selam Tesfaye", role: "Shopkeeper" },
      { email: "shopkeeper2@inventory.com", password: "password123", name: "Kebede Alemu", role: "Shopkeeper" },
      { email: "shopkeeper3@inventory.com", password: "password123", name: "Tigist Haile", role: "Shopkeeper" },
    ],
  },
  {
    company: "🏨 Nejat Hospitality",
    accounts: [
      { email: "owner@inventory.com", password: "password123", name: "Abebe Bikila", role: "Owner" },
      { email: "manager@inventory.com", password: "password123", name: "Sara Mohammed", role: "Manager" },
      { email: "waiter@inventory.com", password: "password123", name: "Daniel Girma", role: "Waiter" },
      { email: "chef@inventory.com", password: "password123", name: "Fikru Tadesse", role: "Chef" },
    ],
  },
  {
    company: "🏪 Meron Trading — Retail",
    accounts: [
      { email: "meron@inventory.com", password: "password123", name: "Meron Alemu", role: "Owner" },
      { email: "meron-store@inventory.com", password: "password123", name: "Hanna Bekele", role: "Storekeeper" },
    ],
  },
  {
    company: "🏭 Meron Manufacturing",
    accounts: [
      { email: "meron@inventory.com", password: "password123", name: "Meron Alemu", role: "Owner" },
      { email: "meron-mfg@inventory.com", password: "password123", name: "Yonas Kassa", role: "Manager" },
    ],
  },
  {
    company: "☕ Dawit Café & Restaurant",
    accounts: [
      { email: "dawit@inventory.com", password: "password123", name: "Dawit Kebede", role: "Owner" },
      { email: "dawit-cafe@inventory.com", password: "password123", name: "Bethlehem Assefa", role: "Manager" },
    ],
  },
];

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const { login } = useAuth();

  // Show a one-time success banner when redirected from the signup page.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setJustCreated(new URLSearchParams(window.location.search).has("created"));
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      login(res.data.access_token, res.data.user);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        setError(t("auth.invalidCredentials"));
      } else {
        setError(t("errors.serverUnreachable"));
      }
    } finally {
      setLoading(false);
    }
  };

  const selectAccount = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  };

  const roleBadge = (role: string) => {
    switch (role) {
      case "Admin":
        return "bg-red-100 text-red-700 border-red-200";
      case "Owner":
        return "bg-purple-100 text-purple-700 border-purple-200";
      case "Storekeeper":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "Shopkeeper":
        return "bg-green-100 text-green-700 border-green-200";
      case "Standalone Shop":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "Manager":
        return "bg-amber-100 text-amber-700 border-amber-200";
      case "Waiter":
        return "bg-cyan-100 text-cyan-700 border-cyan-200";
      case "Chef":
        return "bg-orange-100 text-orange-700 border-orange-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const ROLE_KEY: Record<string, string> = {
    Admin: "roles.admin",
    Owner: "roles.owner",
    Storekeeper: "roles.storekeeper",
    Shopkeeper: "roles.shopkeeper",
    "Standalone Shop": "roles.standalone",
    Manager: "roles.manager",
    Waiter: "roles.waiter",
    Chef: "roles.chef",
  };

  const GROUP_KEY: Record<string, string> = {
    "🛡️ Platform Admin": "auth.demoPlatformAdmin",
    "🏪 Standalone Shop": "auth.demoStandaloneShop",
    "⚡ Nejat Electrical — Retail": "auth.demoNejatRetail",
    "🏨 Nejat Hospitality": "auth.demoNejatHospitality",
    "🏪 Meron Trading — Retail": "auth.demoMeronTrading",
    "🏭 Meron Manufacturing": "auth.demoMeronManufacturing",
    "☕ Dawit Café & Restaurant": "auth.demoDawitCafe",
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <PublicHeader showAuthActions={false} />
      <div className="mx-auto my-auto flex w-full flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-white shadow-lg rounded-xl p-6 sm:p-8 border border-gray-200 mb-6">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
              {t("app.name")}
            </h1>
            <p className="text-gray-500 mt-2 text-sm sm:text-base">{t("auth.loginTitle")}</p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded mb-4 text-sm text-center">
              {error}
            </div>
          )}

          {justCreated && (
            <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm text-center">
              {t("auth.accountCreatedVerify")}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm pr-10"
                  required
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                  {showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white p-2.5 sm:p-3 rounded-lg hover:bg-blue-700 font-semibold transition shadow-md text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {t("auth.signingIn")}
                </span>
              ) : (
                t("auth.signIn")
              )}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-5">
            {t("auth.noAccount")}{" "}
            <Link href="/signup" className="text-blue-600 hover:underline">
              {t("auth.createOne")}
            </Link>
          </p>
        </div>

        {/* Demo Accounts Section (development only) */}
        {process.env.NODE_ENV === "development" && (
          <div>
            <p className="text-xs text-gray-400 text-center mb-3 uppercase tracking-wider font-medium">
              {t("auth.demoAccounts")} — {t("auth.demoAccountsHint")}
            </p>
            <div className="space-y-4">
              {DEMO_GROUPS.map((group) => (
                <div key={group.company}>
                  <p className="text-[11px] font-semibold text-gray-500 mb-1.5 px-1">
                    {t(GROUP_KEY[group.company] ?? group.company)}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {group.accounts.map((account) => (
                      <button
                        key={account.email + account.role}
                        onClick={() => selectAccount(account)}
                        className={`text-left p-2.5 rounded-lg border transition-all ${
                          email === account.email
                            ? "border-blue-500 bg-blue-50 shadow-sm"
                            : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-medium text-gray-800 truncate">
                            {account.name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border whitespace-nowrap ${roleBadge(account.role)}`}
                          >
                            {t(ROLE_KEY[account.role] ?? account.role)}
                          </span>
                        </span>
                        <span className="block text-[10px] text-gray-400 truncate mt-0.5">
                          {account.email}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
      <AiAssistWidget />
    </div>
  );
}
