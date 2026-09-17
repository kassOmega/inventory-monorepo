"use client";
// Stock Tasks — the landing tab of the Stock section. It states the two things you
// can DO to stock, side by side and clearly labelled, so "add" and "set" are never
// confused. Its siblings (Stock In, Stock Count) are the other two tabs.
import Link from "next/link";
import { useTranslation } from "react-i18next";
import StockTabs from "@/app/components/StockTabs";
import { useAuth } from "@/context/AuthContext";

export default function StockTasksPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  const cards = [
    {
      href: "/dashboard/restock",
      permission: "restock.create",
      tone: "green" as const,
      title: t("sc.nameIn"),
      rule: t("sc.ruleIn"),
      hint: t("hub.stockInHint"),
    },
    {
      href: "/dashboard/adjust-stock",
      permission: "products.adjust-stock",
      tone: "blue" as const,
      title: t("sc.nameCount"),
      rule: t("sc.ruleCount"),
      hint: t("hub.stockCountHint"),
    },
  ].filter((card) => hasPermission(card.permission));

  const links = [
    { href: "/dashboard/products", label: t("nav.products") },
    { href: "/dashboard/prices", label: t("nav.prices") },
    { href: "/dashboard/requests", label: t("nav.requests") },
  ];

  return (
    <div className="space-y-4">
      <StockTabs />
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("hub.title")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("hub.subtitle")}</p>
      </div>

      {cards.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-6 text-sm text-gray-500">
          {t("sc.noPermission")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`block rounded-xl border shadow-sm bg-white p-5 transition hover:shadow-md ${
                card.tone === "green" ? "border-green-200" : "border-blue-200"
              }`}
            >
              <p
                className={`text-base font-semibold ${
                  card.tone === "green" ? "text-green-700" : "text-blue-700"
                }`}
              >
                {card.title}
              </p>
              <p className="text-sm text-gray-700 mt-1">{card.rule}</p>
              <p className="text-xs text-gray-500 mt-2">{card.hint}</p>
              <p className="text-sm font-medium text-gray-800 mt-3">
                {t("hub.open")} →
              </p>
            </Link>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm p-4">
        <p className="text-sm font-medium text-gray-700">{t("hub.quick")}</p>
        <div className="flex flex-wrap gap-4 mt-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-blue-700 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
