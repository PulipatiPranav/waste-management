/**
 * Cursor pagination is the default across the API.
 *
 * Offset pagination drifts when rows are inserted mid-scroll, which matters for
 * the append-only ledgers and delivery runs this platform is built around: an
 * ops agent paging through a wallet history must not see a row twice or skip one.
 */
export interface CursorPageRequest {
  /** Opaque cursor from the previous page's `nextCursor`. Omit for the first page. */
  cursor?: string;
  /** Server clamps this to its own maximum. */
  limit?: number;
}

export interface CursorPage<T> {
  items: T[];
  /** `null` when this is the last page. */
  nextCursor: string | null;
  hasMore: boolean;
}
