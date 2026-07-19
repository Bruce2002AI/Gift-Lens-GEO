import { beforeEach, describe, expect, it } from "vitest";
import { _clearCatalogCachesForTests } from "@/lib/catalog/client";
import { runGeoAudit, validateProductUrl } from "@/lib/geo/orchestration";

describe("validateProductUrl", () => {
  it("accepts https product URLs and catalog identifiers", () => {
    expect(
      validateProductUrl("https://shop.example.com/products/mug"),
    ).toContain("https://");
    expect(validateProductUrl("gid://shopify/p/abc")).toBe("gid://shopify/p/abc");
    expect(validateProductUrl("mock:ritual-pourover")).toBe("mock:ritual-pourover");
  });

  it("rejects non-http protocols and junk (SSRF guard)", () => {
    expect(validateProductUrl("file:///etc/passwd")).toBeNull();
    expect(validateProductUrl("ftp://internal/x")).toBeNull();
    expect(validateProductUrl("javascript:alert(1)")).toBeNull();
    expect(validateProductUrl("not a url")).toBeNull();
  });
});

describe("runGeoAudit (mock catalog)", () => {
  beforeEach(() => _clearCatalogCachesForTests());

  it("audits the weak demo listing end-to-end", async () => {
    const result = await runGeoAudit({
      productUrl: "mock:ritual-pourover",
      country: "IN",
      currency: "INR",
      audience: null,
      occasion: "housewarming",
      budgetMax: 4000,
      positioning: null,
      customPrompts: null,
    });

    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.source).toBe("mock");
    expect(result.product?.title).toBe("The Ritual");

    // A weak listing should score poorly and generate real recommendations.
    expect(result.totalScore).toBeLessThan(55);
    expect(result.dimensions).toHaveLength(6);
    expect(result.recommendations.length).toBeGreaterThan(2);
    expect(result.beforeAfter?.beforeTitle).toBe("The Ritual");

    // Visibility suite ran all 10 prompts against the mock catalog.
    expect(result.visibility?.tests).toHaveLength(10);
    expect(result.visibility?.failedCount).toBe(0);

    // Trace proves lookup + get_product + 10 searches.
    const tools = result.trace.map((t) => t.tool);
    expect(tools).toContain("lookup_catalog");
    expect(tools).toContain("get_product");
    expect(tools.filter((t) => t === "search_catalog").length).toBe(10);
  });

  it("scores a strong listing meaningfully higher", async () => {
    const strong = await runGeoAudit({
      productUrl: "mock:nordhem-pourover-set",
      country: "IN",
      currency: "INR",
      audience: null,
      occasion: "housewarming",
      budgetMax: 4000,
      positioning: null,
      customPrompts: null,
    });
    const weak = await runGeoAudit({
      productUrl: "mock:ritual-pourover",
      country: "IN",
      currency: "INR",
      audience: null,
      occasion: "housewarming",
      budgetMax: 4000,
      positioning: null,
      customPrompts: null,
    });
    expect(strong.totalScore).toBeGreaterThan(weak.totalScore + 15);
  });

  it("handles unresolved identifiers with the diagnostic message (no penalty claims)", async () => {
    const result = await runGeoAudit({
      productUrl: "https://unknown-shop.example.com/products/nothing",
      country: "IN",
      currency: "INR",
      audience: null,
      occasion: null,
      budgetMax: null,
      positioning: null,
      customPrompts: null,
    });
    expect(result.resolved).toBe(false);
    expect(result.notFoundMessage).toMatch(/could not resolve this identifier/i);
    // The message must frame this as diagnostic, never as a confirmed penalty.
    expect(result.notFoundMessage).toMatch(/does not mean shopify has penalized/i);
    expect(result.confidence).toBe("low");
  });

  it("respects custom prompts", async () => {
    const prompts = [
      "ceramic coffee brewing gift",
      "gift for a coffee snob",
      "quiet morning ritual present",
    ];
    const result = await runGeoAudit({
      productUrl: "mock:ritual-pourover",
      country: "IN",
      currency: "INR",
      audience: null,
      occasion: null,
      budgetMax: null,
      positioning: null,
      customPrompts: prompts,
    });
    expect(result.visibility?.tests.map((t) => t.prompt)).toEqual(prompts);
  });
});
