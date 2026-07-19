import { describe, expect, it } from "vitest";
import {
  selectVariantWithRelaxation,
  selectionWasRelaxed,
} from "@/lib/catalog/variant-select";
import type { NormalizedVariant } from "@/lib/catalog/types";

function variant(
  id: string,
  options: Array<[string, string]>,
  available: boolean,
): NormalizedVariant {
  return {
    id,
    title: options.map(([, v]) => v).join(" / "),
    url: null,
    sku: null,
    priceMinor: 1000,
    currency: "USD",
    available,
    availabilityStatus: available ? "in_stock" : "out_of_stock",
    runningLow: null,
    checkoutUrl: null,
    nativeCheckoutEligible: null,
    requiresShipping: true,
    imageUrl: null,
    options: options.map(([name, label]) => ({ name, label })),
    seller: null,
  };
}

const variants = [
  variant("v1", [["Color", "Black"], ["Size", "M"]], false),
  variant("v2", [["Color", "Black"], ["Size", "L"]], true),
  variant("v3", [["Color", "White"], ["Size", "M"]], true),
];

describe("selectVariantWithRelaxation", () => {
  it("returns the exact available match when possible", () => {
    const v = selectVariantWithRelaxation(variants, { Color: "White", Size: "M" }, null);
    expect(v?.id).toBe("v3");
  });

  it("preserves the higher-priority option when relaxing (color over size)", () => {
    // Black + M is unavailable; color matters more than size → Black + L.
    const v = selectVariantWithRelaxation(
      variants,
      { Color: "Black", Size: "M" },
      ["Color", "Size"],
    );
    expect(v?.id).toBe("v2");
  });

  it("preserves size instead when the preference order flips", () => {
    const v = selectVariantWithRelaxation(
      variants,
      { Size: "M", Color: "Black" },
      ["Size", "Color"],
    );
    expect(v?.id).toBe("v3");
  });

  it("falls back to any available variant when nothing matches", () => {
    const v = selectVariantWithRelaxation(variants, { Color: "Red" }, null);
    expect(v?.available).toBe(true);
  });

  it("returns null for an empty variant list", () => {
    expect(selectVariantWithRelaxation([], { Color: "Black" }, null)).toBeNull();
  });
});

describe("selectionWasRelaxed", () => {
  it("names the options that were relaxed", () => {
    const v = selectVariantWithRelaxation(
      variants,
      { Color: "Black", Size: "M" },
      ["Color", "Size"],
    );
    expect(selectionWasRelaxed(v, { Color: "Black", Size: "M" })).toEqual(["Size"]);
  });

  it("returns empty for an exact match", () => {
    const v = selectVariantWithRelaxation(variants, { Color: "White", Size: "M" }, null);
    expect(selectionWasRelaxed(v, { Color: "White", Size: "M" })).toEqual([]);
  });
});
