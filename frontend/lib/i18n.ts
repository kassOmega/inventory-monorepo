// Global i18next instance for the frontend.
//
// Catalogs are bundled statically (en + am). The active language is controlled
// by <LanguageProvider> (context/LanguageContext.tsx), which resolves the
// effective locale from: per-tenant device preference → global device
// preference → user profile preference → tenant defaultLanguage → browser.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/common.json";
import am from "./locales/am/common.json";

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: { en: { common: en }, am: { common: am } },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnEmptyString: false,
  });
}

export default i18n;