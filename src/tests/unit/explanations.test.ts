import { describe, expect, it } from "vitest";
import { GiftIntentSchema, type GiftIntent } from "@/lib/ai/schemas";
import { heuristicExplanations } from "@/lib/ai/explanations";
import { giftToBaseIntent } from "@/lib/gift/base-intent";
import type { BaseIntent } from "@/lib/modes/types";
import { findMockProduct } from "@/data/mock-products";
import type { NormalizedProduct } from "@/lib/catalog/types";

function intentWith(overrides: Partial<GiftIntent> = {}): BaseIntent {
  return giftToBaseIntent(
    GiftIntentSchema.parse({
    recipient: {
      relationship: "friend",
      ageBand: null,
      interests: ["coffee"],
      dislikes: [],
      personalityTraits: [],
    },
    occasion: "birthday",
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
    ...overrides,
    }),
  );
}

const base = findMockProduct("mock:nordhem-pourover-set")!;

describe("heuristicExplanations — honesty guarantees", () => {
  it("never claims a budget fit across currencies (no invented FX rate)", () => {
    // INR budget max 400000; raw 4000 <= 400000 is true, but the price is USD.
    const usd: NormalizedProduct = {
      ...base,
      priceRange: { minMinor: 4000, maxMinor: 4000, currency: "USD" },
      variants: base.variants.map((v) => ({ ...v, priceMinor: 4000, currency: "USD" })),
    };
    const { explanations } = heuristicExplanations(intentWith(), [usd]);
    expect(explanations[0].reasons.join(" ").toLowerCase()).not.toContain("fits the budget");
    expect(explanations[0].evidence.some((e) => e.sourceField === "priceRange")).toBe(false);
  });

  it("claims a budget fit when the currency matches", () => {
    const inr: NormalizedProduct = {
      ...base,
      priceRange: { minMinor: 200000, maxMinor: 200000, currency: "INR" },
      variants: base.variants.map((v) => ({ ...v, priceMinor: 200000, currency: "INR" })),
    };
    const { explanations } = heuristicExplanations(intentWith(), [inr]);
    expect(explanations[0].reasons.join(" ").toLowerCase()).toContain("fits the budget");
  });

  it("only claims an interest mention on a whole-word match, not a substring", () => {
    const noMention: NormalizedProduct = {
      ...base,
      title: "Communicative Educational Keepsake",
      description: "A delicate scatter-print design.",
    };
    const { explanations } = heuristicExplanations(
      intentWith({
        recipient: {
          relationship: "friend",
          ageBand: null,
          interests: ["cat"],
          dislikes: [],
          personalityTraits: [],
        },
      }),
      [noMention],
    );
    // "cat" appears only inside "Communicative"/"Educational"/"delicate".
    expect(explanations[0].reasons.join(" ").toLowerCase()).not.toContain("interest in cat");
  });
});
