"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { guestHistory, mirrorHistory } from "@/lib/history/local-cache";
import type { HistoryEntry } from "@/lib/history/types";

/**
 * Owns search history and bridges the navbar menu to the shop page's chat state.
 *
 * Storage tiers (see local-cache.ts + lib/history/store.ts):
 *   - Signed out → localStorage only (the guest store).
 *   - Signed in  → the DB is the source of truth; a localStorage MIRROR caches it
 *     for instant cold paint and offline reads, and the guest store is drained
 *     into the DB once, on first sign-in.
 *
 * All mutations are optimistic: the in-memory index updates immediately and the
 * backing write (localStorage and/or the API) happens in the background, with a
 * revert if the API call fails.
 *
 * The bridge half (restore id + new-search nonce) lets the menu — which lives
 * above the router outlet — hand a signal to the shop page, which applies it and
 * acknowledges. Navigation is included so a click from any page lands on /shop.
 */
interface HistoryContextValue {
  /** The history index, newest first. */
  entries: HistoryEntry[];
  /** True once the initial hydrate has settled. */
  ready: boolean;
  /** Re-read the index from the backing store (menu open / window focus). */
  refresh: () => void;
  /** Persist a settled conversation (index row + full snapshot). */
  upsert: (entry: HistoryEntry, snapshot: unknown) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Load one conversation's full snapshot (mirror-cached, else fetched). */
  getSnapshot: (id: string) => Promise<unknown | null>;

  /** Id of a search the user asked to reopen; null when nothing is pending. */
  pendingRestoreId: string | null;
  /** Navigate to /shop and request that this search be restored. */
  requestRestore: (id: string) => void;
  /** Shop page calls this once it has applied the restore. */
  consumeRestore: () => void;
  /** Increments each time the user asks for a fresh search. */
  newSearchNonce: number;
  /** Navigate to /shop and request a blank conversation. */
  requestNewSearch: () => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}

const sortEntries = (entries: HistoryEntry[]): HistoryEntry[] =>
  [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useSession();
  const authed = status === "authenticated";

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [newSearchNonce, setNewSearchNonce] = useState(0);

  // `authed` in a ref so stable callbacks read the current tier without being
  // recreated (and without stale closures) when the session flips. Updated in an
  // effect — callbacks only fire from user events, well after commit.
  const authedRef = useRef(authed);
  useEffect(() => {
    authedRef.current = authed;
  }, [authed]);

  const refresh = useCallback(() => {
    const store = authedRef.current ? mirrorHistory : guestHistory;
    setEntries(store.list());
  }, []);

  // Hydrate per session tier; keep the list live via the store's change events.
  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;

    if (!authed) {
      // Defer the initial read out of the effect body (external-store sync).
      queueMicrotask(() => {
        if (cancelled) return;
        setEntries(guestHistory.list());
        setReady(true);
      });
      const unsub = guestHistory.subscribe(() => {
        if (!cancelled) setEntries(guestHistory.list());
      });
      return () => {
        cancelled = true;
        unsub();
      };
    }

    // Authenticated: paint the mirror instantly, then migrate + fetch the DB.
    queueMicrotask(() => {
      if (!cancelled) setEntries(mirrorHistory.list());
    });
    const unsub = mirrorHistory.subscribe(() => {
      if (!cancelled) setEntries(mirrorHistory.list());
    });

    (async () => {
      // One-shot migration of any guest history collected before sign-in.
      const pending = guestHistory.drain();
      for (const { entry, snapshot } of pending) {
        try {
          await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry, snapshot }),
          });
        } catch {
          /* best effort — a failed upload just isn't migrated */
        }
      }
      try {
        const res = await fetch("/api/history");
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) {
          const list = sortEntries(data.entries as HistoryEntry[]);
          setEntries(list);
          mirrorHistory.replaceIndex(list);
        }
      } catch {
        /* offline — keep the mirror paint */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Signed-in users: re-sync from the DB when the tab regains focus, so a search
  // saved on another device shows up without a reload.
  useEffect(() => {
    if (!authed) return;
    const onFocus = async () => {
      try {
        const res = await fetch("/api/history");
        const data = await res.json();
        if (res.ok && data.ok) {
          const list = sortEntries(data.entries as HistoryEntry[]);
          setEntries(list);
          mirrorHistory.replaceIndex(list);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authed]);

  const upsert = useCallback((entry: HistoryEntry, snapshot: unknown) => {
    setEntries((prev) => sortEntries([entry, ...prev.filter((e) => e.id !== entry.id)]));
    if (!authedRef.current) {
      guestHistory.upsert(entry, snapshot);
      return;
    }
    mirrorHistory.upsert(entry, snapshot);
    // Background save; the next settled turn re-POSTs if this one fails.
    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry, snapshot }),
    }).catch(() => {});
  }, []);

  const rename = useCallback(
    (id: string, title: string) => {
      const prev = entries;
      setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, title } : e)));
      if (!authedRef.current) {
        guestHistory.rename(id, title);
        return;
      }
      mirrorHistory.rename(id, title);
      void fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("failed");
        })
        .catch(() => setEntries(prev));
    },
    [entries],
  );

  const remove = useCallback(
    (id: string) => {
      const prev = entries;
      setEntries((cur) => cur.filter((e) => e.id !== id));
      if (!authedRef.current) {
        guestHistory.remove(id);
        return;
      }
      mirrorHistory.remove(id);
      void fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("failed");
        })
        .catch(() => setEntries(prev));
    },
    [entries],
  );

  const clear = useCallback(() => {
    const prev = entries;
    setEntries([]);
    if (!authedRef.current) {
      guestHistory.clear();
      return;
    }
    mirrorHistory.clear();
    void fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => {
        if (!res.ok) throw new Error("failed");
      })
      .catch(() => setEntries(prev));
  }, [entries]);

  const getSnapshot = useCallback(async (id: string): Promise<unknown | null> => {
    if (!authedRef.current) return guestHistory.loadSnapshot(id);
    const cached = mirrorHistory.loadSnapshot(id);
    if (cached !== null) return cached;
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (res.ok && data.ok) {
        mirrorHistory.putSnapshot(id, data.snapshot);
        return data.snapshot as unknown;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const requestRestore = useCallback(
    (id: string) => {
      setPendingRestoreId(id);
      router.push("/shop");
    },
    [router],
  );

  const consumeRestore = useCallback(() => setPendingRestoreId(null), []);

  const requestNewSearch = useCallback(() => {
    setNewSearchNonce((n) => n + 1);
    router.push("/shop");
  }, [router]);

  return (
    <HistoryContext.Provider
      value={{
        entries,
        ready,
        refresh,
        upsert,
        rename,
        remove,
        clear,
        getSnapshot,
        pendingRestoreId,
        requestRestore,
        consumeRestore,
        newSearchNonce,
        requestNewSearch,
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}
