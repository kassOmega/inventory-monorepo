"use client";

// LanguageProvider — global UI-language state.
//
// The effective language is resolved in this order:
//   1. per-tenant preference saved on this device (ui.locale.tenant.<orgId>)
//   2. user profile preference (server-side, cross-device)
//   3. global device preference (ui.locale)
//   4. active tenant's defaultLanguage (Organization.defaultLanguage)
//   5. browser language
//   6. "en"
//
// Changing the language persists it to localStorage (global + active tenant),
// updates <html lang>, notifies i18next (re-rendering every translated view),
// and saves the preference to the user profile so it follows the user across
// devices. Backend requests automatically carry the locale via axios headers
// (see lib/api.ts), so localized entity data and error messages follow suit.
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import i18n from "@/lib/i18n";
import {
  Locale,
  STORAGE_KEY_GLOBAL,
  STORAGE_KEY_TENANT_PREFIX,
  SUPPORTED_LOCALES,
  normalizeLocale,
  setActiveLocale,
} from "@/lib/locale";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LanguageCtx = createContext<LanguageContextValue>({
  locale: "en",
  setLocale: () => undefined,
});

function storedLocale(key: string): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    if (v && SUPPORTED_LOCALES.includes(v as Locale)) return v as Locale;
  } catch {
    // ignore storage errors
  }
  return null;
}

function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return normalizeLocale(navigator.language);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading, activeMembership } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(() => {
    // Synchronous first paint: honor a saved global choice so Amharic users do
    // not see an English flash. Tenant/user refinement happens right after auth.
    return storedLocale(STORAGE_KEY_GLOBAL) ?? browserLocale();
  });

  const applyLocale = useCallback((l: Locale) => {
    setActiveLocale(l);
    setLocaleState(l);
    if (typeof document !== "undefined") {
      document.documentElement.lang = l;
    }
    if (i18n.language !== l && i18n.isInitialized) {
      i18n.changeLanguage(l);
    }
  }, []);

  // Re-resolve whenever the auth context settles / changes tenant or user.
  useEffect(() => {
    if (isLoading) return;
    let next: Locale | null = null;

    const orgId = activeMembership?.organizationId;
    if (orgId) {
      next = storedLocale(`${STORAGE_KEY_TENANT_PREFIX}${orgId}`);
    }
    if (!next && user?.preferredLanguage) {
      next = normalizeLocale(user.preferredLanguage);
    }
    if (!next) {
      next = storedLocale(STORAGE_KEY_GLOBAL);
    }
    if (!next && activeMembership?.defaultLanguage) {
      next = normalizeLocale(activeMembership.defaultLanguage);
    }
    if (!next) {
      next = browserLocale();
    }
    applyLocale(next);
  }, [isLoading, user, activeMembership, applyLocale]);

  const setLocale = useCallback(
    (l: Locale) => {
      try {
        localStorage.setItem(STORAGE_KEY_GLOBAL, l);
        const orgId = activeMembership?.organizationId;
        if (orgId) localStorage.setItem(`${STORAGE_KEY_TENANT_PREFIX}${orgId}`, l);
      } catch {
        // ignore storage errors
      }
      applyLocale(l);
      // Persist the user-level preference server-side when authenticated so the
      // choice follows the user across sessions and devices.
      if (user) {
        api
          .put("/auth/profile", { preferredLanguage: l })
          .then(() => undefined)
          .catch(() => undefined);
      }
    },
    [user, activeMembership, applyLocale],
  );

  return (
    <LanguageCtx.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageCtx.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageCtx);
}
