import { badRequest } from './errors.js';

/**
 * Parses page/pageSize/sort/order from a query string.
 * `sortMap` is an allowlist of { apiField: 'SQL column expression' } — user input never reaches SQL directly.
 */
export function parseListQuery(query, sortMap, defaultSort) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  const sortKey = query.sort ?? defaultSort;
  if (!Object.prototype.hasOwnProperty.call(sortMap, sortKey)) {
    throw badRequest(`Invalid sort field. Allowed: ${Object.keys(sortMap).join(', ')}`);
  }
  const order = String(query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    orderBy: `${sortMap[sortKey]} ${order}`,
    sort: sortKey,
    order: order.toLowerCase(),
  };
}

export const pageMeta = (lq, total) => ({
  page: lq.page,
  pageSize: lq.pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / lq.pageSize)),
});
