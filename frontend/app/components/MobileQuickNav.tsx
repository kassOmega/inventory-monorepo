"use client";
// Mobile-only floating quick nav: the five primary menu groups as a thin bar over
// the bottom of the viewport, each one expanding its children upward. After a few
// idle seconds the bar itself collapses into a small circle pinned to the
// bottom-right, and that circle unfolds back into the bar on tap, so the nav stays
// out of the way of the page it floats over. While a child list is open the bar
// stays put, because that list is what was asked for.
//
// Tablets and desktops keep the sidebar, hence `md:hidden`. Pages that already own
// the bottom of the viewport with their own action bar are skipped entirely: a
// second floating bar there would cover their submit button.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  primaryNavGroups,
  type DashboardNav,
  type DashboardNavGroup,
} from "@/lib/dashboardNavigation";
import useNavGroups from "@/lib/useNavGroups";
import NavItemLink from "./NavItemLink";

/** Pages that pin their own action bar to the bottom of the mobile viewport. */
const HIDDEN_PREFIXES = [
  "/dashboard/food",
  "/dashboard/adjust-stock",
  "/dashboard/restock",
];

/** Idle time before the bar folds into the circle. */
const IDLE_COLLAPSE_MS = 3000;

interface Props {
  nav: DashboardNav;
  pathname: string;
}

/**
 * One child link, as a full-width row. Full width is the point: a single column
 * leaves room for a label such as "Purchase Orders" in either language, where the
 * two-column grid had to cut it short. `active` is decided by NavItemLink.
 */
const itemClass = (active: boolean) =>
  "flex items-center rounded-xl px-3 py-3 text-sm font-medium transition " +
  (active
    ? "bg-blue-600 text-white"
    : "text-gray-300 hover:bg-gray-800 hover:text-white");

export default function MobileQuickNav({ nav, pathname }: Props) {
  const { t } = useTranslation();
  // Only the primary parents. A user who does not have one of them simply sees
  // fewer pills; a user with none sees no bar at all (platform admins).
  const groups = useMemo(() => primaryNavGroups(nav), [nav]);
  // Single-open, and nothing auto-opens: the bar starts with no child list shown.
  const { open, toggle, close, activeGroups } = useNavGroups(nav, pathname);

  // `expanded` is the bar itself (row vs circle); `openGroup` is the child list.
  const [expanded, setExpanded] = useState(true);
  // Bumped by every interaction, which restarts the idle timer.
  const [activity, setActivity] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastPathname = useRef(pathname);

  const openGroup = useMemo(
    () => groups.find((g) => open.has(g.key)) ?? null,
    [groups, open],
  );

  // The child list stays mounted so it can fade out, which means it needs content
  // to show while it does: keep the last group that was open ("adjust state during
  // a render" again, the same pattern the sidebar uses to auto-open a group).
  const [shownGroup, setShownGroup] = useState<DashboardNavGroup | null>(
    openGroup,
  );
  if (openGroup && shownGroup !== openGroup) setShownGroup(openGroup);

  // Following a link closes the child list and tucks the bar into the circle.
  const pick = useCallback(() => {
    close();
    setExpanded(false);
  }, [close]);

  // Fold the bar away when nothing happens for a while. An open child list pauses
  // this completely: the user is reading it, so the row has to stay where it is.
  useEffect(() => {
    if (!expanded || openGroup) return;
    const id = setTimeout(() => setExpanded(false), IDLE_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [expanded, openGroup, activity]);

  // The layout keeps this component mounted across route changes, so navigating
  // starts the bar over: closed child list, folded back into the circle.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    close();
    setExpanded(false);
  }, [pathname, close]);

  // Tapping anywhere else, or pressing Escape, closes the child list.
  useEffect(() => {
    if (!openGroup) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup, close]);

  if (groups.length === 0) return null;
  if (
    HIDDEN_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  )
    return null;

  return (
    <div
      ref={rootRef}
      onPointerDown={() => setActivity((n) => n + 1)}
      className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 md:hidden"
    >
      {/* Children of the open group, directly above the bar. Kept mounted so it can
          fade out; while closed it is inert, so nothing inside can be reached. */}
      {shownGroup && (
        <nav
          id="quick-nav-popover"
          aria-label={shownGroup.label}
          aria-hidden={!openGroup}
          inert={!openGroup}
          className={`absolute bottom-full left-0 right-0 mb-3 max-h-[60vh] origin-bottom overflow-y-auto overscroll-contain rounded-2xl border border-gray-700 bg-gray-900/95 shadow-2xl backdrop-blur motion-safe:transition-all duration-200 ease-out ${
            openGroup
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none translate-y-2 scale-95 opacity-0"
          }`}
        >
          {/* Stays in view while a long list scrolls under it. */}
          <p className="sticky top-0 border-b border-gray-800 bg-gray-900/95 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {shownGroup.label}
          </p>
          <div className="flex flex-col gap-0.5 p-2">
            {shownGroup.items.map((item) => (
              <NavItemLink
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigate={pick}
                className={itemClass}
              />
            ))}
          </div>
        </nav>
      )}

      {/* One surface for both states: it *is* the bar when wide and the circle when
          narrow, so the shape itself carries the transition instead of two boxes
          swapping places. Because it only ever grows or shrinks from the right, the
          pills can stay where they are and be revealed as it widens. The small
          radius is exactly half of the 3rem height, which is a circle, and being a
          real length it animates; `rounded-full` is an enormous value in v4, so it
          would stay round for the whole transition and snap on the last frame. */}
      <div
        className={`pointer-events-auto relative ml-auto h-12 overflow-hidden border border-gray-700 bg-gray-900/95 shadow-lg backdrop-blur motion-safe:transition-all duration-300 ease-out ${
          expanded ? "w-full rounded-2xl" : "w-12 rounded-[1.5rem]"
        }`}
      >
        {/* The bar: one pill per parent group. Fading in only once the surface is
            wide enough hides the pills being squeezed into the circle. */}
        <div
          inert={!expanded}
          aria-hidden={!expanded}
          className={`absolute inset-0 flex items-stretch gap-1 p-1 motion-safe:transition-opacity ${
            expanded
              ? "delay-100 duration-200 opacity-100"
              : "delay-0 duration-100 opacity-0"
          }`}
        >
          {groups.map((group) => {
            const isOpenGroup = openGroup?.key === group.key;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={isOpenGroup}
                aria-controls={isOpenGroup ? "quick-nav-popover" : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1.5 py-1.5 text-center text-[10px] font-medium leading-tight transition ${
                  isOpenGroup || activeGroups.includes(group.key)
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                {/* Two lines, so a long label such as "Sales & Payments" still fits. */}
                <span className="line-clamp-2 w-full">{group.label}</span>
              </button>
            );
          })}
        </div>

        {/* The circle: that same surface at its smallest, holding the menu icon and
            fading out only after it has grown past the icon. */}
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
          {/* Marks that the current page sits inside one of the groups. */}
          {activeGroups.length > 0 && (
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
