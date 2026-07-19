import { beforeEach, describe, expect, it, vi } from "vitest";

// A shared, hoisted set of product ids whose FRESH get_product data should be
// forced to fail hard constraints (all variants unavailable), diverging from
// their search-time data.
const { FAIL_IDS } = vi.hoisted(() => ({ FAIL_IDS: new Set<string>() }));

vi.mock("@/lib/catalog/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog/client")>();
  return {
    ...actual,
    getProduct: vi.fn(async (params: Parameters<typeof actual.getProduct>[0], trace: Parameters<typeof actual.getProduct>[1]) => {
      const res = await actual.getProduct(params, trace);
      if (res.product && FAIL_IDS.has(res.product.id)) {
        return {
          ...res,
          product: {
            ...res.product,
            variants: res.product.variants.map((v) => ({ ...v, available: false })),
          },
        };
      }
      return res;
    }),
  };
});

import { heuristicIntent } from "@/lib/ai/intent";
import { _clearCatalogCachesForTests } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { runGiftPipeline } from "@/lib/gift/orchestration";

const DEMO =
  "Housewarming gift for my sister in Bengaluru. She loves coffee and Scandinavian design, and my budget is ₹4,000.";

describe("more-tier honesty — proven-ineligible picks never resurface", () => {
  beforeEach(() => {
    FAIL_IDS.clear();
    _clearCatalogCachesForTests();
  });

  it("drops a pick whose fresh get_product fails constraints instead of demoting it to 'more'", async () => {
    const intent = heuristicIntent([{ role: "user", content: DEMO }]);

    // First run: capture the Best Match id (top of the ranked pool).
    const first = await runGiftPipeline(intent, new TraceCollector());
    const bestId = first.recommendations.find((r) => r.role === "best_match")!.productId;
    expect(first.recommendations.some((r) => r.productId === bestId)).toBe(true);

    // Force that product's fresh data to be out of stock, then re-run.
    FAIL_IDS.add(bestId);
    _clearCatalogCachesForTests();
    const second = await runGiftPipeline(intent, new TraceCollector());

    // It must not appear anywhere — not as a spotlight pick, not in "more".
    expect(second.recommendations.some((r) => r.productId === bestId)).toBe(false);
    // The pipeline still returns a coherent set with a different Best Match.
    expect(second.recommendations.length).toBeGreaterThan(0);
    expect(second.recommendations[0].role).toBe("best_match");
    expect(second.recommendations[0].productId).not.toBe(bestId);
  });
});
