"use client";
// Shared filtering controls for list pages (car-wash and others). One wrapping
// card plus small labeled fields, so every page's filter bar looks and behaves
// the same on desktop and mobile.
import { type ReactNode } from "react";

const controlClass = "border border-gray-300 rounded p-2 text-sm";

export function ListFilters({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 flex flex-wrap gap-3 items-end">
      {children}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="text-sm text-gray-600">
      {label && <span className="mb-1 block">{label}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={controlClass}
      />
    </label>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  label,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  allLabel?: string;
}) {
  return (
    <label className="text-sm text-gray-600">
      {label && <span className="mb-1 block">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} bg-white`}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <label className="text-sm text-gray-600">
      {label && <span className="mb-1 block">{label}</span>}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
      />
    </label>
  );
}

export function CheckboxField({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600 self-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
