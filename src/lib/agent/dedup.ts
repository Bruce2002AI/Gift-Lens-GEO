import type { NormalizedProduct } from "@/lib/catalog/types";

/**
 * Product de-duplication for the board.
 *
 * The catalog is multi-merchant: the SAME physical product is frequently
 * relisted by several sellers (and by one seller as separate colour/size
 * listings). Shown side by side these read as padding — the shopper asked for
 * unique options, not the same fountain pen five times. This collapses them to
 * one slot using the single signal every listing shares: the title.
 *
 * Deliberately conservative. Brand/model tokens stay in the title, so two
 * different brands' "White Oxford Shirt" remain distinct products; only genuine
 * relistings (identical titles once variant noise is stripped) collapse. There
 * is no gtin/barcode/vendor field in the normalized catalog to lean on, so title
 * identity is the pragmatic maximum — better to under-merge than to hide a real
 * alternative.
 */

/** Strip variant/merchant noise so the same product under two listings matches. */
function normalizeTitleForIdentity(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // "(Blue)" / "[Large]" variant tails
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation, pipes, dashes → space
    .replace(/\s+/g, " ")
    .trim();
}

/** A content identity for a product — same key ⇒ treat as the same item. */
export function productIdentityKey(product: NormalizedProduct): string {
  const t = normalizeTitleForIdentity(product.title);
  // A degenerate/empty title must never collapse with another — fall back to id.
  return t.length >= 3 ? `t:${t}` : `id:${product.id}`;
}

/** The catalog's cheapest priced offer for a product, for "keep the best price". */
function lowestPriceMinor(product: NormalizedProduct): number {
  const prices = [
    product.priceRange.minMinor,
    ...product.variants.map((v) => v.priceMinor),
  ].filter((p): p is number => p != null);
  return prices.length > 0 ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

/**
 * Collapse relistings in a result set, keeping the CHEAPEST instance of each
 * identity (multiple merchants sell it → show the best price) and preserving the
 * original result order otherwise. Returns unique products.
 */
export function dedupeProducts(products: NormalizedProduct[]): NormalizedProduct[] {
  const bestByKey = new Map<string, NormalizedProduct>();
  const order: string[] = [];
  for (const p of products) {
    const k = productIdentityKey(p);
    const current = bestByKey.get(k);
    if (!current) {
      bestByKey.set(k, p);
      order.push(k);
    } else if (lowestPriceMinor(p) < lowestPriceMinor(current)) {
      bestByKey.set(k, p); // same product, cheaper listing — prefer it
    }
  }
  return order.map((k) => bestByKey.get(k)!);
}
