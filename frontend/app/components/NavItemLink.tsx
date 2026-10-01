"use client";
// One leaf of a dashboard menu: a single nav item rendered as a link, highlighted
// when the current route is that item's page. Shared by the sidebar and the mobile
// quick nav so both agree on what "active" means (isNavItemActive, which also
// covers the extra tab routes a menu item can declare via `match`) — each surface
// only supplies its own class names.
import Link from "next/link";
import {
  isNavItemActive,
  type DashboardNavItem,
} from "@/lib/dashboardNavigation";

interface Props {
  item: DashboardNavItem;
  pathname: string;
  /** Fixed class string, or a function of the item's active state. */
  className: string | ((active: boolean) => string);
  /** Called after the link is followed (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
}

export default function NavItemLink({
  item,
  pathname,
  className,
  onNavigate,
}: Props) {
  const active = isNavItemActive(item, pathname);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={typeof className === "function" ? className(active) : className}
    >
      {item.label}
    </Link>
  );
}
