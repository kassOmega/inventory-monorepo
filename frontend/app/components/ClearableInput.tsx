"use client";

// A plain search <input> with an inline clear (X) button. Used by the filter
// boxes that type-to-filter a list (products, customers, credits, …) so every
// search field in the UI clears the same way.
//
// Visibility (Option B): the X shows whenever the field is non-empty. Clicking
// it empties the value, refocuses the input and stops event propagation so it
// never trips a surrounding click handler.
import { useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ClearableInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
}

export default function ClearableInput({
  value,
  onChange,
  placeholder,
  label,
  className = "",
  inputClassName = "border p-2 rounded-lg flex-1 text-sm",
  autoFocus,
  disabled,
  onKeyDown,
  "aria-label": ariaLabel,
}: ClearableInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <div className={`relative ${label ? "" : className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClassName} pr-8`}
      />
      {value !== "" && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("common.clear")}
          title={t("common.clear")}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 flex items-center justify-center p-0.5"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );

  if (!label) return input;
  return (
    <label className={`text-sm text-gray-600 ${className}`}>
      <span className="mb-1 block">{label}</span>
      {input}
    </label>
  );
}
