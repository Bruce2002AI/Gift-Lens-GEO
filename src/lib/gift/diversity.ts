import { normalizeTitleKey } from "@/lib/utils";
import type { NormalizedProduct } from "@/lib/catalog/types";
import type { RecommendationRole } from "./types";
import type { ScoredCandidate } from "./ranking";

/**
 * Deduplication and diverse role selection. The three final picks should
 * differ in product type, merchant, price point, or gifting strategy —
 * never three variants of the same thing.
 */

export function dedupeProducts(products: NormalizedProduct[]): NormalizedProduct[] {
  const seenIds = new Set<string>();
  const seenVariantIds = new Set<string>();
  const seenTitleMerchant = new Set<string>();
  const out: NormalizedProduct[] = [];
  for (const p of products) {
    if (seenIds.has(p.id)) continue;
    const variantIds = p.variants.map((v) => v.id).filter(Boolean);
    if (variantIds.some((v) => seenVariantIds.has(v))) continue;
    const titleKey = `${normalizeTitleKey(p.title)}::${
      p.variants[0]?.seller?.name?.toLowerCase() ?? ""
    }`;
    if (p.title && seenTitleMerchant.has(titleKey)) continue;
    seenIds.add(p.id);
    variantIds.forEach((v) => seenVariantIds.add(v));
    if (p.title) seenTitleMerchant.add(titleKey);
    out.push(p);
  }
  return out;
}

function merchantOf(c: ScoredCandidate): string {
  return c.product.variants[0]?.seller?.name?.toLowerCase() ?? "unknown";
}

function categoryOf(c: ScoredCandidate): string {
  return c.product.categories[0]?.value.split(">")[0]?.trim().toLowerCase() ?? "other";
}

function differsFrom(c: ScoredCandidate, chosen: ScoredCandidate[]): number {
  let score = 0;
  for (const other of chosen) {
    if (merchantOf(c) !== merchantOf(other)) score += 1;
    if (categoryOf(c) !== categoryOf(other)) score += 1;
  }
  return score;
}

export interface RoleAssignment {
  role: RecommendationRole;
  candidate: ScoredCandidate;
}

/**
 * Assign best_match / delight_pick / safe_pick from ranked candidates.
 * Returns fewer than three when the pool is too small — never fabricates.
 */
export function assignRoles(ranked: ScoredCandidate[]): RoleAssignment[] {
  if (ranked.length === 0) return [];
  const pool = [...ranked].sort((a, b) => b.total - a.total);
  const chosen: RoleAssignment[] = [];

  // Best Match: highest overall fit.
  const best = pool.shift()!;
  chosen.push({ role: "best_match", candidate: best });

  // Delight Pick: most surprising/novel while defensible, preferring diversity.
  if (pool.length > 0) {
    const delight = pool
      .map((c) => ({
        c,
        s:
          c.breakdown.novelty * 0.5 +
          c.total * 0.3 +
          differsFrom(c, chosen.map((x) => x.candidate)) * 0.1,
      }))
      .sort((a, b) => b.s - a.s)[0].c;
    pool.splice(pool.indexOf(delight), 1);
    chosen.push({ role: "delight_pick", candidate: delight });
  }

  // Safe Pick: dependable — quality + logistics + broad appeal, still diverse.
  if (pool.length > 0) {
    const safe = pool
      .map((c) => ({
        c,
        s:
          c.breakdown.quality * 0.35 +
          c.breakdown.logistics * 0.3 +
          c.breakdown.completeness * 0.15 +
          differsFrom(c, chosen.map((x) => x.candidate)) * 0.1 +
          (1 - c.breakdown.novelty) * 0.1,
      }))
      .sort((a, b) => b.s - a.s)[0].c;
    pool.splice(pool.indexOf(safe), 1);
    chosen.push({ role: "safe_pick", candidate: safe });
  }

  return chosen;
}
