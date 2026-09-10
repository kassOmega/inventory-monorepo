"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination over an already-loaded array. Resets to page 1
 * whenever `resetKey` changes (e.g. the current search/filter/status string),
 * and clamps the page when rows shrink (filters narrow the list).
 */
export default function usePagedRows<T>(
  rows: T[],
  options?: { resetKey?: unknown; pageSize?: number },
) {
  const { resetKey, pageSize = 20 } = options ?? {};
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, totalPages);

  const pageRows = useMemo(
    () => rows.slice((current - 1) * size, current * size),
    [rows, current, size],
  );

  const go = (p: number) =>
    setPage(Math.min(Math.max(1, p), Math.max(1, totalPages)));

  return {
    pageRows,
    total,
    page: current,
    totalPages,
    pageSize: size,
    setPageSize: (s: number) => {
      setSize(Math.max(1, s));
      setPage(1);
    },
    setPage: go,
    next: () => go(current + 1),
    prev: () => go(current - 1),
    rangeStart: total === 0 ? 0 : (current - 1) * size + 1,
    rangeEnd: Math.min(current * size, total),
  };
}
