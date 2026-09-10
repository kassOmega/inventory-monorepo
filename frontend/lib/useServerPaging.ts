"use client";

import { useEffect, useState } from "react";

/**
 * Server-side paging state: tracks page/pageSize + the server-reported total.
 * Pages fetch their own rows; this hook only manages paging parameters and the
 * derived values the <Pagination> component renders. Pass a `resetKey` (the
 * current filter/search signature) so any filter change returns to page 1.
 */
export default function useServerPaging(options?: {
  pageSize?: number;
  resetKey?: unknown;
}) {
  const pageSizeInit = options?.pageSize ?? 20;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSizeInit);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [options?.resetKey]);

  const totalPages = Math.max(1, Math.ceil(total / size));
  return {
    page,
    pageSize: size,
    total,
    totalPages,
    setPage,
    setTotal,
    setPageSize: (s: number) => {
      setSize(Math.max(1, s));
      setPage(1);
    },
    next: () => setPage((p) => Math.min(totalPages, p + 1)),
    prev: () => setPage((p) => Math.max(1, p - 1)),
    rangeStart: total === 0 ? 0 : (page - 1) * size + 1,
    rangeEnd: Math.min(page * size, total),
  };
}
