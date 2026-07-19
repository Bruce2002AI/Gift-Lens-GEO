import "server-only";
import type { NormalizedProduct } from "@/lib/catalog/types";
import { formatMinorRange } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import { truncate } from "@/lib/utils";
import type { BaseIntent } from "@/lib/modes/types";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";
import { GIFTLENS_SYSTEM } from "./intent";
import { SemanticScoresSchema, type SemanticScores } from "./schemas";

/**
 * Semantic candidate scoring. Claude receives the complete normalized product
 * evidence for each candidate and returns sub-scores; it cannot add product
 * facts. Deterministic logistics checks elsewhere override anything here.
 */

export interface CandidateEvidence {
  id: string;
  title: string;
  description: string;
  categories: string[];
  price: string;
  rating: string;
  seller: string;
  features: string[];
}

export function candidateEvidence(p: NormalizedProduct): CandidateEvidence {
  return {
    id: p.id,
    title: p.title,
    description: truncate(p.description, 400),
    categories: p.categories.map((c) => c.value),
    price: formatMinorRange(
      p.priceRange.minMinor,
      p.priceRange.maxMinor,
      p.priceRange.currency,
    ),
    rating:
      p.rating.value != null
        ? `${p.rating.value}/${p.rating.scaleMax ?? 5} (${p.rating.count ?? "?"} reviews)`
        : "no rating data",
    seller: p.variants[0]?.seller?.name ?? "unknown seller",
    features: [
      ...p.metadata.topFeatures,
      ...p.metadata.uniqueSellingPoints,
    ].slice(0, 5),
  };
}

function keywordOverlapScore(haystack: string, needles: string[]): number {
  if (needles.length === 0) return 0.5;
  const lower = haystack.toLowerCase();
  const hits = needles.filter((n) => lower.includes(n.toLowerCase())).length;
  return Math.min(1, 0.25 + (hits / needles.length) * 0.75);
}

export function heuristicSemanticScores(
  intent: BaseIntent,
  products: NormalizedProduct[],
): SemanticScores {
  return {
    scores: products.map((p) => {
      const text = `${p.title} ${p.description} ${p.categories
        .map((c) => c.value)
        .join(" ")} ${p.metadata.topFeatures.join(" ")}`;
      const interestScore = keywordOverlapScore(text, [
        ...intent.interests,
        ...intent.searchThemes,
      ]);
      const occasionScore = keywordOverlapScore(text, [
        ...(intent.occasion ? [intent.occasion] : []),
        ...intent.styleKeywords,
        ...intent.softPreferences,
      ]);
      // Novelty proxy: fewer generic category words → more distinctive.
      const noveltyScore = /unique|limited|handmade|small-batch|unusual/i.test(text)
        ? 0.75
        : 0.5;
      return {
        productId: p.id,
        recipientFit: interestScore,
        occasionFit: occasionScore,
        noveltyFit: noveltyScore,
        fitNotes: "Heuristic keyword-overlap scoring (Claude unavailable).",
      };
    }),
  };
}

const RERANK_PROMPT = (intent: BaseIntent, evidence: CandidateEvidence[]) => `Score each candidate product for this shopping intent. Use ONLY the evidence provided — do not assume any product attribute that is not listed.

Shopping intent:
${JSON.stringify(intent, null, 2)}

Candidates (complete evidence):
${JSON.stringify(evidence, null, 2)}

Return JSON:
{
  "scores": [
    {
      "productId": "<id from evidence>",
      "recipientFit": 0.0-1.0 (match to interests, dislikes, personality, lifestyle),
      "occasionFit": 0.0-1.0 (occasion and gift-style fit),
      "noveltyFit": 0.0-1.0 (how distinctive/memorable vs generic),
      "fitNotes": "one sentence grounded in the evidence"
    }
  ]
}

Include EVERY candidate exactly once. Penalize recipientFit hard when a product matches a stated dislike or exclusion.`;

export async function scoreCandidates(
  intent: BaseIntent,
  products: NormalizedProduct[],
): Promise<{ scores: SemanticScores; aiMode: AiMode }> {
  if (products.length === 0) {
    return { scores: { scores: [] }, aiMode: "heuristic" };
  }
  if (!aiAvailable()) {
    return { scores: heuristicSemanticScores(intent, products), aiMode: "heuristic" };
  }
  try {
    const evidence = products.map(candidateEvidence);
    const scores = await structuredCompletion(
      GIFTLENS_SYSTEM,
      RERANK_PROMPT(intent, evidence),
      SemanticScoresSchema,
      { maxTokens: 3000 },
    );
    // Any candidate the model skipped gets heuristic scores instead of vanishing.
    const seen = new Set(scores.scores.map((s) => s.productId));
    const missing = products.filter((p) => !seen.has(p.id));
    if (missing.length > 0) {
      const filler = heuristicSemanticScores(intent, missing);
      scores.scores.push(...filler.scores);
    }
    return { scores, aiMode: "ai" };
  } catch (err) {
    logger.warn("semantic scoring via Claude failed; using heuristic", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scores: heuristicSemanticScores(intent, products), aiMode: "heuristic" };
  }
}
