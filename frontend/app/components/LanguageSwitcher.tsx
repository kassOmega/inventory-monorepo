"use client";

// Global top-bar language switcher (🇪🇹 አማርኛ / 🇬🇧 English).
// Renders a pill showing the flag of the language you can switch TO, so the
// action is unambiguous at a glance.
import { useLanguage } from "@/context/LanguageContext";
import { LOCALE_FLAGS } from "@/lib/locale";

export default function LanguageSwitcher({
  className = "",
  variant = "dark",
}: {
  className?: string;
  variant?: "dark" | "light";
}) {
  const { locale, setLocale } = useLanguage();
  const target = locale === "am" ? "en" : "am";
  const label =
    target === "am" ? "አማርኛ" : "English";
  const title =
    target === "am"
      ? "ወደ አማርኛ ቀይር"
      : "Switch to English";

  const tone =
    variant === "dark"
      ? "bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700 hover:text-white"
      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={() => setLocale(target)}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tone} ${className}`}
    >
      <span aria-hidden="true">{LOCALE_FLAGS[target]}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
