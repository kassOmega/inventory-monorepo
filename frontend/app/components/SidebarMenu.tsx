"use client";
// Expandable/collapsible group menu for the dashboard sidebar.
// Groups that contain the active route auto-expand; users can also toggle any
// group manually. Links not assigned to a group yet render flat underneath.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DashboardNav } from "@/lib/dashboardNavigation";

interface Props {
  nav: DashboardNav;
  pathname: string;
  onNavigate: () => void;
}

function isActive(href: string, pathname: string): boolean {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href + "/"))
  );
}

export default function SidebarMenu({ nav, pathname, onNavigate }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const g of nav.groups) {
      if (g.items.some((i) => isActive(i.href, pathname))) initial.add(g.key);
    }
    return initial;
  });

  // Keep the group containing the active page open across navigation.
  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      for (const g of nav.groups) {
        if (g.items.some((i) => isActive(i.href, pathname))) next.add(g.key);
      }
      return next;
    });
  }, [pathname, nav]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const linkClass = (href: string) =>
    "block py-2 px-3 rounded text-sm font-medium transition " +
    (isActive(href, pathname)
      ? "bg-blue-600 text-white"
      : "text-gray-300 hover:bg-gray-800 hover:text-white");

  return (
    <>
      {nav.groups.map((group) => {
        // Flat groups render their links directly (no header, no toggle).
        if (group.flat) {
          return (
            <div key={group.key} className="space-y-0.5 pt-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={linkClass(item.href)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          );
        }
        const expanded = open.has(group.key);
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
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={linkClass(item.href)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {nav.loose.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={linkClass(item.href)}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}
