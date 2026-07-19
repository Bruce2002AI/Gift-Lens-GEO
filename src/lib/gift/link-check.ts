import "server-only";
import { aiAvailable, structuredCompletion } from "@/lib/ai/client";
import { GIFTLENS_SYSTEM } from "@/lib/ai/intent";
import { candidateEvidence, scoreCandidates } from "@/lib/ai/reranker";
import { LinkEvaluationSchema, type GiftIntent } from "@/lib/ai/schemas";
import { getProduct, lookupCatalog, searchCatalog } from "@/lib/catalog/client";
import type { TraceCollector } from "@/lib/catalog/trace";
import type { NormalizedProduct } from "@/lib/catalog/types";
import type { BaseIntent } from "@/lib/modes/types";
import { logger } from "@/lib/logger";
import { checkHardConstraints, logisticsMessage } from "./constraints";
import { giftToBaseIntent } from "./base-intent";
import { confidenceFor, scoreCandidate } from "./ranking";
import { buyerContext, searchParamsFor } from "./orchestration";
import type { GiftRecommendation, LinkCheckResponse } from "./types";

/**
 * "I found this product — is it a good gift?" flow:
 * lookup_catalog → get_product → evaluate vs GiftIntent →
 * optional search_catalog with the product as a similarity seed.
 */

function heuristicEvaluation(
  product: NormalizedProduct,
  intent: BaseIntent,
): { verdict: "strong" | "reasonable" | "weak"; reasons: string[]; concerns: string[] } {
  const constraints = checkHardConstraints(product, intent);
  const scored = scoreCandidate(product, intent, undefined);
  const reasons: string[] = [];
  const concerns = [...constraints.violations];
  const matched = intent.interests.filter((i) =>
    `${product.title} ${product.description}`.toLowerCase().includes(i.toLowerCase()),
  );
  if (matched.length > 0) reasons.push(`Mentions ${matched.join(", ")} in the listing.`);
  if (
    intent.budget.maxMinor != null &&
    product.priceRange.minMinor != null &&
    product.priceRange.minMinor <= intent.budget.maxMinor
  ) {
    reasons.push("Fits within the stated budget.");
  }
  if (product.rating.value != null) {
    reasons.push(`Rated ${product.rating.value}/${product.rating.scaleMax ?? 5} by shoppers.`);
  }
  if (reasons.length === 0) reasons.push("Catalog data resolved and the product is purchasable.");
  const verdict = !constraints.pass
    ? "weak"
    : scored.total >= 0.6
      ? "strong"
      : "reasonable";
  return { verdict, reasons: reasons.slice(0, 4), concerns: concerns.slice(0, 3) };
}

export async function checkProductLink(
  identifier: string,
  intent: GiftIntent,
  trace: TraceCollector,
): Promise<Omit<LinkCheckResponse, "trace">> {
  const base = giftToBaseIntent(intent);
  const lookup = await lookupCatalog([identifier], buyerContext(base), trace);
  if (lookup.products.length === 0) {
    return {
      ok: false,
      error:
        "ShopLens could not resolve this identifier in the selected catalog context. Double-check the product URL.",
      source: lookup.source,
      aiMode: "heuristic",
    };
  }

  const detail = await getProduct(
    { productId: lookup.products[0].id, context: buyerContext(base) },
    trace,
  );
  const product = detail.product ?? lookup.products[0];

  let verdict: "strong" | "reasonable" | "weak";
  let reasons: string[];
  let concerns: string[];
  let aiMode: "ai" | "heuristic" = "heuristic";

  if (aiAvailable()) {
    try {
      const evaluation = await structuredCompletion(
        GIFTLENS_SYSTEM,
        `Evaluate whether this product is a good gift for the intent below. Use ONLY the provided evidence.

Gift intent:
${JSON.stringify(intent, null, 2)}

Product evidence:
${JSON.stringify(candidateEvidence(product), null, 2)}

Hard-constraint check (deterministic, authoritative): ${JSON.stringify(checkHardConstraints(product, base))}

Return JSON: { "verdict": "strong"|"reasonable"|"weak", "reasons": ["1-4 short reasons"], "concerns": ["0-3 honest concerns"], "suggestAlternatives": boolean }`,
        LinkEvaluationSchema,
        { maxTokens: 700 },
      );
      verdict = evaluation.verdict;
      reasons = evaluation.reasons;
      concerns = evaluation.concerns;
      aiMode = "ai";
    } catch (err) {
      logger.warn("link evaluation via model failed; using heuristic", {
        error: err instanceof Error ? err.message : String(err),
      });
      ({ verdict, reasons, concerns } = heuristicEvaluation(product, base));
    }
  } else {
    ({ verdict, reasons, concerns } = heuristicEvaluation(product, base));
  }

  // Similar-or-cheaper alternatives using the product as a similarity seed.
  let alternatives: GiftRecommendation[] = [];
  try {
    const similar = await searchCatalog(
      {
        ...searchParamsFor(base, "similar style alternative", {
          productId: product.id,
        }),
        limit: 8,
      },
      trace,
    );
    const eligible = similar.products
      .filter((p) => p.id !== product.id)
      .filter((p) =>
        checkHardConstraints(p, base, {
          catalogBudgetFilterApplied: base.budget.maxMinor != null,
        }).pass,
      )
      .slice(0, 3);
    if (eligible.length > 0) {
      const { scores } = await scoreCandidates(base, eligible);
      const byId = new Map(scores.scores.map((s) => [s.productId, s]));
      alternatives = eligible.map((p) => {
        const scored = scoreCandidate(p, base, byId.get(p.id));
        return {
          role: "safe_pick" as const,
          productId: p.id,
          variantId: p.variants.find((v) => v.available)?.id ?? null,
          totalScore: scored.total,
          scoreBreakdown: scored.breakdown,
          reasons: [scored.fitNotes || "Similar to the pasted product."],
          tradeoff: "Alternative found by similarity search — review details before buying.",
          evidence: [],
          confidence: confidenceFor(scored),
          logisticsMessage: logisticsMessage(p, base),
          product: p,
          source: similar.source,
        };
      });
    }
  } catch (err) {
    logger.warn("similarity alternatives failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: true,
    product,
    verdict,
    reasons,
    concerns,
    alternatives,
    source: detail.source,
    aiMode,
  };
}
