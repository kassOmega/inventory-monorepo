"use client";

// Shared page/action permission gate.
//
// Usage:
//   <RequirePermission permission="carwash.washes.view">…</RequirePermission>
//   <RequirePermission anyOf={["a.view","a.manage"]} redirect>…</RequirePermission>
//
// Renders `children` only when the current user holds the required permission
// (owner/superuser always passes, mirroring `hasPermission`). Otherwise it shows
// a friendly "no permission" panel — and, when `redirect` is set, sends the user
// back to the dashboard instead of leaving them on a page they cannot use.
import { type ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";

interface RequirePermissionProps {
  /** A single permission key, or several (any-of). */
  permission?: string | string[];
  /** Alias for `permission` that reads better for multi-key gates. */
  anyOf?: string | string[];
  /** When true, redirect to /dashboard instead of rendering the panel. */
  redirect?: boolean;
  /** Optional fallback to render instead of the default panel. */
  fallback?: ReactNode;
  children: ReactNode;
}

export function useHasAnyPermission(permission?: string | string[]): boolean {
  const { hasPermission } = useAuth();
  const keys = Array.isArray(permission) ? permission : permission ? [permission] : [];
  if (keys.length === 0) return true;
  return keys.some((k) => hasPermission(k));
}

export default function RequirePermission({
  permission,
  anyOf,
  redirect = false,
  fallback,
  children,
}: RequirePermissionProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const allowed = useHasAnyPermission(anyOf ?? permission);

  useEffect(() => {
    if (!allowed && redirect) router.replace("/dashboard");
  }, [allowed, redirect, router]);

  if (allowed) return <>{children}</>;
  if (redirect) return null;
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <div className="p-8">
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-500">{t("errors.noPermission")}</p>
      </div>
    </div>
  );
}
