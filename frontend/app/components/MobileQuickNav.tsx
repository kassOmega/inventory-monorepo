"use client";
// Mobile-only floating quick nav: a concise, horizontally scrollable row of the
// tenant's primary quick actions, drawn straight from the permission-filtered
// nav so a role never sees an action it cannot open. After a few idle seconds the
// row folds into a small circle pinned bottom-right; tapping the circle unfolds
// the row again, so the nav stays out of the way of the page it floats over.
//
// Tablets and desktops keep the sidebar, hence `md:hidden`. Pages that pin their
// own bottom action bar are skipped entirely: a second floating bar there would
// cover their submit button. The row also tucks away while scrolling down and
// returns when scrolling up.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isNavItemActive,
  quickActionsFor,
  type DashboardNav,
  type DashboardNavItem,
  type NavStation,
} from "@/lib/dashboardNavigation";

/** Pages that pin their own action bar to the bottom of the mobile viewport. */
const HIDDEN_PREFIXES = [
  "/dashboard/food",
  "/dashboard/adjust-stock",
  "/dashboard/restock",
];

interface Props {
  nav: DashboardNav;
  pathname: string;
  /** Active business type, so the right quick-action list is chosen. */
  businessType?: string;
  /** Station boards (hospitality) — used to fall back to the user's station. */
  stations?: NavStation[];
}

/** The quick-action hrefs per business type, in display order. */
function actionHrefsFor(businessType: string, stations: NavStation[]): string[] {
  switch (businessType) {
    case "CAR_WASH":
      return [
        "/dashboard",
        "/dashboard/carwash/reports",
        "/dashboard/carwash/washer-reports",
        "/dashboard/carwash/washes",
        "/dashboard/carwash/expenses",
        "/dashboard/carwash/washers",
      ];
    case "RETAIL":
      return [
        "/dashboard",
        "/dashboard/sales",
        "/dashboard/purchases",
        "/dashboard/credits",
        "/dashboard/finance",
        "/dashboard/reports",
      ];
    case "HOSPITALITY":
      // Orders falls back to the first station board when the user takes orders
      // at a station but has no `/food/orders` permission.
      return [
        "/dashboard",
        "/dashboard/food/orders",
        ...stations.map((s) => `/dashboard/food/station/${s.key}`).slice(0, 1),
        "/dashboard/hotel",
        "/dashboard/hospitality/folios",
        "/dashboard/cashier",
      ];
    case "SERVICE":
      return [
        "/dashboard",
        "/dashboard/service/catalog",
        "/dashboard/service/bookings",
        "/dashboard/service/tickets",
        "/dashboard/service/clients",
      ];
    case "MANUFACTURING":
      return [
        "/dashboard",
        "/dashboard/manufacturing/production",
        "/dashboard/manufacturing/orders",
        "/dashboard/manufacturing/materials",
        "/dashboard/manufacturing/services",
      ];
    default:
      return ["/dashboard"];
  }
}

const itemClass = (active: boolean) =>
  "flex shrink-0 items-center whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition " +
  (active
    ? "bg-blue-600 text-white"
    : "text-gray-300 hover:bg-gray-800 hover:text-white");

export default function MobileQuickNav({
  nav,
  pathname,
  businessType = "",
  stations = [],
}: Props) {
  const { t } = useTranslation();

  // Direct links (already permission/station gated via the built nav).
  const actions: DashboardNavItem[] = useMemo(
    () => quickActionsFor(nav, actionHrefsFor(businessType, stations)),
    [nav, businessType, stations],
  );

  const [expanded, setExpanded] = useState(true);
  const [hidden, setHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastScrollY = useRef(0);

  // The bar stays put until the user collapses it themselves (no idle timer).

  // Tuck the bar out of the way while scrolling down, reveal when scrolling up.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (y > lastScrollY.current + 8 && y > 80) setHidden(true);
      else if (y < lastScrollY.current - 8) setHidden(false);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (actions.length === 0) return null;
  if (
    HIDDEN_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  )
    return null;

  return (
    <div
      ref={rootRef}
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      className={`pointer-events-none fixed left-4 right-4 z-40 md:hidden motion-safe:transition-all duration-300 ease-out ${
        hidden ? "translate-y-24 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      {/* One surface for both states: it *is* the row when wide and the circle
          when narrow, so the shape itself carries the transition instead of two
          boxes swapping places. */}
      <div
        className={`pointer-events-auto relative ml-auto h-12 overflow-hidden border border-gray-700 bg-gray-900/95 shadow-lg backdrop-blur motion-safe:transition-all duration-300 ease-out ${
          expanded ? "w-full rounded-2xl" : "w-12 rounded-[1.5rem]"
        }`}
      >
        {/* The scrollable row of direct quick actions, plus a collapse control. */}
        <div
          inert={!expanded}
          aria-hidden={!expanded}
          className={`absolute inset-0 flex items-center gap-1 motion-safe:transition-opacity ${
            expanded
              ? "delay-100 duration-200 opacity-100"
              : "delay-0 duration-100 opacity-0"
          }`}
        >
          <div className="flex flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain p-1">
            {actions.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={itemClass(isNavItemActive(item, pathname))}
              >
                {item.label}
              </Link>
            ))}
          </div>
          {/* Lets the user fold the row into the circle on demand. */}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t("nav.collapse")}
            title={t("nav.collapse")}
            className="shrink-0 self-stretch px-2 text-gray-400 hover:text-white"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* The circle: that same surface at its smallest, holding the menu icon. */}
        <button
          type="button"
          inert={expanded}
          aria-hidden={expanded}
          onClick={() => setExpanded(true)}
          aria-label={t("nav.menu")}
          title={t("nav.menu")}
          className={`absolute inset-0 flex items-center justify-center text-white motion-safe:transition-opacity ${
            expanded
              ? "delay-0 duration-100 pointer-events-none opacity-0"
              : "delay-100 duration-200 opacity-100"
          }`}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          {/* Marks that the current page matches one of the quick actions. */}
          {actions.some((i) => isNavItemActive(i, pathname)) && (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
          )}
        </button>
      </div>
    </div>
  );
}
