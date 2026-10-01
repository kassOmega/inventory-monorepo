"use client";
// Which dashboard nav groups are open, shared by the sidebar and the mobile quick
// nav. Both need the same two things — the group holding the current page (to open
// it, or to highlight it) and a way to toggle a group — and differ only in whether
// several groups may be open at once.
//
// `multiple: true` keeps the sidebar's behaviour (groups stay open while you
// browse); the default opens one group at a time, which is what the mobile
// popover over the quick nav wants.
import { useCallback, useMemo, useState } from "react";
import { activeNavGroupKeys, type DashboardNav } from "./dashboardNavigation";

export default function useNavGroups(
  nav: DashboardNav,
  pathname: string,
  options?: { multiple?: boolean; autoOpenActive?: boolean },
) {
  const { multiple = false, autoOpenActive = false } = options ?? {};

  // Groups containing the current page. The sidebar opens them, the mobile bar
  // highlights them, so both read the same list.
  const activeGroups = useMemo(
    () => activeNavGroupKeys(nav, pathname),
    [nav, pathname],
  );

  const [open, setOpen] = useState<Set<string>>(
    () => new Set(autoOpenActive ? activeGroups : []),
  );

  // Keep the group holding the active page open across navigation, without
  // closing whatever the user opened themselves. This is React's "adjust state
  // when a prop changes" pattern rather than an effect: the freshly active group
  // is already open on the first paint, and there is no second render pass. The
  // effect version of this lived in SidebarMenu and tripped
  // react-hooks/set-state-in-effect.
  const [syncedGroups, setSyncedGroups] = useState(activeGroups);
  if (syncedGroups !== activeGroups) {
    setSyncedGroups(activeGroups);
    if (autoOpenActive) {
      const missing = activeGroups.filter((key) => !open.has(key));
      if (missing.length > 0) setOpen(new Set([...open, ...missing]));
    }
  }

  const toggle = useCallback(
    (key: string) =>
      setOpen((prev) => {
        if (multiple) {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }
        // Single-open surface: tapping the open group closes it again.
        return prev.has(key) ? new Set<string>() : new Set([key]);
      }),
    [multiple],
  );

  const close = useCallback(
    () => setOpen((prev) => (prev.size === 0 ? prev : new Set<string>())),
    [],
  );

  const isOpen = useCallback((key: string) => open.has(key), [open]);

  return { open, isOpen, toggle, close, activeGroups };
}
