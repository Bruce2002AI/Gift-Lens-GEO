import "server-only";
import pLimit from "p-limit";
import { explainRecommendations, heuristicExplanations } from "@/lib/ai/explanations";
import { heuristicSemanticScores } from "@/lib/ai/reranker";
import { getProduct, searchCatalog } from "@/lib/catalog/client";
import type { TraceCollector } from "@/lib/catalog/trace";
import type {
  BuyerContext,
  CatalogSource,
  NormalizedProduct,
  SearchParams,
} from "@/lib/catalog/types";
import { checkHardConstraints, logisticsMessage } from "@/lib/gift/constraints";
import { assignRoles, dedupeProducts } from "@/lib/gift/diversity";
import { confidenceFor, scoreCandidate, type ScoredCandidate } from "@/lib/gift/ranking";
import { logger } from "@/lib/logger";
import type { AiMode, BaseIntent, Pick } from "./types";

/**
 * Shared "ranked picks" pipeline (Gift, Swap). Generalized from the gift
 * concierge: three search strategies → merge/dedupe → hard constraints →
 * heuristic scoring → diversity-aware spotlight trio (Best/Delight/Safe) +
 * a "more" tier → get_product validation of the spotlight → evidence-grounded
 * explanations. Operates purely on BaseIntent so every picks-mode reuses it.
 */

const RESULTS_PER_STRATEGY = 20;
const CANDIDATE_POOL = 30;
const SPOTLIGHT_COUNT = 3;
const DISPLAY_MAX = 18;
const limit = pLimit(4);

export function buyerContext(intent: BaseIntent): BuyerContext {
  return {
    country: intent.destination.country,
    region: intent.destination.region,
    postalCode: intent.destination.postalCode,
    currency: intent.budget.currency,
    intent: [
      intent.occasion ? `${intent.occasion} shopping` : "shopping",
      intent.interests[0] ? `for someone into ${intent.interests[0]}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function searchParamsFor(
  intent: BaseIntent,
  query: string,
  like?: SearchParams["like"],
): SearchParams {
  return {
    query,
    like: like ?? null,
    context: buyerContext(intent),
    filters: {
      available: true,
      shipsTo: intent.destination.country,
      priceMinMinor: intent.budget.minMinor,
      priceMaxMinor: intent.budget.maxMinor,
    },
    limit: RESULTS_PER_STRATEGY,
  };
}

export interface PicksPipelineResult {
  recommendations: Pick[];
  source: CatalogSource | "mixed";
  limitation: string | null;
  aiMode: AiMode;
}

function combinedSource(sources: CatalogSource[]): CatalogSource | "mixed" {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return "live";
  return unique.length === 1 ? unique[0] : "mixed";
}

export interface RunPicksInput {
  intent: BaseIntent;
  /** Search strategy queries, plus whether the plan itself came from the model. */
  plan: { strategies: Array<{ query: string }>; aiMode: AiMode };
  trace: TraceCollector;
  /** Similarity seed (product id / inspiration image) applied to every search. */
  like?: SearchParams["like"];
  /** System persona for the explanation model call. */
  persona?: string;
  /** What to call an item in copy ("gift", "alternative"…). */
  noun?: string;
  /** Extra hard constraints beyond budget/availability/destination/exclusions. */
  extraConstraint?: (product: NormalizedProduct) => string[];
  /** A broadening fallback query when too few candidates clear constraints. */
  broadenQuery?: string;
}

export async function runPicksPipeline(input: RunPicksInput): Promise<PicksPipelineResult> {
  const { intent, plan, trace, like, persona, noun, extraConstraint } = input;
  const planMode = plan.aiMode;

  trace.add({
    tool: "ai",
    label: `Planned ${plan.strategies.length} search strategies (${planMode})`,
    detail: plan.strategies.map((s) => s.query).join(" | "),
    durationMs: 0,
    source: "live",
    ok: true,
  });

  // 1. Execute searches in parallel; tolerate individual failures.
  const settled = await Promise.allSettled(
    plan.strategies.map((s) =>
      limit(() => searchCatalog(searchParamsFor(intent, s.query, like), trace)),
    ),
  );
  const sources: CatalogSource[] = [];
  const sourceByProductId = new Map<string, CatalogSource>();
  let merged: NormalizedProduct[] = [];
  let failures = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      merged.push(...result.value.products);
      sources.push(result.value.source);
      for (const p of result.value.products) {
        if (!sourceByProductId.has(p.id)) sourceByProductId.set(p.id, result.value.source);
      }
    } else {
      failures++;
    }
  }
  if (failures === settled.length && settled.length > 0) {
    throw settled.find((s): s is PromiseRejectedResult => s.status === "rejected")!.reason;
  }

  const constraintOpts = { catalogBudgetFilterApplied: intent.budget.maxMinor != null };
  const passes = (p: NormalizedProduct): boolean =>
    checkHardConstraints(p, intent, constraintOpts).pass &&
    (extraConstraint ? extraConstraint(p).length === 0 : true);

  // 2. Dedupe + hard constraints.
  merged = dedupeProducts(merged);
  let eligible = merged.filter(passes);

  // 3. Graceful expansion — broaden soft wording only.
  if (eligible.length < SPOTLIGHT_COUNT && input.broadenQuery) {
    try {
      const broadened = await searchCatalog(searchParamsFor(intent, input.broadenQuery, like), trace);
      sources.push(broadened.source);
      for (const p of broadened.products) {
        if (!sourceByProductId.has(p.id)) sourceByProductId.set(p.id, broadened.source);
      }
      eligible = dedupeProducts([...eligible, ...broadened.products]).filter(passes);
    } catch (err) {
      logger.warn("broadened search failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (eligible.length === 0) {
    return {
      recommendations: [],
      source: combinedSource(sources),
      limitation:
        "No products satisfied every hard constraint (budget, availability, destination, exclusions). Try widening the budget or relaxing an exclusion.",
      aiMode: planMode,
    };
  }

  // 4. Score + rank a broad pool with the fast deterministic heuristic.
  const pool = eligible.slice(0, CANDIDATE_POOL);
  const scores = heuristicSemanticScores(intent, pool);
  const semanticById = new Map(scores.scores.map((s) => [s.productId, s]));
  const ranked: ScoredCandidate[] = pool
    .map((p) => scoreCandidate(p, intent, semanticById.get(p.id)))
    .sort((a, b) => b.total - a.total);

  // 5. Spotlight roles.
  const assignments = assignRoles(ranked);
  const assignedIds = new Set(assignments.map((a) => a.candidate.product.id));
  const understudies = ranked
    .filter((c) => !assignedIds.has(c.product.id))
    .sort((a, b) => b.total - a.total);

  const spotlight: Array<{
    role: string;
    candidate: ScoredCandidate;
    product: NormalizedProduct;
    variantId: string | null;
    source: CatalogSource;
  }> = [];
  const revalidatedInvalid = new Set<string>();

  for (const assignment of assignments) {
    let current: ScoredCandidate | undefined = assignment.candidate;
    while (current) {
      try {
        const fresh = await getProduct(
          { productId: current.product.id, context: buyerContext(intent) },
          trace,
        );
        const product = fresh.product;
        const stillValid = product != null && passes(product);
        if (product && stillValid) {
          const variant =
            fresh.selectedVariant ?? product.variants.find((v) => v.available) ?? null;
          spotlight.push({
            role: assignment.role,
            candidate: current,
            product,
            variantId: variant?.id ?? null,
            source: fresh.source,
          });
          break;
        }
        if (product) revalidatedInvalid.add(current.product.id);
      } catch (err) {
        logger.warn("get_product validation failed; promoting understudy", {
          productId: current.product.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      current = understudies.shift();
    }
  }

  // 6. "more" tier — further ranked matches (never re-shows a proven-ineligible product).
  const spotlightIds = new Set(spotlight.map((s) => s.candidate.product.id));
  const moreCandidates = ranked
    .filter((c) => !spotlightIds.has(c.product.id) && !revalidatedInvalid.has(c.product.id))
    .slice(0, Math.max(0, DISPLAY_MAX - spotlight.length));

  // 7. Explanations — model for the spotlight, grounded heuristic for the rest.
  const { explanations, aiMode: explainMode } = await explainRecommendations(
    intent,
    spotlight.map((s) => s.product),
    { persona, noun },
  );
  const explanationById = new Map(explanations.explanations.map((e) => [e.productId, e]));
  const moreExplanationById = new Map(
    heuristicExplanations(
      intent,
      moreCandidates.map((c) => c.product),
      { noun },
    ).explanations.map((e) => [e.productId, e]),
  );

  const fallbackSource: CatalogSource = sources[0] ?? "live";
  const toPick = (
    role: string,
    candidate: ScoredCandidate,
    product: NormalizedProduct,
    variantId: string | null,
    source: CatalogSource,
    explanation: { reasons: string[]; tradeoff: string; evidence: Array<{ claim: string; sourceField: string }> } | undefined,
  ): Pick => ({
    role,
    productId: product.id,
    variantId,
    totalScore: candidate.total,
    scoreBreakdown: candidate.breakdown,
    reasons: explanation?.reasons ?? ["Matches the brief from catalog data."],
    tradeoff: explanation?.tradeoff ?? "Limited evidence beyond the listing.",
    evidence: explanation?.evidence ?? [],
    confidence: confidenceFor(candidate),
    logisticsMessage: logisticsMessage(product, intent),
    product,
    source,
  });

  const recommendations: Pick[] = [
    ...spotlight.map((s) =>
      toPick(s.role, s.candidate, s.product, s.variantId, s.source, explanationById.get(s.product.id)),
    ),
    ...moreCandidates.map((c) =>
      toPick(
        "more",
        c,
        c.product,
        c.product.variants.find((v) => v.available)?.id ?? null,
        sourceByProductId.get(c.product.id) ?? fallbackSource,
        moreExplanationById.get(c.product.id),
      ),
    ),
  ];

  const aiMode: AiMode = planMode === "ai" || explainMode === "ai" ? "ai" : "heuristic";

  return {
    recommendations,
    source: combinedSource([...sources, ...recommendations.map((r) => r.source)]),
    limitation:
      recommendations.length < SPOTLIGHT_COUNT
        ? `Only ${recommendations.length} product${recommendations.length === 1 ? "" : "s"} cleared every hard constraint (budget, availability, destination, exclusions). ShopLens does not pad results — try widening the budget or relaxing an exclusion to see more.`
        : null,
    aiMode,
  };
}
