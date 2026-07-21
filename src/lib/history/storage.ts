/**
 * Search history — client-only persistence in localStorage.
 *
 * Phase 1: device-local. Two layers so opening the menu never parses megabytes:
 *   - a small INDEX (one lightweight row per past search) for the list UI, and
 *   - one SNAPSHOT per search (the full chat + board), loaded only on restore.
 *
 * Entries are capped (LRU by `updatedAt`) so a long-lived browser can't blow
 * past the ~5MB localStorage ceiling. Everything is best-effort: blocked or
 * corrupted storage degrades to "no history", never throws into the UI.
 */

const INDEX_KEY = "giftlens.history.index";
const ITEM_PREFIX = "giftlens.history.item.";
const MAX_ENTRIES = 20;

/** Broadcast so any open menu re-reads the index after a write in this tab. */
const CHANGE_EVENT = "giftlens:history-change";

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

const isBrowser = () => typeof window !== "undefined";

function readIndex(): HistoryEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* quota/blocked — nothing we can do; history just won't grow */
  }
}

function emitChange() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Newest first. */
export function listHistory(): HistoryEntry[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The full chat snapshot is opaque to storage — the shop page owns its shape. */
export function loadSnapshot<T = unknown>(id: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(ITEM_PREFIX + id);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Insert or update a search. Writes the snapshot, upserts the index row, and
 * evicts the oldest entries (and their snapshots) beyond MAX_ENTRIES.
 */
export function upsertHistory(entry: HistoryEntry, snapshot: unknown): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(ITEM_PREFIX + entry.id, JSON.stringify(snapshot));
  } catch {
    /* snapshot too big / blocked — skip persisting this turn */
    return;
  }

  const others = readIndex().filter((e) => e.id !== entry.id);
  const next = [entry, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // LRU eviction: drop the tail and clean up its snapshots.
  for (const stale of next.slice(MAX_ENTRIES)) {
    try {
      localStorage.removeItem(ITEM_PREFIX + stale.id);
    } catch {
      /* ignore */
    }
  }
  writeIndex(next.slice(0, MAX_ENTRIES));
  emitChange();
}

export function renameHistory(id: string, title: string): void {
  const next = readIndex().map((e) => (e.id === id ? { ...e, title } : e));
  writeIndex(next);
  emitChange();
}

export function deleteHistory(id: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(ITEM_PREFIX + id);
  } catch {
    /* ignore */
  }
  writeIndex(readIndex().filter((e) => e.id !== id));
  emitChange();
}

export function clearHistory(): void {
  if (!isBrowser()) return;
  for (const e of readIndex()) {
    try {
      localStorage.removeItem(ITEM_PREFIX + e.id);
    } catch {
      /* ignore */
    }
  }
  writeIndex([]);
  emitChange();
}

/** Subscribe to history changes (this tab's writes + other tabs via `storage`). */
export function subscribeHistory(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === INDEX_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
