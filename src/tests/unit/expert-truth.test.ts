import { describe, expect, it } from "vitest";
import {
  applyFactPatches,
  applyOp,
  ledgerToBaseIntent,
  newSession,
  quoteInUserWords,
  recordConsent,
} from "@/lib/agent/ledger";
import { routeLens, sniffBudget } from "@/lib/agent/loop";
import {
  detectCareFlags,
  hedgeInferredValue,
  isSupplementCategory,
  lintOutbound,
  sniffSupplementConsent,
} from "@/lib/agent/safety";
import { topUpBoard } from "@/lib/agent/board";
import {
  junkPriceFloorMinor,
  notarizeBoardItem,
  verifyClaim,
  verifyPresentation,
} from "@/lib/agent/truth";
import { TraceCollector } from "@/lib/catalog/trace";
import type { AgentSession, CardSpec, Presentation } from "@/lib/agent/types";
import type { NormalizedProduct } from "@/lib/catalog/types";

function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    id: "p1",
    title: "Manual Burr Coffee Grinder",
    description:
      "Precision stainless steel burrs grind evenly. The body is 100% walnut wood. Fragrance-free packaging.",
    url: "https://example.com/p1",
    handle: "manual-burr-coffee-grinder",
    categories: [{ value: "Kitchen > Coffee" }],
    images: [{ url: "https://example.com/img.jpg", altText: null, type: "image" }],
    priceRange: { minMinor: 250000, maxMinor: 250000, currency: "INR" },
    options: [],
    variants: [
      {
        id: "v1",
        title: "Default",
        url: null,
        sku: null,
        priceMinor: 250000,
        currency: "INR",
        available: true,
        availabilityStatus: "in_stock",
        runningLow: null,
        checkoutUrl: null,
        nativeCheckoutEligible: null,
        requiresShipping: true,
        imageUrl: null,
        options: [],
        seller: { id: null, name: "Brew Co", url: null, domain: null, policyLinks: [] },
        description: "",
        rating: { value: null, scaleMin: null, scaleMax: null, count: null },
        condition: ["new"],
      },
    ],
    rating: { value: 4.6, scaleMin: 1, scaleMax: 5, count: 120 },
    seller: { id: null, name: "Brew Co", url: null, domain: null, policyLinks: [] },
    metadata: {
      techSpecs: [],
      topFeatures: ["ceramic-free burr set"],
      uniqueSellingPoints: [],
      specs: [],
    },
    rawMessages: [],
    ...overrides,
  };
}

function sessionWith(p: NormalizedProduct, budgetMaxMinor: number | null = null): AgentSession {
  const s = newSession("s1", "gift");
  s.turn = 1;
  s.ledger.constraints.budgetMaxMinor = budgetMaxMinor;
  s.evidence.set(p.id, {
    product: p,
    source: "live",
    fetchedAt: new Date().toISOString(),
    snippets: [],
  });
  return s;
}

function presentationWith(card: Partial<CardSpec>): Presentation {
  return {
    message: "Here is my pick.",
    layout: "picks",
    assumptions: [],
    sections: [
      {
        title: null,
        intro: null,
        steps: [],
        cards: [
          {
            productId: "p1",
            role: null,
            claims: [],
            whyForYou: [],
            tradeoff: null,
            runnerUp: null,
            ...card,
          },
        ],
      },
    ],
    leftOut: [],
  };
}

describe("verifyClaim — verbatim-substring evidence quotes", () => {
  it("accepts a verbatim quote from the named field (case/whitespace-insensitive)", () => {
    expect(verifyClaim(product(), "description", "100% walnut wood")).toBe(true);
    expect(verifyClaim(product(), "description", "PRECISION   stainless steel burrs")).toBe(true);
  });
  it("rejects a paraphrase or a quote from the wrong field", () => {
    expect(verifyClaim(product(), "description", "made of oak wood")).toBe(false);
    expect(verifyClaim(product(), "topFeatures", "100% walnut wood")).toBe(false);
  });
  it("verifies price claims against the code-constructed price field", () => {
    expect(verifyClaim(product(), "price", "priced at ₹2,500.00")).toBe(true);
    expect(verifyClaim(product(), "price", "priced at ₹99.00")).toBe(false);
  });
});

describe("verifyPresentation — the notarizer", () => {
  it("drops a card whose product has no evidence entry", () => {
    const s = sessionWith(product());
    const raw = presentationWith({ productId: "unknown-product" });
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.sections[0].cards).toHaveLength(0);
    expect(presentation.droppedCards).toBe(1);
  });

  it("drops a card that fails the budget constraint", () => {
    const s = sessionWith(product(), 100000); // budget ₹1000, product ₹2500
    const { presentation } = verifyPresentation(s, presentationWith({}));
    expect(presentation.sections[0].cards).toHaveLength(0);
    expect(presentation.droppedCards).toBe(1);
  });

  it("strips unverifiable claims but keeps quoted ones, counting the drops", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      claims: [
        { text: "The body is walnut.", field: "description", quote: "100% walnut wood" },
        { text: "It is titanium.", field: "description", quote: "aerospace titanium" },
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    const card = presentation.sections[0].cards[0];
    expect(card.claims).toHaveLength(1);
    expect(card.droppedClaims).toBe(1);
  });

  it("nudges product-attribute assertions out of the interpretation stratum", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      whyForYou: [
        "Because you said he loves slow mornings.",
        "It is made of pure walnut wood.",
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    const card = presentation.sections[0].cards[0];
    expect(card.whyForYou).toHaveLength(1);
    expect(card.whyForYou[0]).toMatch(/slow mornings/);
  });

  it("holds back supplement cards without recorded consent, shows them with it", () => {
    const p = product({
      id: "p2",
      title: "Whey Protein Powder 1kg",
      description: "Whey protein powder with 24g protein per serving.",
      categories: [{ value: "Health > Supplements" }],
    });
    const s = sessionWith(p);
    s.transcript.push({ role: "user", content: "sure, show me protein powder options", turn: 1 });
    const raw = presentationWith({ productId: "p2" });

    const blocked = verifyPresentation(s, raw);
    expect(blocked.presentation.sections[0].cards).toHaveLength(0);

    expect(recordConsent(s, "supplements", "sure, show me protein powder")).toBe(true);
    const allowed = verifyPresentation(s, raw);
    expect(allowed.presentation.sections[0].cards).toHaveLength(1);
  });

  it("totals plan layouts only when currencies agree", () => {
    const s = sessionWith(product());
    const raw = { ...presentationWith({}), layout: "plan" as const };
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.totalMinor).toBe(250000);
  });
});

describe("claim binding — the shown sentence must be entailed by the evidence", () => {
  it("rejects an invented sentence propped up by a trivial verbatim quote", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      claims: [
        {
          text: "Waterproof to 50m with a lifetime warranty.",
          field: "title",
          quote: "Grinder", // verbatim, but tiny and unrelated to the claim
        },
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.sections[0].cards[0].claims).toHaveLength(0);
    expect(presentation.sections[0].cards[0].droppedClaims).toBe(1);
  });

  it("keeps an honest restatement whose wording drifts slightly", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      claims: [
        {
          text: "The body is 100% walnut wood.",
          field: "description",
          quote: "The body is 100% walnut wood",
        },
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.sections[0].cards[0].claims).toHaveLength(1);
  });

  it("rejects an invented hard fact even inside otherwise-supported wording", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      claims: [
        {
          // Every word but "titanium" comes from the listing.
          text: "Precision stainless steel titanium burrs grind evenly.",
          field: "description",
          quote: "Precision stainless steel burrs grind evenly",
        },
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.sections[0].cards[0].claims).toHaveLength(0);
  });

  it("keeps a claim whose words are all present in the cited field", () => {
    const s = sessionWith(product());
    const raw = presentationWith({
      claims: [
        {
          text: "Precision stainless steel burrs grind evenly.",
          field: "description",
          quote: "Precision stainless steel burrs grind evenly",
        },
      ],
    });
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.sections[0].cards[0].claims).toHaveLength(1);
  });
});

describe("budget screening provenance", () => {
  it("does not treat a foreign-currency product as budget-screened unless the catalog capped it", () => {
    const usd = product({
      priceRange: { minMinor: 14900, maxMinor: 14900, currency: "USD" },
      variants: [{ ...product().variants[0], priceMinor: 14900, currency: "USD" }],
    });
    const s = sessionWith(usd, 200000); // ₹2,000 budget, product priced in USD
    const { presentation } = verifyPresentation(s, presentationWith({}));
    // Unverifiable across currencies and never screened by the catalog → dropped.
    expect(presentation.sections[0].cards).toHaveLength(0);
    expect(presentation.droppedCards).toBe(1);
  });
});

describe("plan totals", () => {
  it("reports the total in the cards' own currency, not the ledger's", () => {
    const usd = product({
      priceRange: { minMinor: 1200, maxMinor: 1200, currency: "USD" },
      variants: [{ ...product().variants[0], priceMinor: 1200, currency: "USD" }],
    });
    const s = sessionWith(usd); // ledger currency defaults to INR
    s.budgetScreenedCap.set(usd.id, 500000);
    const raw = { ...presentationWith({}), layout: "plan" as const };
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.totalMinor).toBe(1200);
    expect(presentation.totalCurrency).toBe("USD");
  });
});

describe("follow-up questions ride with the products", () => {
  it("lints and carries a follow-up through the notarizer", () => {
    const s = sessionWith(product());
    const raw: Presentation = {
      ...presentationWith({}),
      followUp: {
        text: "Is he a morning-ritual person or a grab-and-go type?",
        fork: { ifA: "ritual", thenA: "manual grinder", ifB: "grab-and-go", thenB: "electric" },
        quickReplies: ["Ritual", "Grab and go"],
      },
    };
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.followUp?.text).toMatch(/morning-ritual/);
    expect(presentation.followUp?.quickReplies).toHaveLength(2);
    expect(presentation.followUp?.fork?.thenA).toBe("manual grinder");
  });

  it("drops a follow-up that violates the outbound lint", () => {
    const s = sessionWith(product());
    const raw: Presentation = {
      ...presentationWith({}),
      followUp: { text: "Want it delivered by Friday?", fork: null, quickReplies: [] },
    };
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.followUp).toBeNull();
  });
});

describe("lintOutbound — topic-keyed claim lint", () => {
  it("drops delivery guarantees and keeps the rest", () => {
    const r = lintOutbound("This is a lovely pick. It will be delivered by Friday guaranteed.");
    expect(r.text).toBe("This is a lovely pick.");
    expect(r.dropped).toHaveLength(1);
  });
  it("drops cure/treat claims in medical-topic sentences", () => {
    const r = lintOutbound("This serum treats acne overnight. It has a light gel texture.");
    expect(r.text).not.toMatch(/treats acne/i);
    expect(r.text).toMatch(/gel texture/);
  });
  it("keys medical topic on the whole text, catching anaphoric claims", () => {
    // The second sentence has no topic word of its own — it must not escape.
    const r = lintOutbound("My acne is brutal. This will cure it for good.");
    expect(r.text).not.toMatch(/cure/i);
    expect(r.text).toMatch(/brutal/);
  });
  it("splits on newlines so unpunctuated bullet lists are linted per item", () => {
    const r = lintOutbound("Great serum for skin\nGuaranteed to clear everything\nGentle formula");
    expect(r.text).not.toMatch(/guaranteed/i);
    expect(r.text).toMatch(/Gentle formula/);
  });
  it("allows interaction concerns only as deferral", () => {
    const asserted = lintOutbound("This supplement interacts with your medication.");
    expect(asserted.text).toBe("");
    const deferred = lintOutbound(
      "Worth asking your pharmacist whether this supplement interacts with your medication.",
    );
    expect(deferred.text).toMatch(/pharmacist/);
  });
});

describe("care flags — deterministic nets", () => {
  it("detects pregnancy with a retinoid scope fence", () => {
    const flags = detectCareFlags("I'm pregnant and my skin is breaking out", 1);
    const preg = flags.find((f) => f.kind === "pregnancy");
    expect(preg).toBeTruthy();
    expect(preg!.scopeFence).toContain("retinol");
  });
  it("detects disordered-eating signals and minors", () => {
    expect(detectCareFlags("I barely eat and want a fat burner", 1).some((f) => f.kind === "eating-disorder")).toBe(true);
    expect(detectCareFlags("retinol for my 14 year old", 1).some((f) => f.kind === "minor")).toBe(true);
  });
  it("flags a later affirming mention even when an earlier one was negated", () => {
    const flags = detectCareFlags(
      "I don't think it's serious. I am pregnant though, 5 months.",
      1,
    );
    expect(flags.some((f) => f.kind === "pregnancy")).toBe(true);
  });
  it("treats negated mentions as denials, not flags", () => {
    expect(detectCareFlags("No conditions, no medications, no allergies", 1)).toHaveLength(0);
    expect(detectCareFlags("I'm not pregnant", 1)).toHaveLength(0);
    expect(detectCareFlags("not taking any medication these days", 1)).toHaveLength(0);
    // Positive mentions still fire.
    expect(detectCareFlags("I'm pregnant", 1).some((f) => f.kind === "pregnancy")).toBe(true);
    expect(detectCareFlags("I take blood pressure medication", 1).some((f) => f.kind === "medical")).toBe(true);
  });
});

describe("ledger — provenance and consent mechanics", () => {
  it("downgrades 'said' facts whose quote isn't in the user's words", () => {
    const s = newSession("s2", "gift");
    s.transcript.push({ role: "user", content: "she loves film photography", turn: 1 });
    applyFactPatches(s, [
      { key: "recipient.loves", value: "film photography", provenance: "said", quote: "she loves film photography" },
      { key: "recipient.hates", value: "clutter", provenance: "said", quote: "she hates clutter" },
    ]);
    expect(s.ledger.facts[0].provenance).toBe("said");
    expect(s.ledger.facts[1].provenance).toBe("inferred");
    expect(s.ledger.facts[1].quote).toBeNull();
  });

  it("will not resurrect revoked consent by replaying the original words", () => {
    const s = newSession("s6", "nutrition");
    s.turn = 1;
    s.transcript.push({ role: "user", content: "yes, show me supplements", turn: 1 });
    expect(recordConsent(s, "supplements", "yes, show me supplements")).toBe(true);
    s.turn = 2;
    applyOp(s, { kind: "revoke_consent", category: "supplements" });
    // Replaying the pre-revocation quote must not re-open the gate.
    expect(recordConsent(s, "supplements", "yes, show me supplements")).toBe(false);
    s.turn = 3;
    s.transcript.push({ role: "user", content: "actually add supplements back", turn: 3 });
    expect(recordConsent(s, "supplements", "actually add supplements back")).toBe(true);
  });

  it("rejects consent whose quote is not verbatim user speech", () => {
    const s = newSession("s3", "nutrition");
    s.transcript.push({ role: "user", content: "maybe later", turn: 1 });
    expect(recordConsent(s, "supplements", "yes show me supplements")).toBe(false);
    expect(s.ledger.consents).toHaveLength(0);
  });

  it("normalizes curly quotes and whitespace when matching user words", () => {
    const s = newSession("s4", "gift");
    s.transcript.push({ role: "user", content: "it’s   for my Dad", turn: 1 });
    expect(quoteInUserWords(s, "it's for my dad")).toBe(true);
  });

  it("applies portrait corrections as said-provenance and removals as deletions", () => {
    const s = newSession("s5", "gift");
    s.turn = 2;
    s.transcript.push({ role: "user", content: "hello", turn: 1 });
    applyFactPatches(s, [{ key: "recipient.vibe", value: "sentimental", provenance: "inferred" }]);
    const fact = s.ledger.facts[0];
    applyOp(s, { kind: "correct_fact", factId: fact.id, newValue: "practical" });
    expect(s.ledger.facts[0].value).toBe("practical");
    expect(s.ledger.facts[0].provenance).toBe("said");
    applyOp(s, { kind: "correct_fact", factId: fact.id, remove: true });
    expect(s.ledger.facts).toHaveLength(0);
  });

  it("hedges certainty language on inferred values", () => {
    expect(hedgeInferredValue("definitely hates clutter")).toBe("hates clutter");
  });
});

describe("loop helpers", () => {
  it("sniffs budgets with currency hints", () => {
    expect(sniffBudget("something under ₹3,000 please")).toEqual({ maxMajor: 3000, currency: "INR" });
    expect(sniffBudget("around $50 budget")).toEqual({ maxMajor: 50, currency: "USD" });
    expect(sniffBudget("no numbers here")).toBeNull();
  });
  it("routes lenses on obvious keywords, defaulting to gift", () => {
    expect(routeLens("my skin has acne")).toBe("skincare");
    expect(routeLens("an outfit for a wedding")).toBe("style");
    expect(routeLens("i'm tired all the time, supplements?")).toBe("nutrition");
    expect(routeLens("anniversary present for my wife")).toBe("gift");
  });
  it("detects supplement categories for the consent gate", () => {
    expect(isSupplementCategory("Whey Protein Powder")).toBe(true);
    expect(isSupplementCategory("Methylcobalamin (1500mcg) Tablets")).toBe(true);
    expect(isSupplementCategory("Iron Zinc supplement gummies")).toBe(true);
    expect(isSupplementCategory("Walnut coffee grinder")).toBe(false);
    expect(isSupplementCategory("Cotton short sleeve shirt")).toBe(false);
  });
  it("sniffs affirmative supplement consent from the user's own sentence, rejecting negations", () => {
    expect(sniffSupplementConsent("Yes, show me supplement options too if they're worth it.")).toMatch(/show me supplement/i);
    expect(sniffSupplementConsent("I'm open to vitamins as well")).toMatch(/open to vitamins/i);
    expect(sniffSupplementConsent("No supplements please.")).toBeNull();
    expect(sniffSupplementConsent("I'd rather not take supplements. Yes to better meals.")).toBeNull();
    expect(sniffSupplementConsent("what should I eat for breakfast")).toBeNull();
    // Third-party and incidental mentions are not consent.
    expect(sniffSupplementConsent("Yes, my friend takes supplements every day.")).toBeNull();
    expect(sniffSupplementConsent("Sure, my doctor mentioned vitamins once.")).toBeNull();
  });
});

describe("notarizeBoardItem — the shared board admission standard", () => {
  it("admits a code-authored (trusted) price-delta insight but rejects the same text from the model", () => {
    const s = sessionWith(product());
    const intent = ledgerToBaseIntent(s.ledger);
    const insight = "Close catalog match — ₹200.00 less than the one you tapped";
    expect(
      notarizeBoardItem(s, { productId: "p1", insight, trusted: true }, intent),
    ).not.toBeNull();
    // Untrusted (model-authored) interpretation may not assert prices.
    expect(notarizeBoardItem(s, { productId: "p1", insight }, intent)).toBeNull();
  });
  /**
   * The floor screens absurd catalog data, not inexpensive products. Uncapped
   * it scaled with the budget, so a ₹50,000 budget discarded real ₹900 gifts
   * and a ₹5,000 budget threw away a legitimate ₹99 clay-tool set.
   */
  it("caps the junk-price floor so real cheap products survive a big budget", () => {
    expect(junkPriceFloorMinor(null)).toBe(100);
    // Small budget: still proportional.
    expect(junkPriceFloorMinor(20000)).toBe(400);
    // Large budgets are capped rather than scaling without bound.
    expect(junkPriceFloorMinor(500000)).toBe(1000);
    expect(junkPriceFloorMinor(5000000)).toBe(1000);
    // A ₹99 item clears the floor under a ₹5,000 budget…
    expect(9900).toBeGreaterThan(junkPriceFloorMinor(500000));
    // …while a ₹1 mis-scrape still does not.
    expect(100).toBeLessThan(junkPriceFloorMinor(500000));
  });

  it("refuses missing evidence, junk prices, and foreign currencies", () => {
    const s = sessionWith(product(), 400000);
    const intent = ledgerToBaseIntent(s.ledger);
    expect(
      notarizeBoardItem(s, { productId: "ghost", insight: "solid pick", trusted: true }, intent),
    ).toBeNull();
    const junk = product({ id: "p-junk", priceRange: { minMinor: 100, maxMinor: 100, currency: "INR" }, variants: [] });
    s.evidence.set(junk.id, { product: junk, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
    expect(
      notarizeBoardItem(s, { productId: "p-junk", insight: "a bargain", trusted: true }, intent),
    ).toBeNull();
    const usd = product({ id: "p-usd", priceRange: { minMinor: 210000, maxMinor: 210000, currency: "USD" }, variants: [] });
    s.evidence.set(usd.id, { product: usd, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
    s.budgetScreenedCap.set("p-usd", 400000);
    expect(
      notarizeBoardItem(s, { productId: "p-usd", insight: "great import", trusted: true }, intent),
    ).toBeNull();
  });
  it("resolves a truncated product id against session evidence", () => {
    const s = sessionWith(product({ id: "gid://shopify/p/12345" }));
    const intent = ledgerToBaseIntent(s.ledger);
    const item = notarizeBoardItem(s, { productId: "12345", insight: "the anchor piece", trusted: true }, intent);
    expect(item?.productId).toBe("gid://shopify/p/12345");
  });
  it("drops a model-authored tradeoff that asserts product facts, keeping the item", () => {
    const s = sessionWith(product());
    const intent = ledgerToBaseIntent(s.ledger);
    const item = notarizeBoardItem(
      s,
      {
        productId: "p1",
        insight: "suits the daily grind ritual",
        tradeoff: "Only 250ml per bottle and it's genuine leather trim",
      },
      intent,
    );
    expect(item).not.toBeNull();
    expect(item!.tradeoff).toBeNull();
  });
});

describe("topUpBoard — refilling thin categories from their own search aisles", () => {
  function shirt(id: string, title: string, priceMinor: number): NormalizedProduct {
    return product({
      id,
      title,
      categories: [{ value: "Apparel > Shirts" }],
      priceRange: { minMinor: priceMinor, maxMinor: priceMinor, currency: "INR" },
      variants: [],
    });
  }

  it("adds same-search siblings that fit the category and skips ones that don't", async () => {
    const s = sessionWith(shirt("p-top", "White Slim Fit Shirt", 90000));
    const sib = shirt("p-sib", "White Oxford Shirt Men", 80000);
    const belt = product({
      id: "p-belt",
      title: "Classic Leather Belt",
      categories: [{ value: "Accessories > Belts" }],
      priceRange: { minMinor: 50000, maxMinor: 50000, currency: "INR" },
      variants: [],
    });
    for (const p of [sib, belt]) {
      s.evidence.set(p.id, { product: p, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
    }
    s.searchHits.set("white shirt men", ["p-top", "p-sib", "p-belt"]);

    const intent = ledgerToBaseIntent(s.ledger);
    const topItem = notarizeBoardItem(s, { productId: "p-top", insight: "your anchor", isPick: true, trusted: true }, intent);
    const presentation = {
      message: "", layout: "picks" as const, assumptions: [], sections: [], leftOut: [],
      totalMinor: null, totalCurrency: null, currency: "INR", droppedCards: 0, followUp: null,
      board: [{ name: "Shirts", items: [topItem!] }], compositions: [],
    };
    const added = await topUpBoard(s, presentation, new TraceCollector(), () => {});
    expect(added).toBe(1);
    const ids = presentation.board[0].items.map((i) => i.productId);
    expect(ids).toContain("p-sib");
    expect(ids).not.toContain("p-belt");
    // Auto-added items are labeled honestly and computed from verified offers.
    const addedItem = presentation.board[0].items.find((i) => i.productId === "p-sib")!;
    expect(addedItem.insight).toMatch(/same aisle/i);
    expect(addedItem.tradeoff).toMatch(/auto-added/i);
    expect(addedItem.isPick).toBe(false);
  });

  it("keeps a sweatshirt out of the Shirts rail — whole-word matching, not substrings", async () => {
    const s = sessionWith(shirt("p-top", "White Slim Fit Shirt", 90000));
    const sweat = product({
      id: "p-sweat",
      title: "Crewneck Sweatshirt Men",
      categories: [{ value: "Apparel & Accessories > Sweatshirts" }],
      priceRange: { minMinor: 85000, maxMinor: 85000, currency: "INR" },
      variants: [],
    });
    s.evidence.set(sweat.id, { product: sweat, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
    s.searchHits.set("white shirt men", ["p-top", "p-sweat"]);
    const intent = ledgerToBaseIntent(s.ledger);
    const topItem = notarizeBoardItem(s, { productId: "p-top", insight: "your anchor", isPick: true, trusted: true }, intent);
    const presentation = {
      message: "", layout: "picks" as const, assumptions: [], sections: [], leftOut: [],
      totalMinor: null, totalCurrency: null, currency: "INR", droppedCards: 0, followUp: null,
      board: [{ name: "Shirts", items: [topItem!] }], compositions: [],
    };
    expect(await topUpBoard(s, presentation, new TraceCollector(), () => {})).toBe(0);
  });

  it("never re-adds a product that was boarded in an earlier turn", async () => {
    const s = sessionWith(shirt("p-top", "White Slim Fit Shirt", 90000));
    const sib = shirt("p-sib", "White Oxford Shirt Men", 80000);
    s.evidence.set(sib.id, { product: sib, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
    s.searchHits.set("white shirt men", ["p-top", "p-sib"]);
    s.boardedIds.add("p-sib"); // shown under another header last turn
    const intent = ledgerToBaseIntent(s.ledger);
    const topItem = notarizeBoardItem(s, { productId: "p-top", insight: "your anchor", isPick: true, trusted: true }, intent);
    const presentation = {
      message: "", layout: "picks" as const, assumptions: [], sections: [], leftOut: [],
      totalMinor: null, totalCurrency: null, currency: "INR", droppedCards: 0, followUp: null,
      board: [{ name: "Office shirts", items: [topItem!] }], compositions: [],
    };
    expect(await topUpBoard(s, presentation, new TraceCollector(), () => {})).toBe(0);
  });

  it("leaves full categories alone and never duplicates an item already on the board", async () => {
    const s = sessionWith(shirt("p-top", "White Slim Fit Shirt", 90000));
    const intent = ledgerToBaseIntent(s.ledger);
    const items = [];
    for (let i = 0; i < 6; i += 1) {
      const p = shirt(`p-full-${i}`, `Shirt Option ${i}`, 80000 + i);
      s.evidence.set(p.id, { product: p, source: "live", fetchedAt: new Date().toISOString(), snippets: [] });
      items.push(notarizeBoardItem(s, { productId: p.id, insight: "fits well", trusted: true }, intent)!);
    }
    s.searchHits.set("white shirt men", items.map((i) => i.productId));
    const presentation = {
      message: "", layout: "picks" as const, assumptions: [], sections: [], leftOut: [],
      totalMinor: null, totalCurrency: null, currency: "INR", droppedCards: 0, followUp: null,
      board: [{ name: "Shirts", items }], compositions: [],
    };
    expect(await topUpBoard(s, presentation, new TraceCollector(), () => {})).toBe(0);
    expect(presentation.board[0].items).toHaveLength(6);
  });
});
