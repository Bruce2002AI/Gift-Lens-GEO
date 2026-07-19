import { describe, expect, it } from "vitest";
import { GiftIntentSchema, type GiftIntent } from "@/lib/ai/schemas";
import {
  checkHardConstraints,
  exclusionTerms,
  logisticsMessage,
} from "@/lib/gift/constraints";
import { giftToBaseIntent } from "@/lib/gift/base-intent";
import type { BaseIntent } from "@/lib/modes/types";
import { MOCK_PRODUCTS, findMockProduct } from "@/data/mock-products";
import type { NormalizedProduct } from "@/lib/catalog/types";

function intentWith(overrides: Partial<GiftIntent> = {}): BaseIntent {
  return giftToBaseIntent(
    GiftIntentSchema.parse({
    recipient: {
      relationship: "sister",
      ageBand: null,
      interests: ["coffee"],
      dislikes: [],
      personalityTraits: [],
    },
    occasion: "housewarming",
    giftStyle: "practical",
    budget: {
      minMajor: null,
      maxMajor: 4000,
      minMinor: null,
      maxMinor: 400000,
      currency: "INR",
    },
    destination: { country: "IN", region: null, city: "Bengaluru", postalCode: null },
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

const pourover = findMockProduct("mock:nordhem-pourover-set")!;
const frenchPress = findMockProduct("mock:walnut-french-press")!; // ₹4,550

describe("checkHardConstraints — budget", () => {
  it("passes products within the max budget", () => {
    expect(checkHardConstraints(pourover, intentWith()).pass).toBe(true);
  });

  it("rejects products over the max budget", () => {
    const result = checkHardConstraints(frenchPress, intentWith());
    expect(result.pass).toBe(false);
    expect(result.violations.join(" ")).toMatch(/over the maximum budget/i);
  });

  it("rejects when price currency differs from budget currency (no invented FX)", () => {
    const usdProduct: NormalizedProduct = {
      ...pourover,
      priceRange: { minMinor: 1999, maxMinor: 1999, currency: "USD" },
    };
    const result = checkHardConstraints(usdProduct, intentWith());
    expect(result.pass).toBe(false);
    expect(result.violations.join(" ")).toMatch(/cannot be verified/i);
  });

  it("rejects products below an explicit minimum budget", () => {
    const intent = intentWith({
      budget: {
        minMajor: 3000,
        maxMajor: 5000,
        minMinor: 300000,
        maxMinor: 500000,
        currency: "INR",
      },
    });
    const cheap = findMockProduct("mock:terra-coffee-sampler")!; // ₹1,490
    expect(checkHardConstraints(cheap, intent).pass).toBe(false);
  });

  it("flags missing price data instead of guessing", () => {
    const noPrice: NormalizedProduct = {
      ...pourover,
      priceRange: { minMinor: null, maxMinor: null, currency: null },
      variants: pourover.variants.map((v) => ({ ...v, priceMinor: null })),
    };
    const result = checkHardConstraints(noPrice, intentWith());
    expect(result.pass).toBe(false);
    expect(result.violations.join(" ")).toMatch(/price data missing/i);
  });
});

describe("checkHardConstraints — availability", () => {
  it("rejects products with no available variant", () => {
    const unavailable: NormalizedProduct = {
      ...pourover,
      variants: pourover.variants.map((v) => ({ ...v, available: false })),
    };
    expect(checkHardConstraints(unavailable, intentWith()).pass).toBe(false);
  });
});

describe("checkHardConstraints — explicit exclusions", () => {
  it("rejects products matching a dislike term", () => {
    const intent = intentWith({
      recipient: {
        relationship: "sister",
        ageBand: null,
        interests: [],
        dislikes: ["candle"],
        personalityTraits: [],
      },
    });
    const candles = findMockProduct("mock:solvei-candle-set")!;
    const result = checkHardConstraints(candles, intent);
    expect(result.pass).toBe(false);
    expect(result.violations.join(" ")).toMatch(/excluded term "candle"/i);
  });

  it("parses 'exclude:' hard constraints", () => {
    const intent = intentWith({ hardConstraints: ["exclude: mug"] });
    expect(exclusionTerms(intent)).toContain("mug");
  });

  it("matches a plural exclusion against a singular listing (and vice-versa)", () => {
    // "no candles" must catch the "candle" listing — the wider result set
    // exposed this singular/plural gap.
    const intent = intentWith({
      recipient: {
        relationship: "sister",
        ageBand: null,
        interests: [],
        dislikes: ["candles"],
        personalityTraits: [],
      },
    });
    const candles = findMockProduct("mock:solvei-candle-set")!;
    expect(checkHardConstraints(candles, intent).pass).toBe(false);
  });

  it("strips conversational filler from exclusion terms", () => {
    const intent = intentWith({ hardConstraints: ["exclude: candles please"] });
    expect(exclusionTerms(intent)).toContain("candles");
    const candles = findMockProduct("mock:solvei-candle-set")!;
    expect(checkHardConstraints(candles, intent).pass).toBe(false);
  });

  it("folds regular plurals/singulars across forms (case⇄cases, glass⇄glasses)", () => {
    const dislike = (term: string) =>
      intentWith({
        recipient: {
          relationship: "sister",
          ageBand: null,
          interests: [],
          dislikes: [term],
          personalityTraits: [],
        },
      });
    const phoneCase: NormalizedProduct = {
      ...pourover,
      title: "Slim Leather Phone Case",
      description: "A protective sleeve.",
      categories: [],
    };
    // Plural exclusion vs singular listing (case, not the garbage stem "cas").
    expect(checkHardConstraints(phoneCase, dislike("phone cases")).pass).toBe(false);

    const glasses: NormalizedProduct = {
      ...pourover,
      title: "Set of 6 Wine Glasses",
      description: "Crystal stemware.",
      categories: [],
    };
    // Singular -ss exclusion vs plural listing.
    expect(checkHardConstraints(glasses, dislike("glass")).pass).toBe(false);
  });

  it("ignores trailing punctuation on an exclusion term", () => {
    const mug: NormalizedProduct = {
      ...pourover,
      title: "Ceramic Mug",
      description: "",
      categories: [],
    };
    const intent = intentWith({ hardConstraints: ["exclude: mugs."] });
    expect(checkHardConstraints(mug, intent).pass).toBe(false);
  });

  it("does not exclude a product on a substring false-match", () => {
    // dislike "cats" must NOT reject a "delicate" listing via a bare substring.
    const delicate: NormalizedProduct = {
      ...pourover,
      title: "Delicate Gold Scatter-Print Necklace",
      description: "A communicative, educational keepsake with intricate detail.",
    };
    const intent = intentWith({
      recipient: {
        relationship: "sister",
        ageBand: null,
        interests: [],
        dislikes: ["cats"],
        personalityTraits: [],
      },
    });
    expect(checkHardConstraints(delicate, intent).pass).toBe(true);
    // But a genuine whole-word match is still excluded.
    const necklaceIntent = intentWith({
      recipient: {
        relationship: "sister",
        ageBand: null,
        interests: [],
        dislikes: ["necklaces"],
        personalityTraits: [],
      },
    });
    expect(checkHardConstraints(delicate, necklaceIntent).pass).toBe(false);
  });
});

describe("checkHardConstraints — physicality", () => {
  it("rejects digital-only products when a physical gift is required", () => {
    const egift = findMockProduct("mock:sip-egift")!;
    const result = checkHardConstraints(egift, intentWith({ physicality: "physical" }));
    expect(result.pass).toBe(false);
  });

  it("accepts digital products when the shopper wants digital", () => {
    const egift = findMockProduct("mock:sip-egift")!;
    const intent = intentWith({
      physicality: "digital",
      budget: { minMajor: null, maxMajor: null, minMinor: null, maxMinor: null, currency: "INR" },
    });
    expect(checkHardConstraints(egift, intent).pass).toBe(true);
  });
});

describe("logisticsMessage", () => {
  it("never promises a delivery date when a deadline exists", () => {
    const msg = logisticsMessage(pourover, intentWith({ deadline: "2026-08-01" }));
    expect(msg.toLowerCase()).toContain("delivery date not verified");
  });
});

describe("fixtures sanity", () => {
  it("ships at least 12 mock products across multiple merchants", () => {
    expect(MOCK_PRODUCTS.length).toBeGreaterThanOrEqual(12);
    const merchants = new Set(
      MOCK_PRODUCTS.map((p) => p.variants[0]?.seller?.name).filter(Boolean),
    );
    expect(merchants.size).toBeGreaterThanOrEqual(5);
  });
});
