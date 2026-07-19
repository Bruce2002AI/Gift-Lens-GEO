import { beforeEach, describe, expect, it } from "vitest";
import { _clearCatalogCachesForTests } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { runPlanPipeline } from "@/lib/modes/plan-pipeline";
import type { BaseIntent, Blueprint } from "@/lib/modes/types";

// CATALOG_MODE=mock (vitest.config) — the plan pipeline runs against the coffee
// fixtures with no network and no model (heuristic explanations).

const intent: BaseIntent = {
  budget: { minMajor: null, maxMajor: 8000, minMinor: null, maxMinor: 800000, currency: "INR" },
  destination: { country: "IN", region: null, city: null, postalCode: null },
  physicality: "physical",
  deadline: null,
  hardConstraints: [],
  exclusions: [],
  softPreferences: [],
  searchThemes: ["coffee"],
  interests: ["coffee"],
  occasion: null,
  styleKeywords: [],
  clarificationNeeded: false,
  clarificationQuestion: null,
};

const blueprint: Blueprint = {
  components: [
    { key: "dripper", label: "Pour-over dripper", why: "The brewing device.", essential: true, query: "pour over coffee", budgetWeight: 1.5, group: "Essentials" },
    { key: "grinder", label: "Grinder", why: "Fresh grounds.", essential: true, query: "coffee grinder", budgetWeight: 1.5, group: "Essentials" },
    { key: "mug", label: "Mug", why: "Something to drink from.", essential: false, query: "coffee mug", budgetWeight: 1, group: "Useful additions" },
  ],
  note: null,
};

describe("runPlanPipeline (mock catalog)", () => {
  beforeEach(() => _clearCatalogCachesForTests());

  it("resolves plan components to real products with alternatives and a total", async () => {
    const trace = new TraceCollector();
    const { plan, source } = await runPlanPipeline({ intent, blueprint, trace, noun: "item" });

    expect(source).toBe("mock");
    expect(plan.components).toHaveLength(3);

    // At least the two essential components resolve to a primary from fixtures.
    const withPrimary = plan.components.filter((c) => c.primary);
    expect(withPrimary.length).toBeGreaterThanOrEqual(2);

    // Every resolved primary respects the budget and currency, and carries reasons.
    for (const c of withPrimary) {
      const p = c.primary!;
      expect(p.product.priceRange.currency).toBe("INR");
      expect(p.product.priceRange.minMinor!).toBeLessThanOrEqual(800000);
      expect(p.reasons.length).toBeGreaterThanOrEqual(1);
      expect(p.product.variants.some((v) => v.available)).toBe(true);
    }

    // Grouping is preserved and the total is a real sum in INR.
    expect(new Set(plan.components.map((c) => c.group))).toContain("Essentials");
    expect(plan.totalMinor).not.toBeNull();
    expect(plan.currency).toBe("INR");

    // The trace shows per-component search activity + get_product on primaries.
    const events = trace.list();
    expect(events.filter((e) => e.tool === "search_catalog").length).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.tool === "get_product").length).toBeGreaterThanOrEqual(2);
  });

  it("flags a missing essential component honestly instead of inventing one", async () => {
    const trace = new TraceCollector();
    const impossible: Blueprint = {
      components: [
        { key: "unobtainium", label: "Nonexistent widget", why: "n/a", essential: true, query: "zzxqwv nonexistent product xyzzy", budgetWeight: 1, group: null },
      ],
      note: null,
    };
    const { plan } = await runPlanPipeline({ intent, blueprint: impossible, trace, noun: "item" });
    expect(plan.components[0].primary).toBeNull();
    expect(plan.limitation).toBeTruthy();
  });
});
