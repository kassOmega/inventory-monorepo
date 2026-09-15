"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import api from "@/lib/api";

export interface Membership {
  organizationId: number;
  organizationName: string;
  businessType: string;
  roleId: number | null;
  roleName: string | null;
  isSystem: boolean;
  aiEnabled?: boolean;
  aiTrialEndsAt?: string | null;
  verificationStatus?: string;
  standalone?: boolean;
  /** Tenant's primary UI language (Organization.defaultLanguage). */
  defaultLanguage?: string | null;
  /** Non-owner (staff) members in the org. 0 → owner-only business. */
  staffCount?: number;
}

export interface User {
  id: number;
  email: string;
  name: string;
  roleId: number | null;
  roleName: string | null;
  isSuperuser: boolean;
  isPlatformAdmin?: boolean;
  isOwnerAccount?: boolean;
  permissions: string[];
  locationId: number | null;
  locationType: "SHOP" | "STORE" | null;
  organizationId?: number | null;
  businessType?: string | null;
  memberships?: Membership[];
  verificationStatus?: string;
  verificationNote?: string | null;
  verificationAttempts?: number;
  /** User-level UI language preference persisted server-side. */
  preferredLanguage?: string | null;
}

interface AuthContextType {
  user: User | null;
  activeOrganizationId: number | null;
  activeMembership: Membership | null;
  login: (token: string, userData: User) => void;
  logout: () => void;
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
  switchOrganization: (organizationId: number) => void;
  refreshUser: () => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ORG_STORAGE_KEY = "activeOrganizationId";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<number | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        // Only restore if the stored user has the new permission shape;
        // otherwise force a fresh login (older tokens/sessions are stale).
        if (Array.isArray(parsed?.permissions)) {
          setUser(parsed);
          const storedOrg = localStorage.getItem(ORG_STORAGE_KEY);
          setActiveOrganizationId(
            storedOrg
              ? Number(storedOrg)
              : parsed?.organizationId ??
                  parsed?.memberships?.[0]?.organizationId ??
                  null,
          );
        } else {
          localStorage.removeItem("user");
          localStorage.removeItem("token");
        }
      } catch {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
      }
    }
    // Refresh the current user + permissions from the server so role/permission
    // changes take effect without requiring a re-login.
    api
      .get("/auth/me")
      .then((res) => {
        localStorage.setItem("user", JSON.stringify(res.data));
        setUser(res.data);
        setActiveOrganizationId((prev) => {
          const valid =
            prev &&
            res.data?.memberships?.some(
              (m: Membership) => m.organizationId === prev,
            )
              ? prev
              : res.data?.organizationId ??
                res.data?.memberships?.[0]?.organizationId ??
                null;
          if (valid) localStorage.setItem(ORG_STORAGE_KEY, String(valid));
          return valid;
        });
      })
      .catch((err: any) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem("user");
          localStorage.removeItem("token");
          localStorage.removeItem(ORG_STORAGE_KEY);
          setUser(null);
          setActiveOrganizationId(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = (token: string, userData: User) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
    const orgId =
      userData.organizationId ??
      userData.memberships?.[0]?.organizationId ??
      null;
    setActiveOrganizationId(orgId);
    // A new account must never inherit the previous account's active business:
    // an account without one (platform admin, brand-new signup) would otherwise
    // keep sending the old id as X-Tenant-Id and every request would answer 403
    // "You are not a member of this organization".
    if (orgId) localStorage.setItem(ORG_STORAGE_KEY, String(orgId));
    else localStorage.removeItem(ORG_STORAGE_KEY);
    router.push("/dashboard");
  };

  const logout = () => {
    // JwtStrategy prefers the HttpOnly access_token cookie over the Bearer
    // header, so clear it server-side as well (best-effort — the redirect below
    // navigates immediately).
    api.post("/auth/logout").catch(() => undefined);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem(ORG_STORAGE_KEY);
    setUser(null);
    setActiveOrganizationId(null);
    // Full page navigation so the dashboard layout (and its loading screen)
    // unmounts immediately instead of flashing while the client router swaps.
    window.location.href = "/login";
  };

  const switchOrganization = (organizationId: number) => {
    if (!user?.memberships?.some((m) => m.organizationId === organizationId)) {
      return;
    }
    setActiveOrganizationId(organizationId);
    localStorage.setItem(ORG_STORAGE_KEY, String(organizationId));
    // Force a refresh so views pick up the new tenant context.
    router.refresh();
  };

  const refreshUser = async (): Promise<User> => {
    const res = await api.get("/auth/me");
    localStorage.setItem("user", JSON.stringify(res.data));
    setUser(res.data);
    setActiveOrganizationId((prev) => {
      const valid =
        prev && res.data?.memberships?.some((m: Membership) => m.organizationId === prev)
          ? prev
          : res.data?.organizationId ?? res.data?.memberships?.[0]?.organizationId ?? null;
      if (valid) localStorage.setItem(ORG_STORAGE_KEY, String(valid));
      return valid;
    });
    return res.data;
  };

  const hasPermission = (key: string) => {
    if (!user) return false;
    // Platform admins are NOT granted business permissions here — the backend
    // PermissionsGuard deliberately keeps business modules owner-only. Admin
    // pages are gated by `user.isPlatformAdmin` directly, not by permissions.
    // Unverified accounts are limited to verification actions only. User-level
    // verification applies to owner accounts; staff are covered by the business.
    if (
      user.isOwnerAccount &&
      user.verificationStatus &&
      user.verificationStatus !== "APPROVED"
    ) {
      return false;
    }
    if (
      activeMembership?.verificationStatus &&
      activeMembership.verificationStatus !== "APPROVED"
    ) {
      return false;
    }
    if (user.isSuperuser) return true;
    return user.permissions.includes(key);
  };

  const activeMembership =
    user?.memberships?.find((m) => m.organizationId === activeOrganizationId) ??
    user?.memberships?.[0] ??
    null;

  return (
    <AuthContext.Provider
      value={{
        user,
        activeOrganizationId,
        activeMembership,
        login,
        logout,
        isLoading,
        hasPermission,
        switchOrganization,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
