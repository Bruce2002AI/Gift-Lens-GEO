"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/ToastProvider";
import { wishlistKey } from "@/lib/wishlist/snapshot";
import type { WishlistItem, WishlistItemInput } from "@/lib/wishlist/types";

const PENDING_KEY = "giftlens.pendingWishlist";

interface WishlistContextValue {
  items: WishlistItem[];
  count: number;
  ready: boolean;
  isWishlisted: (productId: string, source: "live" | "mock") => boolean;
  toggle: (input: WishlistItemInput) => void;
  remove: (productId: string, source: "live" | "mock") => void;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within <WishlistProvider>");
  return ctx;
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [ready, setReady] = useState(false);

  const keys = useMemo(
    () => new Set(items.map((i) => wishlistKey(i.productId, i.source))),
    [items],
  );

  // Hydrate from the server on sign-in; clear on sign-out.
  useEffect(() => {
    let cancelled = false;
    if (status === "authenticated") {
      (async () => {
        try {
          const res = await fetch("/api/wishlist");
          const data = await res.json();
          if (!cancelled && res.ok && data.ok) setItems(data.items as WishlistItem[]);
        } catch {
          /* leave empty; toggling will surface errors */
        } finally {
          if (!cancelled) setReady(true);
          if (!cancelled) void flushPending();
        }
      })();
    } else if (status === "unauthenticated") {
      queueMicrotask(() => {
        if (cancelled) return;
        setItems([]);
        setReady(true);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // After returning from login, auto-add the product the guest tried to save.
  const flushPending = useCallback(async () => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);
    let input: WishlistItemInput;
    try {
      input = JSON.parse(raw) as WishlistItemInput;
    } catch {
      return;
    }
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setItems((prev) =>
          prev.some(
            (i) => i.productId === input.productId && i.source === input.source,
          )
            ? prev
            : [data.item as WishlistItem, ...prev],
        );
        toast("Added to Wishlist");
      }
    } catch {
      /* ignore */
    }
  }, [toast]);

  const remove = useCallback(
    async (productId: string, source: "live" | "mock") => {
      const prev = items;
      setItems((cur) =>
        cur.filter((i) => !(i.productId === productId && i.source === source)),
      );
      try {
        const res = await fetch("/api/wishlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, source }),
        });
        if (!res.ok) throw new Error("failed");
        toast("Removed from Wishlist");
      } catch {
        setItems(prev); // revert
        toast("Couldn't update your wishlist. Try again.", "error");
      }
    },
    [items, toast],
  );

  const add = useCallback(
    async (input: WishlistItemInput) => {
      const optimistic: WishlistItem = {
        ...input,
        createdAt: new Date(0).toISOString(),
      };
      const prev = items;
      setItems((cur) => [optimistic, ...cur]);
      try {
        const res = await fetch("/api/wishlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error("failed");
        // Replace optimistic entry with the server copy (real createdAt).
        setItems((cur) =>
          cur.map((i) =>
            i.productId === input.productId && i.source === input.source
              ? (data.item as WishlistItem)
              : i,
          ),
        );
        toast("Added to Wishlist");
      } catch {
        setItems(prev); // revert
        toast("Couldn't update your wishlist. Try again.", "error");
      }
    },
    [items, toast],
  );

  const toggle = useCallback(
    (input: WishlistItemInput) => {
      if (status !== "authenticated") {
        try {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify(input));
        } catch {
          /* ignore quota errors */
        }
        toast("Sign in to save your wishlist", "info");
        router.push(`/login?callbackUrl=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      if (keys.has(wishlistKey(input.productId, input.source))) {
        void remove(input.productId, input.source);
      } else {
        void add(input);
      }
    },
    [status, keys, toast, router, pathname, remove, add],
  );

  const value: WishlistContextValue = {
    items,
    count: items.length,
    ready,
    isWishlisted: (productId, source) =>
      keys.has(wishlistKey(productId, source)),
    toggle,
    remove: (productId, source) => void remove(productId, source),
  };

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
