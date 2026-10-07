"use client";
// Expandable/collapsible group menu for the dashboard sidebar.
// Groups that contain the active route auto-expand; users can also toggle any
// group manually. Links not assigned to a group yet render flat underneath.
// The open-group state machine, the active-route check and the leaf link are
// shared with the mobile quick nav (lib/useNavGroups.ts, NavItemLink.tsx).
import NavItemLink from "./NavItemLink";
import SectionedNavItems from "./SectionedNavItems";
import { type DashboardNav } from "@/lib/dashboardNavigation";
import useNavGroups from "@/lib/useNavGroups";

interface Props {
  nav: DashboardNav;
  pathname: string;
  onNavigate: () => void;
}

/** Sidebar link styling; the item's active state is decided by NavItemLink. */
const linkClass = (active: boolean) =>
  "block py-2 px-3 rounded text-sm font-medium transition " +
  (active
    ? "bg-blue-600 text-white"
    : "text-gray-300 hover:bg-gray-800 hover:text-white");

const sectionHeaderClass =
  "px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500";

export default function SidebarMenu({ nav, pathname, onNavigate }: Props) {
  // Several groups may stay open at once, and the active one opens itself.
  const { isOpen, toggle } = useNavGroups(nav, pathname, {
    multiple: true,
    autoOpenActive: true,
  });

  return (
    <>
      {nav.groups.map((group) => {
        // Flat groups render their links directly (no header, no toggle).
        if (group.flat) {
          return (
            <div key={group.key} className="space-y-0.5 pt-0.5">
              <SectionedNavItems
                items={group.items}
                pathname={pathname}
                onNavigate={onNavigate}
                className={linkClass}
                headerClass={sectionHeaderClass}
              />
            </div>
          );
        }
        const expanded = isOpen(group.key);
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={expanded}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition"
            >
              <span>{group.label}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={
                  "h-4 w-4 flex-shrink-0 transition-transform " +
                  (expanded ? "rotate-180" : "")
                }
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {expanded && (
              <div className="ml-3 mt-0.5 mb-1 border-l border-gray-700 pl-2 space-y-0.5">
                <SectionedNavItems
                  items={group.items}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  className={linkClass}
                  headerClass={sectionHeaderClass}
                />
              </div>
            )}
          </div>
        );
      })}

      {nav.loose.map((item) => (
        <NavItemLink
          key={item.href}
          item={item}
          pathname={pathname}
          onNavigate={onNavigate}
          className={linkClass}
        />
      ))}
    </>
  );
}
