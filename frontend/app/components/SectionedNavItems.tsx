"use client";
// Renders a group's nav items, inserting a small uppercase sub-header whenever
// an item declares a new `section`. Shared by the sidebar and the mobile quick
// nav so both surfaces show the same sub-grouped layout (e.g. the Car Wash group
// is split into Bookings / Washes / Reports / Settings / …).
import { type ReactNode } from "react";
import NavItemLink from "./NavItemLink";
import { type DashboardNavItem } from "@/lib/dashboardNavigation";

interface Props {
  items: DashboardNavItem[];
  pathname: string;
  className: string | ((active: boolean) => string);
  headerClass: string;
  onNavigate?: () => void;
}

export default function SectionedNavItems({
  items,
  pathname,
  className,
  headerClass,
  onNavigate,
}: Props) {
  const nodes: ReactNode[] = [];
  let lastSection: string | undefined;
  for (const item of items) {
    if (item.section && item.section !== lastSection) {
      nodes.push(
        <p key={`section-${item.section}`} className={headerClass}>
          {item.section}
        </p>,
      );
    }
    nodes.push(
      <NavItemLink
        key={item.href}
        item={item}
        pathname={pathname}
        className={className}
        onNavigate={onNavigate}
      />,
    );
    lastSection = item.section;
  }
  return <>{nodes}</>;
}
