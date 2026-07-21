import { describe, expect, it } from "vitest";
import { dedupeProducts, productIdentityKey } from "@/lib/agent/dedup";
import { recipientGender, newSession, switchSubject } from "@/lib/agent/ledger";
import { withGender } from "@/lib/agent/tools";
import type { NormalizedProduct } from "@/lib/catalog/types";

function product(id: string, title: string, priceMinor = 200000): NormalizedProduct {
  return {
    id,
    title,
    description: "desc",
    url: `https://example.com/${id}`,
    handle: id,
    categories: [{ value: "General > Things" }],
    images: [],
    priceRange: { minMinor: priceMinor, maxMinor: priceMinor, currency: "INR" },
    options: [],
    variants: [
      {
        id: `${id}-v1`,
        title: "Default",
        url: null,
        sku: null,
        priceMinor,
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

describe("productIdentityKey — collapse relistings, keep distinct products apart", () => {
  it("gives the same key to the same product under variant/merchant noise", () => {
    const a = product("a", "Noble Heritage Fountain Pen");
    const b = product("b", "Noble Heritage Fountain Pen (Blue)");
    const c = product("c", "Noble Heritage Fountain Pen [Gift Box]");
    expect(productIdentityKey(a)).toBe(productIdentityKey(b));
    expect(productIdentityKey(a)).toBe(productIdentityKey(c));
  });

  it("keeps two different brands' generic products distinct", () => {
    const nike = product("n", "White Oxford Shirt Nike");
    const adidas = product("a", "White Oxford Shirt Adidas");
    expect(productIdentityKey(nike)).not.toBe(productIdentityKey(adidas));
  });
});

describe("dedupeProducts — one slot per product, cheapest wins", () => {
  it("collapses cross-merchant relistings and keeps the cheapest, preserving order", () => {
    const list = [
      product("m1", "Noble Heritage Fountain Pen", 540000),
      product("m2", "Silver Desk Organizer", 160000),
      product("m3", "Noble Heritage Fountain Pen", 499000), // same pen, cheaper seller
      product("m4", "Leather Journal", 120000),
    ];
    const unique = dedupeProducts(list);
    expect(unique.map((p) => p.title)).toEqual([
      "Noble Heritage Fountain Pen",
      "Silver Desk Organizer",
      "Leather Journal",
    ]);
    // The surviving pen is the cheaper listing.
    expect(unique[0].id).toBe("m3");
  });
});

describe("recipientGender — only decide on a clear signal", () => {
  it("reads an explicit recorded fact", () => {
    const s = newSession("s1", "gift");
    s.ledger.facts.push({
      id: "f1", key: "recipient.gender", value: "female", provenance: "said", quote: "she", turn: 1, lens: "gift",
    });
    expect(recipientGender(s)).toBe("woman");
  });

  it("backstops from dominant pronouns in the shopper's messages", () => {
    const s = newSession("s1", "gift");
    s.transcript.push({ role: "user", content: "gift for my sister, she loves art and her birthday is soon", turn: 1 });
    expect(recipientGender(s)).toBe("woman");

    const m = newSession("s2", "gift");
    m.transcript.push({ role: "user", content: "something for my brother, he likes cricket and his style is casual", turn: 1 });
    expect(recipientGender(m)).toBe("man");
  });

  it("returns null when the signal is absent or mixed", () => {
    const s = newSession("s1", "gift");
    s.transcript.push({ role: "user", content: "a gift under 3000 please", turn: 1 });
    expect(recipientGender(s)).toBeNull();
  });

  it("does not let a previous subject's pronouns bleed across a switch", () => {
    const s = newSession("s1", "gift");
    s.turn = 1;
    s.transcript.push({
      role: "user",
      content: "my wife loves roses, she's turning 40, her birthday is soon, she adores gardening",
      turn: 1,
    });
    expect(recipientGender(s)).toBe("woman");

    // Switch to the brother on turn 2 — the wife's messages remain in transcript.
    s.turn = 2;
    switchSubject(s, "brother");
    s.transcript.push({ role: "user", content: "find a shirt for my brother, he plays cricket", turn: 2 });
    // Scoped to turn ≥ 2 → only "brother, he" count → man, not woman.
    expect(recipientGender(s)).toBe("man");
  });
});

describe("withGender — prefix apparel queries only", () => {
  it("prefixes a gendered garment when no gender is present", () => {
    expect(withGender("cotton shirt", "man")).toBe("men's cotton shirt");
    expect(withGender("running shoes", "woman")).toBe("women's running shoes");
    expect(withGender("leather wallet", "man")).toBe("men's leather wallet");
  });

  it("leaves genderless items and already-gendered queries untouched", () => {
    expect(withGender("ceramic coffee mug", "woman")).toBe("ceramic coffee mug");
    expect(withGender("bluetooth speaker", "man")).toBe("bluetooth speaker");
    expect(withGender("women's summer dress", "man")).toBe("women's summer dress");
  });

  it("does not mis-gender non-apparel homonyms", () => {
    // "top" and "tee" collide with toys/golf gear — never inject there.
    expect(withGender("spinning top", "man")).toBe("spinning top");
    expect(withGender("golf tee", "woman")).toBe("golf tee");
    expect(withGender("wooden chess set", "man")).toBe("wooden chess set");
  });
});
