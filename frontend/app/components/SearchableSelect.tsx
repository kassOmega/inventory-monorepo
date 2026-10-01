"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SearchableOption {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /**
   * Optional: report the text as it is typed. Lets a caller drive a server-side
   * search from the same box the user picks results from, instead of adding a
   * second input next to this one.
   */
  onInputChange?: (query: string) => void;
  /**
   * Optional: show a small ✕ inside the field that empties it (the typed text and
   * the selected label) so a fresh search can be typed straight away. It is a pure
   * field clear — `onChange` is not called and the selected value is untouched.
   */
  clearable?: boolean;
  /** Tooltip for that ✕, so callers can pass a translated label. */
  clearLabel?: string;
}

/**
 * Searchable dropdown / autocomplete select. Replaces a plain <select> with a
 * text input that filters options as you type and shows a dropdown list.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  required = false,
  className = "",
  onInputChange,
  clearable = false,
  clearLabel,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const ph = placeholder ?? t("common.select");
  const clearTitle = clearLabel ?? t("common.clear");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** True while the field has been emptied by hand (display-only, not the value). */
  const [cleared, setCleared] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = options.filter(
    (o) =>
      !o.disabled &&
      (o.searchText ?? o.label).toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (selected && !open) setQuery(selected.label);
    setCleared(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : cleared ? "" : (selected?.label ?? "")}
        placeholder={ph}
        disabled={disabled}
        required={required}
        onFocus={() => {
          setCleared(false);
          setQuery(selected?.label ?? "");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onInputChange?.(e.target.value);
        }}
        className={`border p-2 rounded-lg w-full bg-white text-sm ${
          clearable ? "pr-8" : ""
        }`}
      />
      {clearable &&
        !disabled &&
        (open ? query : cleared ? "" : (selected?.label ?? "")) !== "" && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={clearTitle}
            title={clearTitle}
            // preventDefault keeps the click from blurring the input or tripping
            // the outside-click handler before it lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // Empty the field so a fresh search can be typed at once. The value
              // itself is untouched: onChange is deliberately not called.
              setCleared(true);
              setQuery("");
              setOpen(true);
              onInputChange?.("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-base leading-none px-1"
          >
            ✕
          </button>
        )}
      {open && (
        <ul className="absolute z-40 w-full mt-1 max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-400">{t("common.noResults")}</li>
          )}
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setQuery(o.label);
                  setOpen(false);
                  setCleared(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
