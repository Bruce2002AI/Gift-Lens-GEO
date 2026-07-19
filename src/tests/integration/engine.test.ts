import { beforeEach, describe, expect, it } from "vitest";
import { _clearCatalogCachesForTests } from "@/lib/catalog/client";
import { runAgent } from "@/lib/modes/engine";
import type { Blueprint, PlanResponse } from "@/lib/modes/types";

// CATALOG_MODE=mock, no model key → heuristic route/intent/blueprint.

describe("runAgent — approval gate (safety)", () => {
  beforeEach(() => _clearCatalogCachesForTests());

  it("does NOT bypass approval with a bare approved:true and no blueprint", async () => {
    const res = await runAgent({
      conversation: [{ role: "user", content: "a simple skincare routine for dry skin under 3000" }],
      modeId: "skincare",
      approved: true, // stale/forged flag — must still gate
    });
    expect(res.resultKind).toBe("plan");
    expect(res.stage).toBe("plan_approval");
    expect((res as PlanResponse).blueprint).toBeTruthy();
    // Safety disclaimer accompanies the gate.
    expect(res.disclaimer).toMatch(/educational|not medical advice/i);
  });

  it("runs the plan only when a concrete blueprint is submitted", async () => {
    const gate = (await runAgent({
      conversation: [{ role: "user", content: "a simple skincare routine under 3000" }],
      modeId: "skincare",
    })) as PlanResponse;
    expect(gate.stage).toBe("plan_approval");

    const run = await runAgent({
      conversation: [{ role: "user", content: "a simple skincare routine under 3000" }],
      modeId: "skincare",
      approved: true,
      blueprint: gate.blueprint!,
    });
    expect(run.stage).toBe("plan");
  });
});

describe("runAgent — safety enforcement", () => {
  beforeEach(() => _clearCatalogCachesForTests());

  it("strips blocked-claim sentences from a submitted blueprint's copy", async () => {
    const badBlueprint: Blueprint = {
      components: [
        {
          key: "serum",
          label: "Serum",
          why: "This serum treats acne and cures rosacea. It is gentle and fragrance-free.",
          essential: true,
          query: "gentle fragrance-free serum",
          budgetWeight: 1,
          group: null,
        },
      ],
      note: null,
    };
    const res = (await runAgent({
      conversation: [{ role: "user", content: "skincare routine" }],
      modeId: "skincare",
      approved: true,
      blueprint: badBlueprint,
    })) as PlanResponse;
    const why = res.blueprint!.components[0].why;
    expect(why).not.toMatch(/treats acne|cures rosacea/i);
    expect(why).toMatch(/gentle/i);
  });

  it("drops an unrequested supplement component (nutrition opt-in backstop)", async () => {
    const withSupplement: Blueprint = {
      components: [
        { key: "main", label: "Main protein", why: "core protein", essential: true, query: "high protein food", budgetWeight: 1, group: null },
        { key: "supplement", label: "Protein powder", why: "optional", essential: false, query: "protein powder", budgetWeight: 1, group: "Optional (opt-in)" },
      ],
      note: null,
    };
    const res = (await runAgent({
      conversation: [{ role: "user", content: "a convenient high-protein basket" }],
      modeId: "nutrition",
      approved: true,
      blueprint: withSupplement,
    })) as PlanResponse;
    // The shopper never opted into supplements → the component is removed.
    expect(res.blueprint!.components.some((c) => c.key === "supplement")).toBe(false);
  });

  it("treats a NEGATIVE mention as a decline, not consent (opt-in backstop)", async () => {
    const withSupplement: Blueprint = {
      components: [
        { key: "main", label: "Main protein", why: "core protein", essential: true, query: "high protein food", budgetWeight: 1, group: null },
        { key: "supplement", label: "Protein powder", why: "optional", essential: false, query: "protein powder", budgetWeight: 1, group: "Optional (opt-in)" },
      ],
      note: null,
    };
    const res = (await runAgent({
      // "no supplements" is a decline — it must NOT count as opting in.
      conversation: [{ role: "user", content: "a high-protein basket, no supplements please" }],
      modeId: "nutrition",
      approved: true,
      blueprint: withSupplement,
    })) as PlanResponse;
    expect(res.blueprint!.components.some((c) => c.key === "supplement")).toBe(false);
  });
});
