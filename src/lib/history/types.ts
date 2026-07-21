/**
 * Shared history types — used by the client cache, the provider, and the server
 * store, so they all agree on the shape of an index row and a wire entry.
 */

/** One row in the history list — small, self-contained, safe to keep many of. */
export interface HistoryEntry {
  /** Stable client id; also the snapshot key and the restore key. */
  id: string;
  /** The opening prompt (truncated) — the list's primary label. */
  title: string;
  /** Second line: latest prompt or a product/message count. */
  subtitle: string;
  /** Lens the search ran under, for the badge. */
  lens: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO — bumped on each follow-up turn
  turnCount: number;
  productCount: number;
  thumbnailUrl: string | null;
}

/** An index row plus its full (opaque) snapshot — the migration payload shape. */
export interface HistoryRecord {
  entry: HistoryEntry;
  snapshot: unknown;
}
