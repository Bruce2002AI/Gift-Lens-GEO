import type { ShortlistEntry } from "@/lib/shortlist/types";

/**
 * Turning the session shortlist into Shopify checkout links.
 *
 * A Shopify cart permalink is scoped to ONE store domain
 * (`https://{shop}.myshopify.com/cart/{variantId}:{qty},…`), so the shortlist
 * is grouped by shop: each store becomes its own cart, and checkout opens one
 * permalink per store. The variant id and domain are recovered from the
 * product URL captured at save time (`…/products/slug?variant=123`).
 */

export interface ShopGroup {
  /** Display name — the merchant/brand the item came from. */
  shop: string;
  entries: ShortlistEntry[];
  /** The store's cart permalink, or the first product link if no variant is known. */
  cartUrl: string | null;
  /** Subtotal in minor units when every entry shares a currency; null otherwise. */
  subtotalMinor: number | null;
  currency: string | null;
}

/** Pull the store domain and variant id out of a product/checkout URL. */
function parseUrl(url: string | null): { domain: string; variantId: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const variantId = u.searchParams.get("variant");
    if (!variantId) return null;
    return { domain: u.host, variantId };
  } catch {
    return null;
  }
}

/** Build a single store's cart permalink from its entries (falls back to a product link). */
function buildCartUrl(entries: ShortlistEntry[]): string | null {
  let domain: string | null = null;
  const lines: string[] = [];
  for (const entry of entries) {
    const parsed = parseUrl(entry.url);
    if (!parsed) continue;
    if (domain === null) domain = parsed.domain;
    // A permalink can only carry one domain — skip lines from a stray domain.
    if (parsed.domain === domain) lines.push(`${parsed.variantId}:${Math.max(1, entry.quantity)}`);
  }
  if (domain && lines.length > 0) {
    return `https://${domain}/cart/${lines.join(",")}?storefront=true`;
  }
  // No parseable variant (e.g. demo catalog) — fall back to the first product link.
  return entries.find((entry) => entry.url)?.url ?? null;
}

/** Group shortlist entries by shop, preserving first-seen order. */
export function groupByShop(entries: ShortlistEntry[]): ShopGroup[] {
  const order: string[] = [];
  const byShop = new Map<string, ShortlistEntry[]>();
  for (const entry of entries) {
    const shop = entry.brand?.trim() || "Other sellers";
    let bucket = byShop.get(shop);
    if (!bucket) {
      bucket = [];
      byShop.set(shop, bucket);
      order.push(shop);
    }
    bucket.push(entry);
  }

  return order.map((shop) => {
    const groupEntries = byShop.get(shop)!;
    const currency = groupEntries[0]?.currency ?? null;
    const sameCurrency = groupEntries.every((e) => e.currency === currency);
    const subtotalMinor =
      sameCurrency && currency
        ? groupEntries.reduce((sum, e) => sum + (e.priceMinor ?? 0) * Math.max(1, e.quantity), 0)
        : null;
    return { shop, entries: groupEntries, cartUrl: buildCartUrl(groupEntries), currency, subtotalMinor };
  });
}
