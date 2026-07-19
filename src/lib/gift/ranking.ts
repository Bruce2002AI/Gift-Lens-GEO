import type { NormalizedProduct } from "@/lib/catalog/types";
import type { SemanticScores } from "@/lib/ai/schemas";
import type { BaseIntent, ScoreBreakdown } from "@/lib/modes/types";
import { clamp } from "@/lib/utils";

/**
 * Explainable scoring model:
 *   35% recipient/interest fit, 20% occasion/style fit, 20% logistics,
 *   10% quality signals, 10% catalog completeness, 5% diversity/novelty.
 * Semantic sub-scores come from Claude (or the labeled heuristic); logistics,
 * quality, and completeness are deterministic and override the model.
 */

export const WEIGHTS = {
  recipientFit: 0.35,
  occasionFit: 0.2,
  logistics: 0.2,
  quality: 0.1,
  completeness: 0.1,
  novelty: 0.05,
} as const;

export function logisticsScore(
  product: NormalizedProduct,
  intent: BaseIntent,
): number {
  let score = 0;
  let checks = 0;

  // Within budget.
  checks++;
  const min = product.priceRange.minMinor;
  if (intent.budget.maxMinor == null) score += 1;
  else if (min != null && min <= intent.budget.maxMinor) score += 1;

  // Available variant.
  checks++;
  if (product.variants.some((v) => v.available === true)) score += 1;

  // Checkout handoff present.
  checks++;
  if (product.variants.some((v) => v.checkoutUrl || v.seller?.url)) score += 1;

  // Price data present (needed for confident handoff).
  checks++;
  if (min != null || product.variants.some((v) => v.priceMinor != null)) score += 1;

  return score / checks;
}

export function qualityScore(product: NormalizedProduct): number {
  const { value, scaleMax, count } = product.rating;
  if (value == null) return 0.5; // missing reviews are not proof of low quality
  const normalized = clamp(value / (scaleMax ?? 5), 0, 1);
  // Confidence grows with review count (saturates ~200 reviews).
  const confidence = count != null ? clamp(Math.log10(count + 1) / Math.log10(201), 0, 1) : 0.3;
  return 0.5 + (normalized - 0.5) * (0.5 + 0.5 * confidence);
}

export function completenessScore(product: NormalizedProduct): number {
  let score = 0;
  const checks = 6;
  if (product.title.trim().length >= 10) score += 1;
  if (product.description.trim().length >= 60) score += 1;
  if (product.images.length >= 1) score += 1;
  if (product.variants.length >= 1 && product.variants.every((v) => v.id)) score += 1;
  if (product.variants.some((v) => v.seller?.name)) score += 1;
  if (product.priceRange.minMinor != null) score += 1;
  return score / checks;
}

export interface ScoredCandidate {
  product: NormalizedProduct;
  breakdown: ScoreBreakdown;
  total: number;
  fitNotes: string;
}

export function scoreCandidate(
  product: NormalizedProduct,
  intent: BaseIntent,
  semantic: SemanticScores["scores"][number] | undefined,
): ScoredCandidate {
  const breakdown: ScoreBreakdown = {
    recipientFit: clamp(semantic?.recipientFit ?? 0.4, 0, 1),
    occasionFit: clamp(semantic?.occasionFit ?? 0.4, 0, 1),
    logistics: logisticsScore(product, intent),
    quality: qualityScore(product),
    completeness: completenessScore(product),
    novelty: clamp(semantic?.noveltyFit ?? 0.5, 0, 1),
  };
  const total =
    breakdown.recipientFit * WEIGHTS.recipientFit +
    breakdown.occasionFit * WEIGHTS.occasionFit +
    breakdown.logistics * WEIGHTS.logistics +
    breakdown.quality * WEIGHTS.quality +
    breakdown.completeness * WEIGHTS.completeness +
    breakdown.novelty * WEIGHTS.novelty;
  return {
    product,
    breakdown,
    total: Math.round(total * 1000) / 1000,
    fitNotes: semantic?.fitNotes ?? "",
  };
}

export function confidenceFor(candidate: ScoredCandidate): "high" | "medium" | "low" {
  const { breakdown } = candidate;
  if (breakdown.logistics >= 0.9 && breakdown.completeness >= 0.8 && candidate.total >= 0.65) {
    return "high";
  }
  if (breakdown.logistics >= 0.7 && candidate.total >= 0.5) return "medium";
  return "low";
}
