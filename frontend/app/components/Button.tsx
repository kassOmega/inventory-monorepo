"use client";
// Shared button. The single place that renders a button's busy state, so every
// async action disables + shows a spinner the same way.
//
// Visual parity: the `variant`/`size`/`shape` classes below reproduce the exact
// Tailwind strings already used across the app (biggest clusters: `bg-blue-600
// text-white px-4 py-2 rounded-lg text-sm`, `... rounded ...`, danger/gray
// variants). Defaults match the most common primary button, so swapping a raw
// <button> for <Button> does not change how it looks — only adds loading.
//
// `className` is appended last, so a caller can always override/extend styling
// (e.g. `w-full`, `whitespace-nowrap`) exactly as today.
import Loading from "./Loading";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "dark" | "emerald";
type Size = "sm" | "md";
type Shape = "rounded" | "rounded-lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Show a spinner and disable the button while the action runs. */
  loading?: boolean;
  variant?: Variant;
  size?: Size;
  /** Corner style: `rounded` (compact/older) or `rounded-lg` (newer default). */
  shape?: Shape;
  /** Class shown on the inline spinner (color must contrast the variant). */
  spinnerClassName?: string;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-gray-200 text-gray-700 hover:bg-gray-300",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-gray-600 hover:bg-gray-100",
  dark: "bg-gray-800 text-white hover:bg-gray-900",
  emerald: "bg-emerald-600 text-white hover:bg-emerald-700",
};

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs font-medium",
  md: "px-4 py-2 text-sm font-medium",
};

const SPINNER: Record<Variant, string> = {
  primary: "border-white/40 border-t-white",
  secondary: "border-gray-400/40 border-t-gray-600",
  danger: "border-white/40 border-t-white",
  ghost: "border-gray-300 border-t-gray-600",
  dark: "border-white/40 border-t-white",
  emerald: "border-white/40 border-t-white",
};

export default function Button({
  loading = false,
  variant = "primary",
  size = "md",
  shape = "rounded-lg",
  spinnerClassName,
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed ${shape} ${SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <Loading size="sm" className={spinnerClassName ?? SPINNER[variant]} />
      )}
      {children}
    </button>
  );
}
