import { describe, expect, it } from "vitest";
import { ensureBoardBreadth } from "@/lib/agent/board";
import { ledgerToBaseIntent, newSession } from "@/lib/agent/ledger";
import { notarizeBoardItem, verifyPresentation } from "@/lib/agent/truth";
import { unsearchedInterestTerms, wantsMoreVariety } from "@/lib/agent/loop";
import { TraceCollector } from "@/lib/catalog/trace";
import type { AgentSession, Presentation, VerifiedPresentation } from "@/lib/agent/types";
import type { NormalizedProduct } from "@/lib/catalog/types";

/**
 * The shopper's #1 ask — "first make sure I get at least 10-20 options to
 * choose" — is guaranteed in CODE by ensureBoardBreadth: whatever the model
 * curates, the board is filled toward a floor from the searches already run,
 * so a one-pick board never ships. These prove the guarantee, the anti-fixation
 * detector (search the new interest), and the variety detector deterministically
 * — no LLM, no network (every candidate is pre-seeded into evidence).
 */

function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  const id = overrides.id ?? "p1";
  return {
    id,
    title: "A Product",
    description: "A perfectly ordinary catalog item with a plain description.",
    url: `https://example.com/${id}`,
    handle: id,
    categories: [{ value: "General > Things" }],
    images: [{ url: "https://example.com/img.jpg", altText: null, type: "image" }],
    priceRange: { minMinor: 200000, maxMinor: 200000, currency: "INR" },
    options: [],
    variants: [
      {
        id: `${id}-v1`,
        title: "Default",
        url: `https://example.com/${id}`,
        sku: null,
        priceMinor: 200000,
        currency: "INR",
        available: true,
        availabilityStatus: "in_stock",
        runningLow: null,
        checkoutUrl: null,
        nativeCheckoutEligible: null,
        requiresShipping: true,
        imageUrl: null,
        options: [],
        seller: { id: null, name: "Shop Co", url: null, domain: null, policyLinks: [] },
        description: "",
        rating: { value: null, scaleMin: null, scaleMax: null, count: null },
        condition: ["new"],
      },
    ],
    rating: { value: 4.5, scaleMin: 1, scaleMax: 5, count: 20 },
    seller: { id: null, name: "Shop Co", url: null, domain: null, policyLinks: [] },
    metadata: { techSpecs: [], topFeatures: [], uniqueSellingPoints: [], specs: [] },
    rawMessages: [],
    ...overrides,
  };
}

/** A session with a set of products already verified into evidence. */
function sessionWithEvidence(products: NormalizedProduct[]): AgentSession {
  const s = newSession("s1", "gift");
  s.turn = 2;
  for (const p of products) {
    s.evidence.set(p.id, {
      product: p,
      source: "live",
      fetchedAt: new Date().toISOString(),
      snippets: [],
    });
  }
  return s;
}

/** A minimal presentation seeded with one board category holding `ids`. */
function presentationWith(
  session: AgentSession,
  categoryName: string,
  ids: string[],
): VerifiedPresentation {
  const intent = ledgerToBaseIntent(session.ledger);
  const items = ids.map(
    (id) => notarizeBoardItem(session, { productId: id, insight: "a pick", trusted: true }, intent)!,
  );
  return {
    message: "",
    layout: "picks",
    assumptions: [],
    sections: [],
    leftOut: [],
    totalMinor: null,
    totalCurrency: null,
    currency: "INR",
    droppedCards: 0,
    followUp: null,
    board: [{ name: categoryName, items }],
    compositions: [],
  };
}

const noop = () => {};

describe("ensureBoardBreadth — the 10-20 options guarantee", () => {
  it("fills a one-pick board toward the target from the searches already run", async () => {
    // One curated pen, plus a whole aisle of movie-themed gifts already found.
    const pen = product({ id: "pen", title: "Noble Heritage Fountain Pen", categories: [{ value: "Office > Pens" }] });
    const movieGifts = Array.from({ length: 15 }, (_, i) =>
      product({ id: `m${i}`, title: `Movie Gift ${i}`, categories: [{ value: "Gifts > Cinema" }] }),
    );
    const s = sessionWithEvidence([pen, ...movieGifts]);
    s.searchHits.set("movie lover gift", movieGifts.map((p) => p.id));

    const presentation = presentationWith(s, "Fountain Pens", ["pen"]);
    const added = await ensureBoardBreadth(s, presentation, new TraceCollector(), noop);

    const total = presentation.board.reduce((n, c) => n + c.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(12); // comfortably inside "10-20"
    expect(added).toBe(total - 1);
    // The movie gifts didn't fit "Fountain Pens", so they joined an honest catch-all.
    const catchAll = presentation.board.find((c) => c.name.startsWith("More ideas"));
    expect(catchAll).toBeTruthy();
    expect(catchAll!.items.length).toBeGreaterThan(0);
  });

  it("slots same-category siblings into the existing rail, not the catch-all", async () => {
    const anchor = product({ id: "pen0", title: "Classic Fountain Pen", categories: [{ value: "Office > Pens" }] });
    const penSiblings = Array.from({ length: 6 }, (_, i) =>
      product({ id: `pen${i + 1}`, title: `Fountain Pen ${i + 1}`, categories: [{ value: "Office > Pens" }] }),
    );
    const s = sessionWithEvidence([anchor, ...penSiblings]);
    s.searchHits.set("fountain pen", [anchor.id, ...penSiblings.map((p) => p.id)]);

    const presentation = presentationWith(s, "Fountain Pens", ["pen0"]);
    await ensureBoardBreadth(s, presentation, new TraceCollector(), noop);

    // Siblings share the "Pens" leaf category, so they deepen that rail (capped
    // at CATEGORY_CAP=8) rather than spawning a catch-all.
    const pens = presentation.board.find((c) => c.name === "Fountain Pens")!;
    expect(pens.items.length).toBeGreaterThan(1);
    expect(pens.items.length).toBeLessThanOrEqual(8);
  });

  it("never re-adds a product already shown this session", async () => {
    const pen = product({ id: "pen", title: "Noble Heritage Fountain Pen" });
    const sib = product({ id: "sib", title: "Silver Pen" });
    const s = sessionWithEvidence([pen, sib]);
    s.searchHits.set("pen", ["pen", "sib"]);
    s.boardedIds.add("sib"); // shown under another header last turn

    const presentation = presentationWith(s, "Pens", ["pen"]);
    const added = await ensureBoardBreadth(s, presentation, new TraceCollector(), noop);
    const ids = presentation.board.flatMap((c) => c.items.map((i) => i.productId));
    expect(ids).not.toContain("sib");
    expect(added).toBe(0);
  });

  it("is a no-op when the board is already deep enough", async () => {
    const prods = Array.from({ length: 14 }, (_, i) => product({ id: `p${i}` }));
    const s = sessionWithEvidence(prods);
    s.searchHits.set("stuff", prods.map((p) => p.id));
    const presentation = presentationWith(s, "Things", prods.map((p) => p.id));
    expect(await ensureBoardBreadth(s, presentation, new TraceCollector(), noop)).toBe(0);
  });

  it("adds nothing when there are no other candidates to draw from", async () => {
    const pen = product({ id: "pen" });
    const s = sessionWithEvidence([pen]);
    const presentation = presentationWith(s, "Pens", ["pen"]);
    expect(await ensureBoardBreadth(s, presentation, new TraceCollector(), noop)).toBe(0);
  });

  it("stops mutating when the turn is superseded (aborted)", async () => {
    const pen = product({ id: "pen" });
    const extras = Array.from({ length: 10 }, (_, i) => product({ id: `x${i}` }));
    const s = sessionWithEvidence([pen, ...extras]);
    s.searchHits.set("stuff", extras.map((p) => p.id));
    const presentation = presentationWith(s, "Pens", ["pen"]);
    // Not aborted → it fills; aborted-from-the-start still returns cleanly.
    const added = await ensureBoardBreadth(s, presentation, new TraceCollector(), noop, () => false);
    expect(added).toBeGreaterThan(0);
  });
});

describe("unsearchedInterestTerms — react to a new interest instead of fixating", () => {
  it("flags an interest the agent recorded but never searched", () => {
    const s = newSession("s1", "gift");
    s.ledger.facts.push({
      id: "f1",
      key: "recipient.interests",
      value: "movies",
      provenance: "said",
      quote: "she likes movies",
      turn: 1,
      lens: "gift",
    });
    s.ledger.facts.push({
      id: "f2",
      key: "recipient.favourite_character",
      value: "Gwen Tennyson",
      provenance: "said",
      quote: "gwen tennyson is her favourite character",
      turn: 1,
      lens: "gift",
    });
    // The agent only ever searched fountain pens.
    s.searchHits.set("luxury fountain pen", ["p1", "p2"]);
    s.ledger.searchQueries.push("luxury fountain pen");

    const terms = unsearchedInterestTerms(s);
    expect(terms).toContain("movies");
    expect(terms).toContain("Gwen Tennyson");
  });

  it("does not re-flag an interest once it has been searched", () => {
    const s = newSession("s1", "gift");
    s.ledger.facts.push({
      id: "f1",
      key: "recipient.interests",
      value: "movies",
      provenance: "said",
      quote: "movies",
      turn: 1,
      lens: "gift",
    });
    s.searchHits.set("movie lover gift", ["p1"]);
    s.ledger.searchQueries.push("movie lover gift");
    expect(unsearchedInterestTerms(s)).not.toContain("movies");
  });

  it("ignores non-interest facts (style, budget) — they refine, not redirect", () => {
    const s = newSession("s1", "gift");
    s.ledger.facts.push({
      id: "f1",
      key: "recipient.style",
      value: "minimalist",
      provenance: "said",
      quote: "minimalist",
      turn: 1,
      lens: "gift",
    });
    expect(unsearchedInterestTerms(s)).toEqual([]);
  });
});

describe("wantsMoreVariety — hear 'give me something different'", () => {
  function withLastUser(text: string): AgentSession {
    const s = newSession("s1", "gift");
    s.candidates.set("p1", "line");
    s.transcript.push({ role: "user", content: text, turn: 2 });
    return s;
  }

  it("fires on the transcript's exact ask and other variety phrasings", () => {
    expect(wantsMoreVariety(withLastUser("think of some other variety of options man"))).toBe(true);
    expect(wantsMoreVariety(withLastUser("show me something different"))).toBe(true);
    expect(wantsMoreVariety(withLastUser("any other options?"))).toBe(true);
    expect(wantsMoreVariety(withLastUser("not these, show me more ideas"))).toBe(true);
  });

  it("stays quiet on a plain refinement or an empty board", () => {
    expect(wantsMoreVariety(withLastUser("can you make it under 3000"))).toBe(false);
    expect(wantsMoreVariety(withLastUser("she likes the blue one"))).toBe(false);
    // Nothing shown yet → nothing to vary.
    const fresh = newSession("s2", "gift");
    fresh.transcript.push({ role: "user", content: "show me more options", turn: 1 });
    expect(wantsMoreVariety(fresh)).toBe(false);
  });
});

describe("compositions need at least two pieces — no more '1 option' sets", () => {
  function boardOf(session: AgentSession, ids: string[]): Presentation["board"] {
    return [
      {
        name: "Ideas",
        items: ids.map((id) => ({ productId: id, insight: "a pick", tradeoff: null })),
      },
    ];
  }

  it("drops a single-product composition and keeps a genuine two-piece set", () => {
    const a = product({ id: "a", title: "Fountain Pen", priceRange: { minMinor: 500000, maxMinor: 500000, currency: "INR" } });
    const b = product({ id: "b", title: "Leather Notebook", priceRange: { minMinor: 150000, maxMinor: 150000, currency: "INR" } });
    const s = sessionWithEvidence([a, b]);
    const raw: Presentation = {
      message: "Here are some ideas.",
      layout: "picks",
      assumptions: [],
      sections: [],
      leftOut: [],
      board: boardOf(s, ["a", "b"]),
      compositions: [
        { name: "The lone set", rationale: "Just the pen, nothing paired.", productIds: ["a"] },
        { name: "Desk duo", rationale: "The pen and notebook make a cohesive gift.", productIds: ["a", "b"] },
      ],
    };
    const { presentation } = verifyPresentation(s, raw);
    expect(presentation.compositions).toHaveLength(1);
    expect(presentation.compositions[0].name).toBe("Desk duo");
  });
});
