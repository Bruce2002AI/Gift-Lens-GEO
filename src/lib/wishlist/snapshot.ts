import type { GiftRecommendation } from "@/lib/gift/types";
import type { VerifiedBoardItem } from "@/lib/agent/types";
import type { WishlistItemInput, WishlistSource } from "@/lib/wishlist/types";

/**
 * Pure, client-safe builders that turn the two recommendation card shapes into
 * a single wishlist snapshot. Mirrors the display derivations in
 * RecommendationCard.tsx so the wishlist shows the same values.
 */

/** Stable key for the client-side "is this saved?" Set. */
export function wishlistKey(productId: string, source: WishlistSource): string {
  return `${source}:${productId}`;
}

/** From a gift/shop recommendation (NormalizedProduct-backed Pick). */
export function snapshotFromProduct(rec: GiftRecommendation): WishlistItemInput {
  const p = rec.product;
  const variant =
    p.variants.find((v) => v.id === rec.variantId) ??
    p.variants.find((v) => v.available) ??
    p.variants[0];
  const url =
    variant?.checkoutUrl ?? variant?.url ?? variant?.seller?.url ?? p.url ?? null;
  return {
    productId: p.id,
    source: rec.source,
    title: p.title,
    imageUrl: p.images[0]?.url ?? null,
    url,
    priceMinor: p.priceRange.minMinor,
    priceMaxMinor: p.priceRange.maxMinor,
    currency: p.priceRange.currency,
    brand: variant?.seller?.name ?? null,
    rating: {
      value: p.rating.value,
      scaleMax: p.rating.scaleMax,
      count: p.rating.count,
    },
    available: p.variants.some((v) => v.available === true),
  };
}

/** From an expert board item (already flattened; no rating/availability). */
export function snapshotFromBoardItem(item: VerifiedBoardItem): WishlistItemInput {
  return {
    productId: item.productId,
    source: item.source,
    title: item.title,
    imageUrl: item.imageUrl,
    url: item.productUrl,
    priceMinor: item.priceMinor,
    priceMaxMinor: item.priceMinor,
    currency: item.currency,
    brand: item.merchant,
    rating: null,
    available: null,
  };
}
