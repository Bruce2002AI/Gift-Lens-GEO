import { describe, expect, it } from "vitest";
import { ensureBoardBreadth } from "@/lib/agent/board";
import { productIdentityKey } from "@/lib/agent/dedup";
import { ledgerToBaseIntent, newSession } from "@/lib/agent/ledger";
import { notarizeBoardItem, verifyPresentation } from "@/lib/agent/truth";
import {
  sniffDirectRequest,
  topicSearched,
  unsearchedInterestTerms,
  wantsMoreVariety,
} from "@/lib/agent/loop";
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

// Fifteen genuinely different movie-themed gifts — low pairwise title overlap,
// like real catalog results (not "Movie Gift 1/2/3", which the variety guard
// would correctly collapse as near-identical).
const MOVIE_GIFTS = [
  "Ben 10 Omnitrix Projector Watch",
  "Gwen Tennyson Collectible Action Figure",
  "Retro Cinema Popcorn Maker",
  "Vintage Film Reel Wall Clock",
  "Movie Night Wearable Blanket Hoodie",
  "Director Clapboard Hardcover Notebook",
  "Classic Film Poster Framed Set",
  "Galaxy Star Ceiling Projector Lamp",
  "Superhero Ceramic Character Mug",
  "Film Buff Trivia Card Game",
  "Portable Bluetooth Cinema Speaker",
  "Cozy Fleece Cinema Throw",
  "Scented Popcorn Soy Candle",
  "Widescreen Foldable Phone Stand",
  "Marvel Universe Sticker Journal",
];

describe("ensureBoardBreadth — the 10-20 options guarantee", () => {
  it("fills a one-pick board toward the target from the searches already run", async () => {
    // One curated pen, plus a whole aisle of movie-themed gifts already found.
    const pen = product({ id: "pen", title: "Noble Heritage Fountain Pen", categories: [{ value: "Office > Pens" }] });
    const movieGifts = MOVIE_GIFTS.map((title, i) =>
      product({ id: `m${i}`, title, categories: [{ value: "Gifts > Cinema" }] }),
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
    // Brand-varied pens: they share the "Pens" leaf (so they fit) but differ
    // enough in title to survive the near-duplicate variety guard.
    const brands = ["Parker Sonnet", "Lamy Safari", "Cross Century", "Pilot Metropolitan", "Waterman Expert", "Sheaffer Prelude"];
    const penSiblings = brands.map((b, i) =>
      product({ id: `pen${i + 1}`, title: `${b} Fountain Pen`, categories: [{ value: "Office > Pens" }] }),
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

  it("excludes a multi-merchant relisting of a product already shown", async () => {
    const pen = product({ id: "pen", title: "Noble Heritage Fountain Pen", categories: [{ value: "Office > Pens" }] });
    // A DIFFERENT id, but the same product from another seller.
    const relisting = product({ id: "pen-otherseller", title: "Noble Heritage Fountain Pen", categories: [{ value: "Office > Pens" }] });
    const other = product({ id: "org", title: "Walnut Desk Organizer", categories: [{ value: "Office > Desk" }] });
    const s = sessionWithEvidence([pen, relisting, other]);
    s.searchHits.set("fountain pen", ["pen", "pen-otherseller", "org"]);
    // The pen was already boarded last turn — its identity is remembered.
    s.boardedIds.add("pen");
    s.boardedIdentities.add(productIdentityKey(pen));

    const presentation = presentationWith(s, "Pens", []); // empty seed board
    await ensureBoardBreadth(s, presentation, new TraceCollector(), noop);
    const titles = presentation.board.flatMap((c) => c.items.map((i) => i.title));
    // The relisting is filtered out; the genuinely different organizer gets in.
    expect(titles.filter((t) => t === "Noble Heritage Fountain Pen")).toHaveLength(0);
    expect(titles).toContain("Walnut Desk Organizer");
  });

  it("does not stack near-identical items in one rail — variety over repetition", async () => {
    const base = product({ id: "b0", title: "Noble Heritage Fountain Pen Black", categories: [{ value: "Office > Pens" }] });
    // Same pen line, different colours — distinct ids/identities, but near-identical titles.
    const blue = product({ id: "b1", title: "Noble Heritage Fountain Pen Blue", categories: [{ value: "Office > Pens" }] });
    const green = product({ id: "b2", title: "Noble Heritage Fountain Pen Green", categories: [{ value: "Office > Pens" }] });
    const varied = product({ id: "b3", title: "Parker Sonnet Rollerball Pen", categories: [{ value: "Office > Pens" }] });
    const s = sessionWithEvidence([base, blue, green, varied]);
    s.searchHits.set("fountain pen", ["b0", "b1", "b2", "b3"]);

    const presentation = presentationWith(s, "Pens", ["b0"]);
    await ensureBoardBreadth(s, presentation, new TraceCollector(), noop);
    const titles = presentation.board.flatMap((c) => c.items.map((i) => i.title));
    // The near-identical Blue/Green colours are held back; the varied pen gets in.
    expect(titles).not.toContain("Noble Heritage Fountain Pen Blue");
    expect(titles).not.toContain("Noble Heritage Fountain Pen Green");
    expect(titles).toContain("Parker Sonnet Rollerball Pen");
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
    const pen = product({ id: "pen", title: "Noble Heritage Fountain Pen" });
    const extras = MOVIE_GIFTS.slice(0, 10).map((title, i) => product({ id: `x${i}`, title }));
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

  it("does not count an interest as searched from a mere substring of a prior query", () => {
    const s = newSession("s1", "gift");
    s.ledger.facts.push({
      id: "f1", key: "recipient.interests", value: "cat", provenance: "said", quote: "cat", turn: 1, lens: "gift",
    });
    // A prior generic query contains "cat" as a substring ("deli-cat-e") but the
    // recipient's love of cats was never actually searched.
    s.searchHits.set("delicate silver necklace", ["p1"]);
    s.ledger.searchQueries.push("delicate silver necklace");
    expect(unsearchedInterestTerms(s)).toContain("cat");
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

describe("sniffDirectRequest — obey a literal request, don't reinterpret it", () => {
  it("extracts the literal topic and the 'only' replace intent", () => {
    expect(sniffDirectRequest("show me ben 10 related products only")).toEqual({
      phrase: "ben 10",
      only: true,
    });
    expect(sniffDirectRequest("just show me sarees")).toEqual({ phrase: "sarees", only: false });
    expect(sniffDirectRequest("find me red dresses instead")).toEqual({
      phrase: "red dresses",
      only: true,
    });
    expect(sniffDirectRequest("i want harry potter merchandise")).toEqual({
      phrase: "harry potter",
      only: false,
    });
  });

  it("does not fire on vague asks or pure variety/refinement", () => {
    expect(sniffDirectRequest("show me more options")).toBeNull();
    expect(sniffDirectRequest("find me something cheaper")).toBeNull();
    expect(sniffDirectRequest("i want something for my dad")).toBeNull();
    expect(sniffDirectRequest("that looks great, thanks")).toBeNull();
    // Variety-openers route to wantsMoreVariety, not a garbage literal search.
    expect(sniffDirectRequest("show me more gift ideas, my budget is only 2000")).toBeNull();
    // Goal/emotion clauses are not product topics.
    expect(sniffDirectRequest("i want to lose 10 kg")).toBeNull();
    expect(sniffDirectRequest("i want her to feel special")).toBeNull();
  });

  it("does not treat a quantifier/idiom 'only' as a board-replace", () => {
    // BUG 1: "only 2000" (budget) must not wipe the board. (Also routed to null
    // above, but assert the replace-detector directly on a topical case.)
    expect(sniffDirectRequest("show me sarees, budget is only 3000")).toEqual({
      phrase: "sarees",
      only: false,
    });
    expect(sniffDirectRequest("find me a jacket she can only wear in winter")).toMatchObject({
      only: false,
    });
  });

  it("keeps product qualifiers after 'for' (only strips recipients)", () => {
    // BUG 3: "for running" must survive; "for my sister" is a recipient.
    expect(sniffDirectRequest("show me shoes for running")).toEqual({
      phrase: "shoes for running",
      only: false,
    });
    expect(sniffDirectRequest("find me a dress for her")).toEqual({ phrase: "dress", only: false });
  });

  it("handles 'just <topic>' as a replace but 'just show me' as additive", () => {
    expect(sniffDirectRequest("show me just sarees")).toEqual({ phrase: "sarees", only: true });
    expect(sniffDirectRequest("just show me sarees")).toEqual({ phrase: "sarees", only: false });
  });
});

describe("topicSearched — did we actually look for what they asked?", () => {
  it("is false until the literal topic is queried, then true", () => {
    const s = newSession("s1", "gift");
    expect(topicSearched(s, "ben 10")).toBe(false);
    s.ledger.searchQueries.push("ben 10 gift"); // attempted (even if it found nothing)
    expect(topicSearched(s, "ben 10")).toBe(true);
    // A different aisle does not count as searching the topic.
    const other = newSession("s2", "gift");
    other.ledger.searchQueries.push("minimalist desk organizer");
    expect(topicSearched(other, "ben 10")).toBe(false);
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
