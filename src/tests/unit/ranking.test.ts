import { describe, expect, it } from "vitest";
import { GiftIntentSchema } from "@/lib/ai/schemas";
import { giftToBaseIntent } from "@/lib/gift/base-intent";
import { findMockProduct } from "@/data/mock-products";
import { assignRoles, dedupeProducts } from "@/lib/gift/diversity";
import {
  WEIGHTS,
  completenessScore,
  confidenceFor,
  qualityScore,
  scoreCandidate,
} from "@/lib/gift/ranking";
import type { NormalizedProduct } from "@/lib/catalog/types";

const intent = giftToBaseIntent(
  GiftIntentSchema.parse({
    recipient: {
      relationship: "sister",
      ageBand: null,
      interests: ["coffee", "design"],
      dislikes: [],
      personalityTraits: [],
    },
    occasion: "housewarming",
    giftStyle: "practical",
    budget: { minMajor: null, maxMajor: 4000, minMinor: null, maxMinor: 400000, currency: "INR" },
    destination: { country: "IN", region: null, city: null, postalCode: null },
    deadline: null,
    physicality: "physical",
    hardConstraints: [],
    softPreferences: [],
    searchThemes: ["coffee"],
    clarificationNeeded: false,
    clarificationQuestion: null,
  }),
);

const strong = findMockProduct("mock:nordhem-pourover-set")!;
const weak = findMockProduct("mock:ritual-pourover")!;

describe("scoring weights", () => {
  it("sum to exactly 1.0", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("qualityScore", () => {
  it("treats missing ratings as neutral, not as low quality", () => {
    expect(qualityScore(weak)).toBe(0.5);
    expect(qualityScore(strong)).toBeGreaterThan(0.5);
  });
});

describe("completenessScore", () => {
  it("rewards complete listings over sparse ones", () => {
    expect(completenessScore(strong)).toBeGreaterThan(completenessScore(weak));
  });
});

describe("scoreCandidate", () => {
  it("gives the strong listing a higher total than the weak one", () => {
    const semantic = {
      productId: "",
      recipientFit: 0.8,
      occasionFit: 0.8,
      noveltyFit: 0.5,
      fitNotes: "",
    };
    const strongScore = scoreCandidate(strong, intent, { ...semantic, productId: strong.id });
    const weakScore = scoreCandidate(weak, intent, { ...semantic, productId: weak.id });
    expect(strongScore.total).toBeGreaterThan(weakScore.total);
  });

  it("clamps semantic scores into [0,1]", () => {
    const scored = scoreCandidate(strong, intent, {
      productId: strong.id,
      recipientFit: 1,
      occasionFit: 1,
      noveltyFit: 1,
      fitNotes: "",
    });
    expect(scored.total).toBeLessThanOrEqual(1);
    expect(confidenceFor(scored)).toMatch(/high|medium|low/);
  });
});

describe("dedupeProducts", () => {
  it("removes duplicates by product id", () => {
    const out = dedupeProducts([strong, strong, weak]);
    expect(out).toHaveLength(2);
  });

  it("removes duplicates by variant identity", () => {
    const clone: NormalizedProduct = { ...strong, id: "different-id" };
    const out = dedupeProducts([strong, clone]);
    expect(out).toHaveLength(1);
  });

  it("removes duplicates by normalized title + merchant", () => {
    const retitled: NormalizedProduct = {
      ...strong,
      id: "another-id",
      variants: strong.variants.map((v) => ({ ...v, id: `${v.id}-alt` })),
      title: "Two-Cup Dripper with Carafe — Nordhem Ceramic Pour-Over Coffee Set",
    };
    const out = dedupeProducts([strong, retitled]);
    expect(out).toHaveLength(1);
  });
});

describe("assignRoles", () => {
  it("assigns three distinct roles from a sufficient pool", () => {
    const pool = [
      "mock:nordhem-pourover-set",
      "mock:brewcraft-grinder",
      "mock:fjord-serving-board",
      "mock:terra-coffee-sampler",
      "mock:solvei-candle-set",
    ].map((id) =>
      scoreCandidate(findMockProduct(id)!, intent, {
        productId: id,
        recipientFit: 0.7,
        occasionFit: 0.6,
        noveltyFit: id.includes("grinder") ? 0.9 : 0.4,
        fitNotes: "",
      }),
    );
    const roles = assignRoles(pool);
    expect(roles).toHaveLength(3);
    expect(new Set(roles.map((r) => r.role))).toEqual(
      new Set(["best_match", "delight_pick", "safe_pick"]),
    );
    expect(new Set(roles.map((r) => r.candidate.product.id)).size).toBe(3);
  });

  it("returns fewer roles when the pool is small — never fabricates", () => {
    const pool = [
      scoreCandidate(strong, intent, {
        productId: strong.id,
        recipientFit: 0.7,
        occasionFit: 0.6,
        noveltyFit: 0.5,
        fitNotes: "",
      }),
    ];
    expect(assignRoles(pool)).toHaveLength(1);
    expect(assignRoles([])).toHaveLength(0);
  });
});
