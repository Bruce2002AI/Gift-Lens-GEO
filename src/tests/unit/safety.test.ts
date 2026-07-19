import { describe, expect, it } from "vitest";
import skincare from "@/lib/modes/skills/skincare";
import nutrition from "@/lib/modes/skills/nutrition";
import type { BaseIntent } from "@/lib/modes/types";

function baseIntent(overrides: Partial<BaseIntent> = {}): BaseIntent {
  return {
    budget: { minMajor: null, maxMajor: 3000, minMinor: null, maxMinor: 300000, currency: "INR" },
    destination: { country: "IN", region: null, city: null, postalCode: null },
    physicality: "physical",
    deadline: null,
    hardConstraints: [],
    exclusions: [],
    softPreferences: [],
    searchThemes: [],
    interests: [],
    occasion: null,
    styleKeywords: [],
    clarificationNeeded: false,
    clarificationQuestion: null,
    ...overrides,
  };
}

const matchesAny = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

describe("skincare safety policy", () => {
  it("always carries an educational disclaimer", () => {
    expect(skincare.safety?.disclaimer).toMatch(/educational|not medical advice/i);
  });

  it("blocks diagnose/cure/guarantee claims", () => {
    const p = skincare.safety!.blockedClaimPatterns;
    expect(matchesAny(p, "This cream will cure your eczema.")).toBe(true);
    expect(matchesAny(p, "Clinically proven to treat acne.")).toBe(true);
    expect(matchesAny(p, "Guaranteed clear skin in a week.")).toBe(true);
    expect(matchesAny(p, "A gentle, hydrating moisturizer.")).toBe(false);
  });

  it("gates red-flag inputs toward a professional", () => {
    expect(skincare.safety!.gate!(baseIntent({ interests: ["eczema flare"] }))).toMatch(/professional|dermatologist|doctor/i);
    expect(skincare.safety!.gate!(baseIntent({ interests: ["dry skin"] }))).toBeNull();
  });
});

describe("nutrition safety policy", () => {
  it("omits supplements by default and includes them only on opt-in", async () => {
    expect(nutrition.safety?.requireOptIn).toContain("supplement");
    // No key in the test env → buildBlueprint returns the deterministic heuristic.
    const noOptIn = await nutrition.buildBlueprint!(
      baseIntent({ interests: ["vegetarian"], searchThemes: ["protein"] }),
    );
    expect(noOptIn.blueprint.components.some((c) => c.key === "supplement")).toBe(false);

    const optIn = await nutrition.buildBlueprint!(
      baseIntent({ interests: ["vegetarian"], searchThemes: ["protein powder"] }),
    );
    expect(optIn.blueprint.components.some((c) => c.key === "supplement")).toBe(true);
  });

  it("blocks guaranteed weight-change and cure claims", () => {
    const p = nutrition.safety!.blockedClaimPatterns;
    expect(matchesAny(p, "Guaranteed to help you lose 5 kg.")).toBe(true);
    expect(matchesAny(p, "This basket will cure your deficiency.")).toBe(true);
    expect(matchesAny(p, "A convenient high-protein snack.")).toBe(false);
  });

  it("gates medical inputs toward a professional", () => {
    expect(nutrition.safety!.gate!(baseIntent({ interests: ["diabetes"] }))).toMatch(/professional|doctor|dietitian/i);
    expect(nutrition.safety!.gate!(baseIntent({ interests: ["more protein"] }))).toBeNull();
  });
});
