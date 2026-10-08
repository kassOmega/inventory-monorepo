"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
   * Optional: accepted for backward compatibility. The clear (X) button now
   * always shows when the field has typed text or a selected value (Option B),
   * so this prop no longer gates its visibility. `clearLabel` customises the
   * button's tooltip/aria-label.
   */
  clearable?: boolean;
  /** Tooltip for the clear (X) button, so callers can pass a translated label. */
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
  // `clearable` is accepted for backward compatibility but no longer gates the
  // clear button (it always shows per Option B).
  clearable: _clearable,
  clearLabel,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const ph = placeholder ?? t("common.select");
  const clearTitle = clearLabel ?? t("common.clear");
  // Defensive default: a page that passes `undefined` options must not crash the
  // whole route.
  const opts = options ?? [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** True while the field has been emptied by hand (display-only, not the value). */
  const [cleared, setCleared] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = opts.find((o) => o.value === value);

  const filtered = opts.filter(
    (o) =>
      !o.disabled &&
      (o.searchText ?? o.label).toLowerCase().includes(query.toLowerCase()),
  );

  // The displayed text: the typed query while open, otherwise the selected label
  // (or empty when cleared by hand).
  const display = open ? query : cleared ? "" : (selected?.label ?? "");
  // Option B: show the clear (X) when the field has typed text OR a selection.
  const showClear = !disabled && (query.trim() !== "" || value !== "");

  const clearField = () => {
    // Full reset of this field: drop the typed text and release the selection,
    // keep the dropdown open so the option list resets, and refocus for a fresh
    // search. onInputChange lets a server-driven search reset too.
    setCleared(false);
    setQuery("");
    setOpen(true);
    if (value !== "") onChange("");
    onInputChange?.("");
    inputRef.current?.focus();
  };

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
        value={display}
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
        className={`border p-2 rounded-lg w-full bg-white text-sm pr-8`}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={clearTitle}
          title={clearTitle}
          // preventDefault keeps the click from blurring the input or tripping
          // the outside-click handler; stopPropagation keeps it from reaching a
          // dropdown item / closing the menu first.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            clearField();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 flex items-center justify-center p-0.5"
        >
          <X size={14} aria-hidden />
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
