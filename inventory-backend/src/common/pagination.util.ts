// src/common/pagination.util.ts
// Shared list-pagination helpers. Endpoints that pass ?page= return the paged
// envelope { data, total, page, pageSize }; callers that omit `page` keep
// getting the legacy bare array (selects, lookups, search pickers).
export interface Paging {
  page: number;
  pageSize: number;
  enabled: boolean;
}

export function parsePaging(query: Record<string, unknown>): Paging {
  const rawPage = Number(query?.page);
  const rawSize = Number(query?.pageSize);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, 100) : 20;
  const enabled = query?.page !== undefined && query?.page !== '';
  return { page, pageSize, enabled };
}

export function pagedResult<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): { data: T[]; total: number; page: number; pageSize: number } {
  return { data, total, page, pageSize };
}
