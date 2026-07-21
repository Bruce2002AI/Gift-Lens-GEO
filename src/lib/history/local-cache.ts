/**
 * Client-only history persistence in localStorage.
 *
 * Two roles, one implementation via a namespaced factory:
 *   - the GUEST store (legacy keys) holds a signed-out shopper's history and is
 *     drained into the DB on first sign-in, and
 *   - the MIRROR store caches a signed-in shopper's DB history for instant cold
 *     paint and offline reads — disposable, since the DB is the source of truth.
 *
 * Each store keeps two layers so opening the menu never parses megabytes:
 *   - a small INDEX (one lightweight row per past search) for the list UI, and
 *   - one SNAPSHOT per search (the full chat + board), loaded only on restore.
 *
 * Entries are capped (LRU by `updatedAt`). Beyond the count cap we also evict on
 * quota pressure: a `QuotaExceededError` drops the oldest snapshot(s) and retries
 * the write, so "storage full" purges old searches rather than losing the newest
 * one. Everything is best-effort: blocked/corrupted storage degrades to "no
 * history", never throws into the UI.
 */

import type { HistoryEntry, HistoryRecord } from "@/lib/history/types";

const MAX_ENTRIES = 20;

export interface LocalHistoryStore {
  list(): HistoryEntry[];
  loadSnapshot(id: string): unknown | null;
  /** Write an index row + its snapshot together (a settled turn). */
  upsert(entry: HistoryEntry, snapshot: unknown): void;
  /** Overwrite the index rows only (e.g. from a server list), pruning orphans. */
  replaceIndex(entries: HistoryEntry[]): void;
  /** Cache one snapshot without touching the index (e.g. a lazily-fetched one). */
  putSnapshot(id: string, snapshot: unknown): void;
  rename(id: string, title: string): void;
  remove(id: string): void;
  clear(): void;
  /** Read every entry + snapshot, then wipe the store. Used to migrate on sign-in. */
  drain(): HistoryRecord[];
  /** Subscribe to changes (this tab's writes + other tabs via `storage`). */
  subscribe(cb: () => void): () => void;
}

const isBrowser = () => typeof window !== "undefined";

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function createLocalHistoryStore(opts: {
  indexKey: string;
  itemPrefix: string;
  changeEvent: string;
}): LocalHistoryStore {
  const { indexKey, itemPrefix, changeEvent } = opts;

  function readIndex(): HistoryEntry[] {
    if (!isBrowser()) return [];
    try {
      const raw = localStorage.getItem(indexKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoryEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeIndex(entries: HistoryEntry[]) {
    try {
      localStorage.setItem(indexKey, JSON.stringify(entries));
    } catch {
      /* quota/blocked — nothing we can do; index just won't grow */
    }
  }

  function hasSnapshot(id: string): boolean {
    try {
      return localStorage.getItem(itemPrefix + id) !== null;
    } catch {
      return false;
    }
  }

  function removeSnapshot(id: string) {
    try {
      localStorage.removeItem(itemPrefix + id);
    } catch {
      /* ignore */
    }
  }

  function emitChange() {
    if (!isBrowser()) return;
    window.dispatchEvent(new Event(changeEvent));
  }

  /**
   * Persist one snapshot, evicting the oldest OTHER snapshots on quota pressure
   * and retrying until it fits. `keepId` is never evicted. Returns the ids that
   * were evicted (so the caller can drop their index rows), or null if the write
   * failed for a non-quota reason and could not be persisted at all.
   */
  function writeSnapshot(
    id: string,
    snapshot: unknown,
    orderedByAge: HistoryEntry[],
  ): { ok: boolean; evicted: string[] } {
    const evicted: string[] = [];
    let payload: string;
    try {
      payload = JSON.stringify(snapshot);
    } catch {
      return { ok: false, evicted };
    }
    const victims = orderedByAge
      .map((e) => e.id)
      .filter((victimId) => victimId !== id && hasSnapshot(victimId));
    for (;;) {
      try {
        localStorage.setItem(itemPrefix + id, payload);
        return { ok: true, evicted };
      } catch (err) {
        if (!isQuotaError(err)) return { ok: false, evicted };
        const victim = victims.shift();
        if (!victim) return { ok: false, evicted }; // nothing left to free
        removeSnapshot(victim);
        evicted.push(victim);
      }
    }
  }

  return {
    list() {
      return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    loadSnapshot(id) {
      if (!isBrowser()) return null;
      try {
        const raw = localStorage.getItem(itemPrefix + id);
        return raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        return null;
      }
    },

    upsert(entry, snapshot) {
      if (!isBrowser()) return;
      const others = readIndex().filter((e) => e.id !== entry.id);
      const next = [entry, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      // Count-cap eviction: drop the tail and clean up its snapshots.
      const kept = next.slice(0, MAX_ENTRIES);
      for (const stale of next.slice(MAX_ENTRIES)) removeSnapshot(stale.id);

      // Oldest-first among the kept rows drives quota eviction order.
      const byAge = [...kept].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const { ok, evicted } = writeSnapshot(entry.id, snapshot, byAge);

      const evictedSet = new Set(evicted);
      // If the snapshot couldn't be stored, don't leave a dangling index row.
      const finalIndex = ok
        ? kept.filter((e) => !evictedSet.has(e.id))
        : kept.filter((e) => e.id !== entry.id);
      writeIndex(finalIndex);
      emitChange();
    },

    replaceIndex(entries) {
      if (!isBrowser()) return;
      const nextIds = new Set(entries.map((e) => e.id));
      // Prune snapshots whose rows are gone from the authoritative list.
      for (const old of readIndex()) {
        if (!nextIds.has(old.id)) removeSnapshot(old.id);
      }
      writeIndex([...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      emitChange();
    },

    putSnapshot(id, snapshot) {
      if (!isBrowser()) return;
      // Only cache a snapshot for a row we actually track; evict oldest on pressure.
      const index = readIndex();
      if (!index.some((e) => e.id === id)) return;
      const byAge = [...index].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      writeSnapshot(id, snapshot, byAge);
    },

    rename(id, title) {
      writeIndex(readIndex().map((e) => (e.id === id ? { ...e, title } : e)));
      emitChange();
    },

    remove(id) {
      if (!isBrowser()) return;
      removeSnapshot(id);
      writeIndex(readIndex().filter((e) => e.id !== id));
      emitChange();
    },

    clear() {
      if (!isBrowser()) return;
      for (const e of readIndex()) removeSnapshot(e.id);
      writeIndex([]);
      emitChange();
    },

    drain() {
      if (!isBrowser()) return [];
      const entries = readIndex();
      const records: HistoryRecord[] = [];
      for (const entry of entries) {
        const snapshot = this.loadSnapshot(entry.id);
        if (snapshot !== null) records.push({ entry, snapshot });
      }
      // Wipe after reading so migration is one-shot.
      for (const e of entries) removeSnapshot(e.id);
      writeIndex([]);
      return records;
    },

    subscribe(cb) {
      if (!isBrowser()) return () => {};
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === indexKey) cb();
      };
      window.addEventListener(changeEvent, cb);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(changeEvent, cb);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** Guest store — legacy keys, so an existing signed-out user's data migrates. */
export const guestHistory = createLocalHistoryStore({
  indexKey: "giftlens.history.index",
  itemPrefix: "giftlens.history.item.",
  changeEvent: "giftlens:history-change",
});

/** Mirror store — disposable cache of the signed-in user's DB history. */
export const mirrorHistory = createLocalHistoryStore({
  indexKey: "giftlens.history.mirror.index",
  itemPrefix: "giftlens.history.mirror.item.",
  changeEvent: "giftlens:history-mirror-change",
});
