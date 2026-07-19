import { describe, expect, it } from "vitest";
import { heuristicRoute } from "@/lib/modes/router";
import type { ShoppingModeId } from "@/lib/modes/types";

describe("heuristicRoute (keyword fallback)", () => {
  const cases: Array<[string, ShoppingModeId]> = [
    ["a birthday gift for my sister who loves hiking", "gift"],
    ["a simple skincare routine for dry sensitive skin", "skincare"],
    ["build me a smart-casual outfit for a first date", "style"],
    ["a high protein vegetarian grocery basket", "nutrition"],
    ["make my bedroom cozy and more scandinavian", "room"],
    ["a compact packing kit for a trip to iceland", "travel"],
    ["a beginner watercolor starter kit", "hobby"],
    ["moving into my first apartment on a budget", "lifestage"],
    ["find something similar to this lamp but cheaper", "swap"],
    ["prepare everything i need for a dinner party", "occasion"],
  ];

  it.each(cases)("routes %j → %s", (text, mode) => {
    expect(heuristicRoute(text).modeId).toBe(mode);
  });

  it("returns low confidence when nothing matches", () => {
    const r = heuristicRoute("hello there");
    expect(r.confidence).toBeLessThan(0.4);
  });
});
