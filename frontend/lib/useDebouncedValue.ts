"use client";
// Debounce a rapidly-changing value (typically a filter search box) so the
// derived fetch runs a beat after the user stops typing instead of on every
// keystroke. The input itself stays instant — only the value used to build the
// request is delayed.
import { useEffect, useState } from "react";

export default function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
