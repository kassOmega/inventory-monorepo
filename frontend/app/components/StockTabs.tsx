"use client";
// The Stock section's tab bar. Its three pages (Stock Tasks, Stock In, Stock Count)
// are separate routes — each keeps its own URL, deep links and query handling — but
// they read as tabs of the single "Stock" menu item, which stays highlighted on all
// three. "Stock Tasks" is the first tab, so the menu item lands there.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";

export default function StockTabs() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { hasPermission } = useAuth();

  const tabs = [
    {
      href: "/dashboard/inventory",
      label: t("nav.groups.overview"),
      permission: "products.view",
    },
    {
      href: "/dashboard/restock",
      label: t("sc.nameIn"),
      permission: "restock.create",
    },
    {
      href: "/dashboard/adjust-stock",
      label: t("sc.nameCount"),
      permission: "products.adjust-stock",
    },
  ].filter((tab) => hasPermission(tab.permission));

  // One tab is not a tab bar — and the business may have granted only one.
  if (tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-gray-200 mb-4"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 transition ${
              active
                ? "border-blue-600 text-blue-700 font-medium"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
