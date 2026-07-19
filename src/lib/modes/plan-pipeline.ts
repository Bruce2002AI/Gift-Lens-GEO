import "server-only";
import pLimit from "p-limit";
import { explainRecommendations, heuristicExplanations } from "@/lib/ai/explanations";
import { heuristicSemanticScores } from "@/lib/ai/reranker";
import { getProduct, searchCatalog } from "@/lib/catalog/client";
import type { TraceCollector } from "@/lib/catalog/trace";
import type { CatalogSource, NormalizedProduct } from "@/lib/catalog/types";
import { checkHardConstraints, logisticsMessage } from "@/lib/gift/constraints";
import { dedupeProducts } from "@/lib/gift/diversity";
import { confidenceFor, scoreCandidate, type ScoredCandidate } from "@/lib/gift/ranking";
import { logger } from "@/lib/logger";
import { allocateBudget, sumMinor } from "./budget";
import { searchParamsFor, buyerContext } from "./picks-pipeline";
import type {
  AiMode,
  BaseIntent,
  Blueprint,
  Pick,
  PlanComponentResult,
  PlanResult,
} from "./types";

/**
 * Shared "plan" pipeline (skincare, style, nutrition, room, travel, hobby,
 * lifestage, occasion). Takes an approved blueprint of components, allocates the
 * budget across them, searches the catalog once per component, and resolves each
 * to a primary product + alternatives with a running total. Reuses the same
 * constraints / ranking / explanations as the picks pipeline, on BaseIntent.
 */

const RESULTS_PER_COMPONENT = 12;
const MAX_ALTERNATIVES = 2;
const limit = pLimit(4);

export interface RunPlanInput {
  intent: BaseIntent;
  blueprint: Blueprint;
  trace: TraceCollector;
  persona?: string;
  noun?: string;
  extraConstraint?: (product: NormalizedProduct) => string[];
}

function combinedSource(sources: CatalogSource[]): CatalogSource | "mixed" {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return "live";
  return unique.length === 1 ? unique[0] : "mixed";
}

/** A product's cheapest price in minor units IF its currency matches the budget. */
function comparableMinor(product: NormalizedProduct, currency: string): number | null {
  const productCurrency = (
    product.priceRange.currency ??
    product.variants.find((v) => v.currency)?.currency ??
    null
  )?.toUpperCase();
  if (productCurrency != null && productCurrency !== currency.toUpperCase()) return null;
  return product.priceRange.minMinor ?? null;
}

function differsFrom(a: NormalizedProduct, b: NormalizedProduct): boolean {
  const merchant = (p: NormalizedProduct) => p.variants[0]?.seller?.name?.toLowerCase() ?? "";
  const category = (p: NormalizedProduct) =>
    p.categories[0]?.value.split(">")[0]?.trim().toLowerCase() ?? "";
  return merchant(a) !== merchant(b) || category(a) !== category(b);
}

export async function runPlanPipeline(
  input: RunPlanInput,
): Promise<{ plan: PlanResult; source: CatalogSource | "mixed"; aiMode: AiMode }> {
  const { intent, blueprint, trace, persona, noun, extraConstraint } = input;
  const currency = intent.budget.currency;

  trace.add({
    tool: "ai",
    label: `Planned ${blueprint.components.length} plan components`,
    detail: blueprint.components.map((c) => c.label).join(" | "),
    durationMs: 0,
    source: "live",
    ok: true,
  });

  const slices = allocateBudget(
    intent.budget.maxMinor,
    blueprint.components.map((c) => c.budgetWeight),
  );
  const constraintOpts = { catalogBudgetFilterApplied: intent.budget.maxMinor != null };
  const passes = (p: NormalizedProduct, capMinor: number | null): boolean => {
    // Per-component budget is a MAX slice only. The order-level minimum is a
    // whole-plan floor, not a per-item requirement, so it must not be enforced
    // per component (that would empty every slice below the order minimum). Uses
    // the same budget-filter semantics as the picks pipeline for consistency.
    const capped: BaseIntent =
      capMinor == null
        ? { ...intent, budget: { ...intent.budget, minMinor: null } }
        : { ...intent, budget: { ...intent.budget, maxMinor: capMinor, minMinor: null } };
    return (
      checkHardConstraints(p, capped, constraintOpts).pass &&
      (extraConstraint ? extraConstraint(p).length === 0 : true)
    );
  };

  const sources: CatalogSource[] = [];

  // 1. Resolve each component in parallel: search → constrain → rank → pick.
  const resolved = await Promise.all(
    blueprint.components.map((component, i) =>
      limit(async (): Promise<{
        result: PlanComponentResult;
        candidates: NormalizedProduct[];
      }> => {
        const cap = slices[i];
        const params = searchParamsFor(intent, component.query);
        // Per-component search uses the slice as the MAX and drops the
        // order-level MIN (a whole-plan floor, not a per-item requirement) —
        // otherwise the catalog empties every slice below the order minimum.
        params.filters = { ...params.filters, priceMinMinor: null, priceMaxMinor: cap };
        params.limit = RESULTS_PER_COMPONENT;

        let products: NormalizedProduct[] = [];
        try {
          const res = await searchCatalog(params, trace);
          products = res.products;
          sources.push(res.source);
        } catch (err) {
          logger.warn("component search failed", {
            component: component.key,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const eligible = dedupeProducts(products).filter((p) => passes(p, cap));
        const scores = heuristicSemanticScores(intent, eligible);
        const byId = new Map(scores.scores.map((s) => [s.productId, s]));
        const ranked = eligible
          .map((p) => scoreCandidate(p, intent, byId.get(p.id)))
          .sort((a, b) => b.total - a.total);

        const chosen: ScoredCandidate[] = [];
        for (const c of ranked) {
          if (chosen.length === 0) {
            chosen.push(c);
          } else if (
            chosen.length <= MAX_ALTERNATIVES &&
            chosen.every((x) => differsFrom(c.product, x.product))
          ) {
            chosen.push(c);
          }
          if (chosen.length > MAX_ALTERNATIVES) break;
        }
        // Backfill alternatives if diversity left us short.
        for (const c of ranked) {
          if (chosen.length > MAX_ALTERNATIVES) break;
          if (!chosen.includes(c)) chosen.push(c);
        }

        return {
          result: {
            key: component.key,
            label: component.label,
            why: component.why,
            essential: component.essential,
            group: component.group,
            primary: null,
            alternatives: [],
            note: chosen.length === 0 ? "No in-budget match cleared the constraints." : null,
          },
          candidates: chosen.map((c) => c.product),
        };
      }),
    ),
  );

  // 2. Validate the primary with get_product. A candidate whose FRESH data
  //    fails the (budget-verified) constraint is dropped entirely — never shown
  //    as a primary or an alternative — and the next candidate is promoted, so
  //    a proven-ineligible product can't appear as verified. (Mirrors the picks
  //    pipeline.) A thrown error leaves the search-data candidate as-is
  //    (unknown state, re-validated when its card is opened).
  await Promise.all(
    resolved.map((r, i) =>
      limit(async () => {
        const component = blueprint.components[i];
        const hadCandidates = r.candidates.length > 0;
        while (r.candidates.length > 0) {
          const candidate = r.candidates[0];
          try {
            const fresh = await getProduct(
              { productId: candidate.id, context: buyerContext(intent) },
              trace,
            );
            if (fresh.product && passes(fresh.product, slices[i])) {
              r.candidates[0] = fresh.product; // upgrade primary to fresh data
              break;
            }
            if (fresh.product) {
              r.candidates.shift(); // fresh data proves it ineligible → drop it
              continue;
            }
            break; // couldn't resolve — keep the search-data candidate
          } catch (err) {
            logger.warn("component primary validation failed", {
              component: component.key,
              error: err instanceof Error ? err.message : String(err),
            });
            break; // unknown state — keep the search-data candidate
          }
        }
        // Only relabel components that had candidates the fresh check then
        // rejected — don't overwrite a genuine search/constraint miss.
        if (hadCandidates && r.candidates.length === 0) {
          r.result.note = "No in-budget match cleared the fresh availability check.";
        }
      }),
    ),
  );

  // 3. Explanations: model for primaries, heuristic for alternatives.
  const primaries = resolved.map((r) => r.candidates[0]).filter(Boolean) as NormalizedProduct[];
  const { explanations, aiMode: explainMode } = await explainRecommendations(
    intent,
    primaries,
    { persona, noun },
  );
  const primaryExpl = new Map(explanations.explanations.map((e) => [e.productId, e]));
  const altProducts = resolved.flatMap((r) => r.candidates.slice(1));
  const altExpl = new Map(
    heuristicExplanations(intent, altProducts, { noun }).explanations.map((e) => [e.productId, e]),
  );

  const toPick = (
    product: NormalizedProduct,
    role: string,
    source: CatalogSource,
    explanation: { reasons: string[]; tradeoff: string; evidence: Array<{ claim: string; sourceField: string }> } | undefined,
  ): Pick => {
    const scored = scoreCandidate(product, intent, undefined);
    return {
      role,
      productId: product.id,
      variantId: product.variants.find((v) => v.available)?.id ?? null,
      totalScore: scored.total,
      scoreBreakdown: scored.breakdown,
      reasons: explanation?.reasons ?? ["Fits this step of the plan from catalog data."],
      tradeoff: explanation?.tradeoff ?? "Limited evidence beyond the listing.",
      evidence: explanation?.evidence ?? [],
      confidence: confidenceFor(scored),
      logisticsMessage: logisticsMessage(product, intent),
      product,
      source,
    };
  };

  const fallbackSource: CatalogSource = sources[0] ?? "live";
  const components: PlanComponentResult[] = resolved.map((r) => {
    const products = r.candidates;
    if (products.length === 0) return r.result;
    const [primary, ...alts] = products;
    return {
      ...r.result,
      primary: toPick(primary, "primary", fallbackSource, primaryExpl.get(primary.id)),
      alternatives: alts.map((p) => toPick(p, "alternative", fallbackSource, altExpl.get(p.id))),
      note: null,
    };
  });

  // 4. Total = sum of primaries (null if any primary lacks a comparable price).
  const totalMinor = sumMinor(
    components.map((c) => (c.primary ? comparableMinor(c.primary.product, currency) : null)),
  );

  const missingEssential = components.filter((c) => c.essential && !c.primary);
  const limitation =
    missingEssential.length > 0
      ? `Couldn't find an in-budget match for ${missingEssential
          .map((c) => c.label.toLowerCase())
          .join(", ")}. Try widening the budget or relaxing a preference.`
      : null;

  const aiMode: AiMode = explainMode === "ai" ? "ai" : "heuristic";

  return {
    plan: { components, totalMinor, currency, limitation },
    source: combinedSource(sources),
    aiMode,
  };
}
