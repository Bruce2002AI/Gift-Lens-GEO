"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { shortlistKey, type ShortlistEntry, type ShortlistItem } from "@/lib/shortlist/types";
import { ShortlistDrawer } from "@/components/shortlist/ShortlistDrawer";

/**
 * Session-scoped "shortlist" (a lightweight cart). Lives in sessionStorage, so
 * it persists while the tab/session is open and clears when the session ends.
 * No auth, no server — a staging area to gather candidates; checkout is
 * per-product via each item's merchant link.
 */

const STORAGE_KEY = "giftlens.shortlist";

interface ShortlistContextValue {
  items: ShortlistEntry[];
  /** Total quantity across all lines — the cart badge count. */
  count: number;
  isShortlisted: (productId: string, source: "live" | "mock") => boolean;
  add: (item: ShortlistItem) => void;
  remove: (productId: string, source: "live" | "mock") => void;
  toggle: (item: ShortlistItem) => void;
  /** Nudge a line's quantity by ±1 (never below 1). */
  setQuantity: (productId: string, source: "live" | "mock", delta: 1 | -1) => void;
  clear: () => void;
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const ShortlistContext = createContext<ShortlistContextValue | null>(null);

export function useShortlist(): ShortlistContextValue {
  const ctx = useContext(ShortlistContext);
  if (!ctx) throw new Error("useShortlist must be used within <ShortlistProvider>");
  return ctx;
}

export function ShortlistProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [items, setItems] = useState<ShortlistEntry[]>([]);
  const [open, setOpen] = useState(false);

  // Hydrate from sessionStorage once, after mount (avoids SSR mismatch).
  // Deferred so setState doesn't run synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        // Older sessions stored items without a quantity — default it to 1.
        const parsed = JSON.parse(raw) as Array<ShortlistItem & { quantity?: number }>;
        setItems(parsed.map((i) => ({ ...i, quantity: Math.max(1, i.quantity ?? 1) })));
      } catch {
        /* corrupted/blocked storage — start empty */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: ShortlistEntry[]) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota/blocked — keep in-memory only */
    }
  }, []);

  const keys = useMemo(
    () => new Set(items.map((i) => shortlistKey(i.productId, i.source))),
    [items],
  );

  const add = useCallback(
    (item: ShortlistItem) => {
      setItems((prev) => {
        if (prev.some((i) => i.productId === item.productId && i.source === item.source)) {
          return prev;
        }
        const next = [{ ...item, quantity: 1 }, ...prev];
        persist(next);
        return next;
      });
      toast("Added to shortlist");
    },
    [persist, toast],
  );

  const setQuantity = useCallback(
    (productId: string, source: "live" | "mock", delta: 1 | -1) => {
      setItems((prev) => {
        const next = prev.map((i) =>
          i.productId === productId && i.source === source
            ? { ...i, quantity: Math.max(1, i.quantity + delta) }
            : i,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const remove = useCallback(
    (productId: string, source: "live" | "mock") => {
      setItems((prev) => {
        const next = prev.filter(
          (i) => !(i.productId === productId && i.source === source),
        );
        persist(next);
        return next;
      });
      toast("Removed from shortlist");
    },
    [persist, toast],
  );

  const toggle = useCallback(
    (item: ShortlistItem) => {
      if (keys.has(shortlistKey(item.productId, item.source))) {
        remove(item.productId, item.source);
      } else {
        add(item);
      }
    },
    [keys, add, remove],
  );

  const clear = useCallback(() => {
    setItems([]);
    persist([]);
  }, [persist]);

  const value: ShortlistContextValue = {
    items,
    count: items.reduce((n, i) => n + i.quantity, 0),
    isShortlisted: (productId, source) => keys.has(shortlistKey(productId, source)),
    add,
    remove,
    toggle,
    setQuantity,
    clear,
    open,
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
  };

  return (
    <ShortlistContext.Provider value={value}>
      {children}
      <ShortlistDrawer />
    </ShortlistContext.Provider>
  );
}
