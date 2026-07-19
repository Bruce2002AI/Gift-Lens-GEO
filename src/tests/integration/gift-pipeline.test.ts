import { beforeEach, describe, expect, it } from "vitest";
import { heuristicIntent } from "@/lib/ai/intent";
import { _clearCatalogCachesForTests } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { runGiftPipeline, runConcierge } from "@/lib/gift/orchestration";

// CATALOG_MODE=mock is set in vitest.config.ts — the full pipeline runs
// against fixtures with no network and no Anthropic key (heuristic AI mode).

const DEMO =
  "Housewarming gift for my sister in Bengaluru. She loves coffee and Scandinavian design, hates clutter, and my budget is ₹4,000.";

describe("runGiftPipeline (mock catalog, heuristic AI)", () => {
  beforeEach(() => _clearCatalogCachesForTests());

  it("returns a ranked set of budget-respecting picks — a spotlight trio plus a 'more' tier", async () => {
    const intent = heuristicIntent([{ role: "user", content: DEMO }]);
    const trace = new TraceCollector();
    const result = await runGiftPipeline(intent, trace);

    // More than the old fixed trio: three spotlight roles + additional matches.
    expect(result.recommendations.length).toBeGreaterThan(3);
    expect(result.source).toBe("mock");
    expect(result.aiMode).toBe("heuristic");

    const spotlight = result.recommendations.filter((r) => r.role !== "more");
    const more = result.recommendations.filter((r) => r.role === "more");

    // The first three carry the signature spotlight roles; the rest are "more".
    expect(result.recommendations.slice(0, 3).every((r) => r.role !== "more")).toBe(true);
    expect(new Set(spotlight.map((r) => r.role))).toEqual(
      new Set(["best_match", "delight_pick", "safe_pick"]),
    );
    expect(more.length).toBeGreaterThan(0);

    // Distinct products throughout.
    expect(new Set(result.recommendations.map((r) => r.productId)).size).toBe(
      result.recommendations.length,
    );
    // Best Match has the single highest total; the "more" tier is pure
    // total-desc (the spotlight delight/safe picks are deliberately curated for
    // novelty/dependability, so they need not sit in raw-total order).
    const bestMatch = result.recommendations.find((r) => r.role === "best_match")!;
    expect(bestMatch.totalScore).toBe(
      Math.max(...result.recommendations.map((r) => r.totalScore)),
    );
    const moreTotals = more.map((r) => r.totalScore);
    expect([...moreTotals].sort((a, b) => b - a)).toEqual(moreTotals);

    // Hard budget respected on EVERY pick — spotlight and "more" alike.
    for (const rec of result.recommendations) {
      expect(rec.product.priceRange.minMinor).not.toBeNull();
      expect(rec.product.priceRange.minMinor!).toBeLessThanOrEqual(400000);
      expect(rec.product.priceRange.currency).toBe("INR");
      expect(rec.reasons.length).toBeGreaterThanOrEqual(1);
      expect(rec.tradeoff.length).toBeGreaterThan(0);
      expect(rec.product.variants.some((v) => v.available)).toBe(true);
    }

    // Real tool activity: ≥3 strategy searches + get_product on the spotlight
    // only (the "more" tier is re-validated lazily when a card is opened).
    const events = trace.list();
    const searches = events.filter((e) => e.tool === "search_catalog");
    const productCalls = events.filter((e) => e.tool === "get_product");
    expect(searches.length).toBeGreaterThanOrEqual(3);
    expect(productCalls.length).toBeGreaterThanOrEqual(3);
    expect(productCalls.length).toBeLessThan(result.recommendations.length);
    expect(events.every((e) => e.source === "mock" || e.tool === "ai" || e.tool === "pipeline")).toBe(true);
  });

  it("excludes disliked categories from the picks", async () => {
    const intent = heuristicIntent([
      {
        role: "user",
        content:
          "Housewarming gift for my sister, she loves coffee, no candles please, budget ₹4,000",
      },
    ]);
    const trace = new TraceCollector();
    const result = await runGiftPipeline(intent, trace);
    for (const rec of result.recommendations) {
      expect(rec.product.title.toLowerCase()).not.toContain("candle");
    }
  });

  it("reports a limitation instead of padding when constraints are impossible", async () => {
    const intent = heuristicIntent([
      { role: "user", content: "Gift for my sister who loves coffee, budget ₹50" },
    ]);
    const trace = new TraceCollector();
    const result = await runGiftPipeline(intent, trace);
    expect(result.recommendations.length).toBeLessThan(3);
    expect(result.limitation).toBeTruthy();
  });
});

describe("runConcierge", () => {
  it("returns a full recommendations response for the demo conversation", async () => {
    const response = await runConcierge({
      conversation: [{ role: "user", content: DEMO }],
    });
    expect(response.ok).toBe(true);
    expect(response.stage).toBe("recommendations");
    expect(response.recommendations.length).toBeGreaterThanOrEqual(3);
    // First three are the signature spotlight roles.
    expect(new Set(response.recommendations.slice(0, 3).map((r) => r.role))).toEqual(
      new Set(["best_match", "delight_pick", "safe_pick"]),
    );
    expect(response.intent?.budget.maxMinor).toBe(400000);
    expect(response.aiMode).toBe("heuristic");
    expect(response.trace.length).toBeGreaterThan(0);
  });
});
