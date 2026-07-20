import type { WishlistItemInput } from "@/lib/wishlist/types";

/**
 * A shortlist item is the same denormalized product snapshot used by the
 * wishlist — but the shortlist is session-scoped (sessionStorage), needs no
 * auth, and is a "compare / decide" staging area. Checkout stays per-product
 * (each item's `url` is its own merchant checkout link from the Catalog API).
 */
export type ShortlistItem = WishlistItemInput;

export function shortlistKey(productId: string, source: "live" | "mock"): string {
  return `${source}:${productId}`;
}
