import "server-only";
import pLimit from "p-limit";
import { searchCatalog } from "@/lib/catalog/client";
import type { TraceCollector } from "@/lib/catalog/trace";
import type { NormalizedProduct } from "@/lib/catalog/types";
import { formatMinorRange } from "@/lib/gift/currency";
import type {
  CompetitorCard,
  VisibilitySummary,
  VisibilityTest,
} from "./types";

export interface VisibilityContext {
  country: string;
  currency: string;
  /** Hard budget filter in MINOR units, already converted upstream. */
  budgetMaxMinor: number | null;
}

/**
 * Prompt-visibility suite: run search_catalog for each customer-intent
 * prompt and record whether the audited product appears. Failed searches are
 * marked failed — never counted as "not visible".
 */

const VISIBILITY_LIMIT = pLimit(3);
const RESULTS_TO_INSPECT = 20;

function matchInResults(
  target: NormalizedProduct,
  results: NormalizedProduct[],
): { position: number; matchType: "product" | "variant" } | null {
  const targetVariantIds = new Set(target.variants.map((v) => v.id));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.id === target.id) return { position: i + 1, matchType: "product" };
    if (r.variants.some((v) => targetVariantIds.has(v.id))) {
      return { position: i + 1, matchType: "variant" };
    }
  }
  return null;
}

function hardFilterRisk(
  target: NormalizedProduct,
  input: VisibilityContext,
): string | null {
  const risks: string[] = [];
  if (
    input.budgetMaxMinor != null &&
    target.priceRange.minMinor != null &&
    target.priceRange.minMinor > input.budgetMaxMinor
  ) {
    risks.push("product price exceeds the test budget filter");
  }
  if (!target.variants.some((v) => v.available === true)) {
    risks.push("no available variant — the default available:true filter excludes it");
  }
  return risks.length > 0 ? risks.join("; ") : null;
}

export async function runVisibilitySuite(
  target: NormalizedProduct,
  prompts: string[],
  input: VisibilityContext,
  trace: TraceCollector,
): Promise<{ summary: VisibilitySummary; competitors: CompetitorCard[] }> {
  const competitorStats = new Map<
    string,
    { product: NormalizedProduct; appearances: number; bestPosition: number }
  >();

  const tests: VisibilityTest[] = await Promise.all(
    prompts.map((prompt) =>
      VISIBILITY_LIMIT(async (): Promise<VisibilityTest> => {
        const timestamp = new Date().toISOString();
        try {
          const result = await searchCatalog(
            {
              query: prompt,
              context: {
                country: input.country,
                currency: input.currency,
                intent: "gift shopping visibility test",
              },
              filters: {
                available: true,
                shipsTo: input.country,
                priceMaxMinor: input.budgetMaxMinor ?? null,
              },
              limit: RESULTS_TO_INSPECT,
            },
            trace,
            // A fixture target can only ever appear in the fixture catalog —
            // testing it against live search would fake 0% visibility.
            target.id.startsWith("mock:") ? { forceSource: "mock" } : undefined,
          );
          const inspected = result.products.slice(0, RESULTS_TO_INSPECT);
          const match = matchInResults(target, inspected);
          // Track visible competitors (top 5 per prompt, excluding the target).
          inspected
            .filter((p) => p.id !== target.id)
            .slice(0, 5)
            .forEach((p, idx) => {
              const existing = competitorStats.get(p.id);
              if (existing) {
                existing.appearances += 1;
                existing.bestPosition = Math.min(existing.bestPosition, idx + 1);
              } else {
                competitorStats.set(p.id, {
                  product: p,
                  appearances: 1,
                  bestPosition: idx + 1,
                });
              }
            });
          const warning =
            result.messages.find((m) => m.type === "warning")?.message ?? null;
          return {
            prompt,
            status: match ? "appeared" : "not_observed",
            position: match?.position ?? null,
            resultsInspected: inspected.length,
            topCompetitor: inspected[0]
              ? {
                  id: inspected[0].id,
                  title: inspected[0].title,
                  seller: inspected[0].variants[0]?.seller?.name ?? null,
                }
              : null,
            matchType: match?.matchType ?? null,
            timestamp,
            warning,
            hardFilterRisk: match ? null : hardFilterRisk(target, input),
          };
        } catch (err) {
          return {
            prompt,
            status: "failed",
            position: null,
            resultsInspected: 0,
            topCompetitor: null,
            matchType: null,
            timestamp,
            warning:
              err instanceof Error ? err.message.slice(0, 160) : "search failed",
            hardFilterRisk: null,
          };
        }
      }),
    ),
  );

  const attempted = tests.filter((t) => t.status !== "failed");
  const appeared = attempted.filter((t) => t.status === "appeared");
  const positions = appeared
    .map((t) => t.position)
    .filter((p): p is number => p != null);

  const summary: VisibilitySummary = {
    tests,
    coverage: attempted.length > 0 ? appeared.length / attempted.length : 0,
    topThreeCount: positions.filter((p) => p <= 3).length,
    averagePosition:
      positions.length > 0
        ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
        : null,
    notObservedCount: attempted.filter((t) => t.status === "not_observed").length,
    failedCount: tests.filter((t) => t.status === "failed").length,
    attemptedCount: attempted.length,
  };

  const competitors: CompetitorCard[] = [...competitorStats.values()]
    .sort((a, b) => b.appearances - a.appearances || a.bestPosition - b.bestPosition)
    .slice(0, 6)
    .map(({ product, appearances, bestPosition }) => ({
      id: product.id,
      title: product.title,
      seller: product.variants[0]?.seller?.name ?? null,
      appearances,
      bestPosition,
      priceLabel: formatMinorRange(
        product.priceRange.minMinor,
        product.priceRange.maxMinor,
        product.priceRange.currency,
      ),
      imageUrl: product.images[0]?.url ?? null,
    }));

  return { summary, competitors };
}
