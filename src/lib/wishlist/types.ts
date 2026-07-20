/**
 * Shared wishlist types — safe for both client and server (no server-only deps).
 * A wishlist item is a denormalized snapshot of a product captured at save time,
 * so the wishlist page renders without a live catalog re-fetch.
 */

export type WishlistSource = "live" | "mock";

export interface WishlistRating {
  value: number | null;
  scaleMax: number | null;
  count: number | null;
}

/** Payload sent from the client when saving; also the persisted shape (minus createdAt). */
export interface WishlistItemInput {
  productId: string;
  source: WishlistSource;
  title: string;
  imageUrl: string | null;
  url: string | null;
  priceMinor: number | null;
  priceMaxMinor: number | null;
  currency: string | null;
  brand: string | null;
  rating: WishlistRating | null;
  available: boolean | null;
}

/** What the API returns to the client. */
export interface WishlistItem extends WishlistItemInput {
  createdAt: string; // ISO
}
