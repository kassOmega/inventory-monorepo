"use client";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { getVerticalFeatures } from "@/lib/verticals";
import { buildDashboardNav, routeFeatureMap, routePermissionMap } from "@/lib/dashboardNavigation";
import { User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmProvider } from "../components/ConfirmProvider";
import AiCoachDrawer from "../components/AiCoachDrawer";
import InstallAppButton from "../components/InstallAppButton";
import LanguageSwitcher from "../components/LanguageSwitcher";
import NotificationBell from "../components/NotificationBell";
import NotificationToast from "../components/NotificationToast";
import SidebarMenu from "../components/SidebarMenu";
import { ToastProvider } from "../components/ToastProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, isLoading, hasPermission, activeMembership, activeOrganizationId, switchOrganization } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [agentMode, setAgentMode] = useState<string | null>(null);
  const [agentPending, setAgentPending] = useState(0);
  const [stations, setStations] = useState<any[]>([]);

  const businessType = activeMembership?.businessType ?? user?.businessType ?? "";
  const vertical = getVerticalFeatures(businessType);
  const canUseCoach = user?.isSuperuser || hasPermission("ai.chat");
  const canManageAgent = user?.isSuperuser || hasPermission("agent.manage");

  // Load the agent mode + pending-approval count for the owner header toggle.
  useEffect(() => {
    if (!canManageAgent) return;
    api
      .get("/agent/config")
      .then((r) => setAgentMode(r.data?.mode ?? null))
      .catch(() => undefined);
    api
      .get("/agent/actions?status=PENDING_APPROVAL")
      .then((r) => setAgentPending(Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => undefined);
  }, [canManageAgent]);

  // Load the org's active stations so the nav lists them dynamically.
  useEffect(() => {
    const isHosp =
      (activeMembership?.businessType ?? user?.businessType) === "HOSPITALITY";
    const hasBiz = (user?.memberships?.length ?? 0) > 0;
    if (!isHosp || !hasBiz) {
      setStations([]);
      return;
    }
    api
      .get("/restaurant/stations")
      .then((r) => setStations(Array.isArray(r.data) ? r.data : []))
      .catch(() => setStations([]));
  }, [activeMembership, user, activeOrganizationId]);

  // Refetch stations when the menu page creates/edits/deletes one, so the
  // sidebar updates without a full page reload.
  useEffect(() => {
    const refresh = () => {
      const isHosp =
        (activeMembership?.businessType ?? user?.businessType) === "HOSPITALITY";
      if (!isHosp) return;
      api
        .get("/restaurant/stations")
        .then((r) => setStations(Array.isArray(r.data) ? r.data : []))
        .catch(() => undefined);
    };
    window.addEventListener("stations:changed", refresh);
    return () => window.removeEventListener("stations:changed", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMembership, user]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [user, isLoading, router]);

  // Redirect users away from routes their business type does not enable.
  useEffect(() => {
    const feature =
      routeFeatureMap[pathname] ??
      (pathname.startsWith("/dashboard/food/station")
        ? "pos"
        : undefined);
    if (!feature) return;
    if (feature === "inventory" && !vertical.inventory) {
      router.replace("/dashboard");
    } else if (feature === "retail" && !vertical.retail) {
      router.replace("/dashboard");
    } else if (feature === "pos" && !vertical.pos) {
      router.replace("/dashboard");
    } else if (feature === "rooms" && !vertical.rooms) {
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, vertical.inventory, vertical.retail, vertical.pos, vertical.rooms, router]);

  // Redirect users away from routes they lack the permission for.
  useEffect(() => {
    const stationMatch = pathname.match(/^\/dashboard\/food\/station\/([^/]+)$/);
    const isStationRoute = !!stationMatch;
    let required = routePermissionMap[pathname] ?? undefined;
    if (!required && stationMatch) {
      if (stations.length === 0) return; // station list still loading
      const st = stations.find((s) => s.key === stationMatch[1]);
      required = st?.permissionView ?? "kitchen.view";
    }
    if (!required || !user || isLoading) return;
    if (user.isSuperuser) return;
    // Managers can open any station board (matches the backend check).
    if (isStationRoute && user.permissions?.includes("restaurant.manage")) return;
    if (!user.permissions?.includes(required)) {
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user, isLoading, router, stations]);

  // Owners with no business yet are sent to create one. Unverified accounts
  // are handled by the verification redirect below (which wins), and
  // non-owner users never reach the businesses page.
  useEffect(() => {
    const ownerUnverified =
      user?.isOwnerAccount &&
      user.verificationStatus &&
      user.verificationStatus !== "APPROVED";
    if (
      !isLoading &&
      user &&
      !user.isPlatformAdmin &&
      user.isOwnerAccount &&
      !ownerUnverified &&
      (user.memberships?.length ?? 0) === 0 &&
      pathname !== "/dashboard/businesses"
    ) {
      router.replace("/dashboard/businesses");
    }
  }, [user, isLoading, pathname, router]);

  // Verification and "My Businesses" pages are owner-only. Staff / non-owner
  // accounts are sent back to the dashboard.
  useEffect(() => {
    if (isLoading || !user || user.isPlatformAdmin) return;
    if (
      !user.isOwnerAccount &&
      (pathname === "/dashboard/businesses" ||
        pathname === "/dashboard/verification")
    ) {
      router.replace("/dashboard");
    }
  }, [user, isLoading, pathname, router]);

  // Unverified accounts (owner account or active business not APPROVED) are
  // restricted to the verification page. Platform admins always bypass this.
  useEffect(() => {
    if (isLoading || !user || user.isPlatformAdmin) return;
    const userUnverified =
      user.isOwnerAccount &&
      user.verificationStatus &&
      user.verificationStatus !== "APPROVED";
    const orgUnverified =
      activeMembership?.verificationStatus &&
      activeMembership.verificationStatus !== "APPROVED";
    if (
      (userUnverified || orgUnverified) &&
      pathname !== "/dashboard/verification"
    ) {
      router.replace("/dashboard/verification");
    }
  }, [user, activeMembership, isLoading, pathname, router]);

  // Service / Manufacturing pages are only reachable for that industry.
  useEffect(() => {
    if (isLoading || !user || user.isPlatformAdmin) return;
    const type = activeMembership?.businessType ?? user.businessType ?? "";
    const isServiceRoute = pathname.startsWith("/dashboard/service");
    const isMfgRoute = pathname.startsWith("/dashboard/manufacturing");
    if ((isServiceRoute && type !== "SERVICE") || (isMfgRoute && type !== "MANUFACTURING")) {
      router.replace("/dashboard");
    }
  }, [pathname, user, activeMembership, isLoading, router]);
  if (isLoading || !user)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
            <p className="text-sm">{t("common.loading")}</p>
          </div>
      </div>
    );

  const hasBusiness = (user?.memberships?.length ?? 0) > 0;
  const isRetail = businessType === "RETAIL";
  const isHospitality = businessType === "HOSPITALITY";
  const isService = businessType === "SERVICE";
  const isManufacturing = businessType === "MANUFACTURING";
  // Owners + users with restaurant.manage can open any station board, so they
  // should see every station in the nav; station staff see only their own.
  const canViewAllStations = hasPermission("restaurant.manage");

  // Build the grouped navigation for this user (see lib/dashboardNavigation.ts).
  const dashboardNav = buildDashboardNav({
    isPlatformAdmin: !!user.isPlatformAdmin,
    isOwnerAccount: !!user.isOwnerAccount,
    hasBusiness,
    isRetail,
    isHospitality,
    isService,
    isManufacturing,
    hasFinance: !!vertical.finance,
    standalone: !!activeMembership?.standalone,
    staffCount: activeMembership?.staffCount ?? 0,
    canViewAllStations,
    stations: stations as any,
    hasPermission: (key: string) => hasPermission(key),
    t: (key: string) => t(key),
  });

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex h-screen bg-gray-100 overflow-hidden">
          {/* Persistent notification toast */}
          <NotificationToast />

          {/* Mobile Overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-30 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            ></div>
          )}

          {/* Sidebar */}
          <aside
            className={`w-64 bg-gray-900 text-white flex flex-col h-full fixed z-40 transition-transform shrink-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:static lg:translate-x-0`}
          >
            <div className="p-6 border-b border-gray-800">
              <div className="text-xl font-bold">
                {activeMembership?.organizationName ?? t("app.name")}
              </div>
              {(user.memberships?.length ?? 0) > 1 ? (
                <select
                  value={activeMembership?.organizationId ?? ""}
                  onChange={(e) => switchOrganization(Number(e.target.value))}
                  className="mt-2 w-full rounded bg-gray-800 text-gray-200 text-xs px-2 py-1.5 border border-gray-700 focus:outline-none"
                >
                  {(user.memberships ?? []).map((m) => (
                    <option key={m.organizationId} value={m.organizationId}>
                      {m.organizationName}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-xs text-gray-400">
                  {activeMembership?.organizationName ?? "—"}
                </p>
              )}
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
              <SidebarMenu
                nav={dashboardNav}
                pathname={pathname}
                onNavigate={() => setSidebarOpen(false)}
              />
            </nav>
            <div className="p-4 border-t border-gray-800">
              <Link
                href="/dashboard/profile"
                className="flex gap-2 items-center gap-2 mb-1"
              >
                <User className="h-8 w-8 text-gray-300 flex-shrink-0" />

                <div className="flex flex-col py-2">
                  <span className="text-sm font-semibold text-gray-300 hover:text-white transition truncate">
                    {user.name}
                  </span>

                  <p className="text-xs text-gray-400 mb-2">{user.roleName}</p>
                </div>
              </Link>
              <InstallAppButton />
              <button
                onClick={logout}
                className="w-full text-left text-sm py-2 px-4 rounded text-red-400 hover:bg-gray-800"
              >
                {t("nav.logout")}
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto h-full">
            {/* Top header bar — always visible */}
            <div className="sticky top-0 z-30 bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700 shadow-md">
              <div className="flex items-center justify-between px-4 py-2.5 max-w-7xl mx-auto">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden text-white p-2 rounded hover:bg-gray-700 transition"
                  aria-label={t("nav.openMenu")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>

                <div className="hidden lg:flex items-center gap-2.5">
                  {/* User avatar icon */}
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold shadow-inner">
                    {user.name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold text-white">
                      {user.name}
                    </p>
                    <p className="text-[11px] text-gray-400 font-medium">
                      {user.roleName}
                    </p>
                  </div>
                </div>

                {canManageAgent && agentMode && (
                  <div className="hidden sm:flex items-center gap-1.5 rounded-lg bg-gray-700/60 p-1">
                    <span className="text-[10px] text-gray-400 font-semibold px-1">
                      {t("agent.agent")}
                    </span>
                    <button
                      onClick={() => {
                        setAgentMode("ADVISORY");
                        api.patch("/agent/config", { mode: "ADVISORY" }).catch(() => undefined);
                      }}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition ${
                        agentMode === "ADVISORY"
                          ? "bg-gray-100 text-gray-900"
                          : "text-gray-300 hover:text-white"
                      }`}
                    >
                      {t("agent.advisory")}
                    </button>
                    <button
                      onClick={() => {
                        setAgentMode("AUTONOMOUS");
                        api.patch("/agent/config", { mode: "AUTONOMOUS" }).catch(() => undefined);
                      }}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition ${
                        agentMode === "AUTONOMOUS"
                          ? "bg-blue-500 text-white"
                          : "text-gray-300 hover:text-white"
                      }`}
                    >
                      ⚡ {t("agent.autonomous")}
                    </button>
                    {agentPending > 0 && (
                      <Link
                        href="/dashboard/agent"
                        className="relative flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-amber-200 px-1.5"
                        title={t("agent.pendingApprovals")}
                      >
                        🛑
                        <span className="bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px]">
                          {agentPending}
                        </span>
                      </Link>
                    )}
                  </div>
                )}

                {canUseCoach && (
                  <button
                    onClick={() => setCoachOpen(true)}
                    className="flex items-center gap-1.5 text-white text-sm font-medium px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 shadow transition"
                    aria-label={t("agent.openCoach")}
                  >
                    <span aria-hidden="true">🤖</span>
                    <span className="hidden sm:inline">{t("agent.aiCoach")}</span>
                  </button>
                )}

                <LanguageSwitcher />
                <NotificationBell />
              </div>
            </div>

            <div className="p-4 md:p-8 max-w-7xl mx-auto">{children}</div>
          </main>
        </div>

        <AiCoachDrawer open={coachOpen} onClose={() => setCoachOpen(false)} />
      </ConfirmProvider>
    </ToastProvider>
  );
}
