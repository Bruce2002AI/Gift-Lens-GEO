import { describe, expect, it } from "vitest";
import { boardIdsFailingConstraints } from "@/lib/agent/board";
import { newSession } from "@/lib/agent/ledger";
import { sniffExclusions } from "@/lib/agent/loop";
import type { AgentSession, CareFlag } from "@/lib/agent/types";
import type { NormalizedProduct } from "@/lib/catalog/types";

/**
 * When the shopper tightens the brief mid-conversation — a new allergy, an
 * exclusion, a care flag — the products already on the board that now violate it
 * must be identified so the loop can pull them off the shelf live. These prove
 * the detection (the removal event + forced re-search are wired on top of it).
 */

function product(id: string, title: string): NormalizedProduct {
  return {
    id,
    title,
    description: "A pleasant everyday item.",
    url: `https://example.com/${id}`,
    handle: id,
    categories: [{ value: "Food > Snacks" }],
    images: [],
    priceRange: { minMinor: 30000, maxMinor: 30000, currency: "INR" },
    options: [],
    variants: [
      {
        id: `${id}-v1`,
        title: "Default",
        url: null,
        sku: null,
        priceMinor: 30000,
        currency: "INR",
        available: true,
        availabilityStatus: "in_stock",
        runningLow: null,
        checkoutUrl: null,
        nativeCheckoutEligible: null,
        requiresShipping: true,
        imageUrl: null,
        options: [],
        seller: { id: null, name: "Shop", url: null, domain: null, policyLinks: [] },
        description: "",
        rating: { value: null, scaleMin: null, scaleMax: null, count: null },
        condition: ["new"],
      },
    ],
    rating: { value: null, scaleMin: null, scaleMax: null, count: null },
    seller: { id: null, name: "Shop", url: null, domain: null, policyLinks: [] },
    metadata: { techSpecs: [], topFeatures: [], uniqueSellingPoints: [], specs: [] },
    rawMessages: [],
  };
}

function sessionWithBoard(products: NormalizedProduct[]): AgentSession {
  const s = newSession("s1", "gift");
  s.turn = 2;
  for (const p of products) {
    s.evidence.set(p.id, {
      product: p,
      source: "live",
      fetchedAt: new Date().toISOString(),
      snippets: [],
    });
    s.boardedIds.add(p.id);
  }
  return s;
}

describe("boardIdsFailingConstraints — what to pull off the shelf when the brief tightens", () => {
  it("flags exactly the products that match a newly-added exclusion", () => {
    const choc = product("p1", "Dark Chocolate Almond Bar");
    const oat = product("p2", "Plain Oat Biscuits");
    const s = sessionWithBoard([choc, oat]);
    // Shopper just said they're avoiding chocolate.
    s.ledger.constraints.exclusions.push("chocolate");

    const failing = boardIdsFailingConstraints(s);
    expect(failing).toContain("p1");
    expect(failing).not.toContain("p2");
  });

  it("flags a product caught by a care-flag scope fence", () => {
    const retinol = product("p1", "Retinol Night Serum");
    const gentle = product("p2", "Fragrance-Free Gentle Cleanser");
    const s = sessionWithBoard([retinol, gentle]);
    const flag: CareFlag = {
      kind: "pregnancy",
      label: "pregnancy",
      matchedText: "pregnant",
      turn: 2,
      scopeFence: ["retinol"],
      lastCaredTurn: null,
    };
    s.ledger.careFlags.push(flag);

    const failing = boardIdsFailingConstraints(s);
    expect(failing).toContain("p1");
    expect(failing).not.toContain("p2");
  });

  it("returns nothing when every boarded product still fits", () => {
    const s = sessionWithBoard([product("p1", "Plain Oat Biscuits"), product("p2", "Roasted Chana")]);
    expect(boardIdsFailingConstraints(s)).toEqual([]);
  });

  it("never yanks a product it cannot verify (no evidence)", () => {
    const s = newSession("s1", "gift");
    s.boardedIds.add("ghost"); // boarded but no evidence for it
    s.ledger.constraints.exclusions.push("chocolate");
    expect(boardIdsFailingConstraints(s)).toEqual([]);
  });
});

describe("sniffExclusions — plain-language allergies become hard exclusions", () => {
  it("extracts allergens from clear allergy phrasing", () => {
    expect(sniffExclusions("she's allergic to nuts and dairy")).toEqual(["nuts", "dairy"]);
    expect(sniffExclusions("I can't eat gluten")).toEqual(["gluten"]);
    expect(sniffExclusions("he is intolerant to lactose, please")).toEqual(["lactose"]);
  });

  it("stays silent on ordinary sentences", () => {
    expect(sniffExclusions("something under 3000 for my sister")).toEqual([]);
    expect(sniffExclusions("she loves gardening and cricket")).toEqual([]);
    expect(sniffExclusions("no more than 5000 please")).toEqual([]);
  });
});
