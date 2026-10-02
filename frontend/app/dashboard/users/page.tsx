"use client";

// Consolidated Users & Roles surface. User accounts and role/permission
// management used to be two dashboard pages behind two nav entries; they are
// now two tabs of this page, so `/dashboard/roles` can redirect here
// (`?tab=roles` — see next.config.ts).
//
// The page reads `?tab=`, so the inner component lives behind a Suspense
// boundary. The backend treats the two surfaces as independent permissions
// (`users.*` vs `roles.*`), so every tab is filtered by its own key and the
// container falls back to the first permitted tab when the URL asks for a tab
// the user cannot see.

import Loading from "@/app/components/Loading";
import { useAuth } from "@/context/AuthContext";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Suspense, useEffect, useState } from "react";
import RolesPanel from "./roles-panel";
import UsersPanel from "./users-panel";

function UsersRolesTabs() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "users");

  // `roles.manage` is the only role key (the backend also answers /roles to
  // users.view | users.manage so the user table can label roles).
  const tabs = [
    {
      id: "users",
      label: t("nav.users"),
      permissions: ["users.view", "users.manage"],
    },
    { id: "roles", label: t("nav.rolesPermissions"), permissions: ["roles.manage"] },
  ].filter((tabDef) => tabDef.permissions.some((key) => hasPermission(key)));

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((tabDef) => tabDef.id === tab)) {
      setTab(tabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, tab]);

  return (
    <div>
      <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-6">
        {t("nav.usersAndRoles")}
      </h1>

      {/* Tabs */}
      <div className="flex gap-0.5 sm:gap-1 mb-6 border-b overflow-x-auto pb-px">
        {tabs.map((tabDef) => (
          <button
            key={tabDef.id}
            onClick={() => setTab(tabDef.id)}
            className={`px-2.5 sm:px-4 py-2 sm:py-2.5 whitespace-nowrap text-xs sm:text-sm font-medium rounded-t-lg transition ${
              tab === tabDef.id
                ? "bg-white text-blue-600 border border-b-white -mb-px shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            {tabDef.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersPanel />}
      {tab === "roles" && <RolesPanel />}

      {/* Defensive only: the route guard already redirects anyone who holds
          none of the three keys (superusers always pass hasPermission). */}
      {tabs.length === 0 && (
        <div className="p-8 text-gray-500">{t("errors.noPermission")}</div>
      )}
    </div>
  );
}

export default function UsersRolesPage() {
  return (
    <Suspense fallback={<Loading className="py-24" />}>
      <UsersRolesTabs />
    </Suspense>
  );
}
