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

/**
 * From an expert board item. Board items now carry the full catalog record,
 * so saved items keep their rating and availability instead of losing them.
 */
export function snapshotFromBoardItem(item: VerifiedBoardItem): WishlistItemInput {
  const { facts } = item;
  return {
    productId: item.productId,
    source: item.source,
    title: item.title,
    imageUrl: item.imageUrl,
    url: item.productUrl,
    priceMinor: item.priceMinor,
    priceMaxMinor: facts.priceRange.maxMinor ?? item.priceMinor,
    currency: item.currency,
    brand: item.merchant,
    rating:
      facts.rating.value != null
        ? {
            value: facts.rating.value,
            scaleMax: facts.rating.scaleMax,
            count: facts.rating.count,
          }
        : null,
    // Null (not false) when the catalog reported no availability signal at all.
    available: facts.variants.some((v) => v.available !== null)
      ? facts.inStockVariants > 0
      : null,
  };
}
