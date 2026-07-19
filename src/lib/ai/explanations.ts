import "server-only";
import type { NormalizedProduct } from "@/lib/catalog/types";
import type { BaseIntent } from "@/lib/modes/types";
import { formatMinorRange } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import { phraseInText } from "@/lib/utils";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";
import { candidateEvidence } from "./reranker";
import { GIFTLENS_SYSTEM } from "./intent";
import { ExplanationsSchema, type Explanations } from "./schemas";

/**
 * Evidence-grounded "Why it fits" explanations for the chosen products. Every
 * claim must cite a source field from the normalized product data. Shared
 * across modes: pass a mode `persona` (system prompt) and a `noun` for what to
 * call the item ("gift", "routine step", "outfit piece", …).
 */

export interface ExplainOptions {
  /** System persona for the model (defaults to the gift persona). */
  persona?: string;
  /** What to call each item in copy ("gift", "pick", "routine step"…). */
  noun?: string;
}

export function heuristicExplanations(
  intent: BaseIntent,
  products: NormalizedProduct[],
  opts: ExplainOptions = {},
): Explanations {
  const noun = opts.noun ?? "pick";
  return {
    explanations: products.map((p) => {
      const reasons: string[] = [];
      const evidence: Array<{ claim: string; sourceField: string }> = [];
      const matchedInterests = intent.interests.filter((i) =>
        phraseInText(`${p.title} ${p.description}`, i),
      );
      if (matchedInterests.length > 0) {
        reasons.push(
          `Connects to their interest in ${matchedInterests.slice(0, 2).join(" and ")}.`,
        );
        evidence.push({
          claim: `Mentions ${matchedInterests[0]} in the listing`,
          sourceField: "title/description",
        });
      }
      if (intent.occasion) {
        reasons.push(`Works well as a ${intent.occasion} ${noun}.`);
      }
      const priceStr = formatMinorRange(
        p.priceRange.minMinor,
        p.priceRange.maxMinor,
        p.priceRange.currency,
      );
      // Only claim a budget fit when the prices are in the same currency — like
      // checkHardConstraints, this never invents an FX rate to compare across
      // currencies.
      const productCurrency = (
        p.priceRange.currency ??
        p.variants.find((v) => v.currency)?.currency ??
        null
      )?.toUpperCase();
      const currencyComparable =
        productCurrency == null ||
        productCurrency === intent.budget.currency.toUpperCase();
      if (
        intent.budget.maxMinor != null &&
        p.priceRange.minMinor != null &&
        currencyComparable &&
        p.priceRange.minMinor <= intent.budget.maxMinor
      ) {
        reasons.push(`Fits the budget at ${priceStr}.`);
        evidence.push({ claim: `Price ${priceStr}`, sourceField: "priceRange" });
      }
      if (reasons.length === 0) {
        reasons.push("Matches the overall brief from catalog data.");
      }
      let tradeoff = "Limited evidence beyond the listing itself.";
      if (p.rating.value == null) {
        tradeoff = "No rating data was returned for this product, so quality signals are limited.";
      } else if (
        intent.budget.maxMinor != null &&
        p.priceRange.maxMinor != null &&
        currencyComparable &&
        p.priceRange.maxMinor > intent.budget.maxMinor * 0.85
      ) {
        tradeoff = "Uses most of the stated budget.";
      } else if (p.variants.some((v) => v.runningLow)) {
        tradeoff = "The catalog flags stock as running low.";
      }
      return {
        productId: p.id,
        reasons: reasons.slice(0, 3),
        tradeoff,
        evidence: evidence.slice(0, 5),
      };
    }),
  };
}

const EXPLAIN_PROMPT = (
  intent: BaseIntent,
  products: NormalizedProduct[],
  noun: string,
) => `Write recommendation explanations for these ${noun} choices.

Shopping intent:
${JSON.stringify(intent, null, 2)}

Products (complete evidence — the ONLY permitted source of product facts):
${JSON.stringify(products.map(candidateEvidence), null, 2)}

Return JSON:
{
  "explanations": [
    {
      "productId": "<id>",
      "reasons": ["1-3 short reasons: why it fits the intent and which stated preference it satisfies"],
      "tradeoff": "one honest trade-off grounded in the evidence (price, missing rating, low stock, generic, etc.)",
      "evidence": [{ "claim": "specific claim you made", "sourceField": "the evidence field it came from (e.g. title, description, price, rating, features)" }]
    }
  ]
}

Rules:
- Every product exactly once.
- No delivery-time promises. No invented materials, ingredients, dimensions, or policies.
- If evidence is thin, say so in the tradeoff rather than embellishing.`;

export async function explainRecommendations(
  intent: BaseIntent,
  products: NormalizedProduct[],
  opts: ExplainOptions = {},
): Promise<{ explanations: Explanations; aiMode: AiMode }> {
  const noun = opts.noun ?? "pick";
  if (products.length === 0) {
    return { explanations: { explanations: [] }, aiMode: "heuristic" };
  }
  if (!aiAvailable()) {
    return {
      explanations: heuristicExplanations(intent, products, opts),
      aiMode: "heuristic",
    };
  }
  try {
    const explanations = await structuredCompletion(
      opts.persona ?? GIFTLENS_SYSTEM,
      EXPLAIN_PROMPT(intent, products, noun),
      ExplanationsSchema,
      { maxTokens: 2000 },
    );
    const seen = new Set(explanations.explanations.map((e) => e.productId));
    const missing = products.filter((p) => !seen.has(p.id));
    if (missing.length > 0) {
      explanations.explanations.push(
        ...heuristicExplanations(intent, missing, opts).explanations,
      );
    }
    return { explanations, aiMode: "ai" };
  } catch (err) {
    logger.warn("explanations via model failed; using heuristic", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      explanations: heuristicExplanations(intent, products, opts),
      aiMode: "heuristic",
    };
  }
}
