import "server-only";
import type { TraceCollector } from "@/lib/catalog/trace";
import type { NormalizedProduct } from "@/lib/catalog/types";
import { formatMinor } from "@/lib/gift/currency";
import { ledgerToBaseIntent } from "./ledger";
import {
  resolveProductId,
  runGetProduct,
  runSimilaritySearch,
  verifyBoardItems,
  type Emit,
} from "./tools";
import { notarizeBoardItem, resolveEvidenceId, selectOffer } from "./truth";
import type {
  AgentSession,
  VerifiedBoardCategory,
  VerifiedBoardItem,
  VerifiedPresentation,
} from "./types";

/**
 * Code-built board rails. Two jobs, one admission standard (notarizeBoardItem):
 *
 * 1. runInstantSimilar — "Show Similar" answered by the catalog's own
 *    `like:{productId}` mechanism, entirely in code: no model turn, no vision
 *    pass. The whole round trip is one similarity search plus one parallel
 *    evidence batch, so the rail lands in seconds in every lens.
 *
 * 2. topUpBoard — after the model presents, thin categories are refilled with
 *    verified siblings from the same searches that produced their items. The
 *    model curates the leaders; code guarantees the shelf isn't half empty.
 *
 * Every insight/tradeoff written here is computed from verified catalog offers
 * (price deltas, result order) — code facts, never invented product claims.
 * Both paths take the turn's `aborted` guard: once a newer turn supersedes
 * this one, NOTHING here may mutate shared session state or emit.
 */

/** How many similar items the instant rail aims to show. */
const SIMILAR_RAIL_SIZE = 8;
/** A board category below this gets topped up from its own search aisles. */
const CATEGORY_TARGET = 6;
/** A whole board below this total gets missing plan components added (phase 2). */
const OVERALL_TARGET = 12;
/** Verification budget per thin category (one parallel evidence batch). */
const TOP_UP_POOL = 12;

function shortTitle(title: string, max = 34): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Price-delta line vs. an anchor offer — real arithmetic on verified offers. */
function priceDelta(
  product: NormalizedProduct,
  anchor: { priceMinor: number | null; currency: string | null } | null,
): { text: string | null; sign: -1 | 0 | 1 | null } {
  const offer = selectOffer(product);
  if (
    !anchor ||
    anchor.priceMinor == null ||
    offer.priceMinor == null ||
    !anchor.currency ||
    !offer.currency ||
    anchor.currency.toUpperCase() !== offer.currency.toUpperCase()
  ) {
    return { text: null, sign: null };
  }
  const diff = offer.priceMinor - anchor.priceMinor;
  if (diff === 0) return { text: "the same price", sign: 0 };
  const amount = formatMinor(Math.abs(diff), offer.currency);
  return diff < 0
    ? { text: `${amount} less`, sign: -1 }
    : { text: `${amount} more`, sign: 1 };
}

export interface InstantSimilarOutcome {
  /** True when a presentation was emitted (the turn can end here). */
  presented: boolean;
  /** Model-facing record of what happened, for the loop or the next turn. */
  observation: string;
}

/**
 * The instant "Show Similar" rail: Shopify's own similarity search, verified
 * and presented straight from code. Used identically by all four lenses.
 */
export async function runInstantSimilar(
  session: AgentSession,
  rawProductId: string,
  trace: TraceCollector,
  emit: Emit,
  aborted?: () => boolean,
): Promise<InstantSimilarOutcome> {
  const anchorId = resolveProductId(session, rawProductId);
  // After a server restart the session is fresh and the anchor is a stranger —
  // fetch its evidence so the rail still gets a real title and price deltas.
  if (!session.evidence.has(resolveEvidenceId(session, anchorId))) {
    await runGetProduct(session, anchorId, trace, emit);
    if (aborted?.()) return { presented: false, observation: "" };
  }
  const anchorEntry = session.evidence.get(resolveEvidenceId(session, anchorId));
  const anchorTitle =
    anchorEntry?.product.title ??
    session.candidates.get(anchorId)?.split(" | ")[1]?.trim() ??
    "that product";
  const anchorOffer = anchorEntry ? selectOffer(anchorEntry.product) : null;

  const { observation, products } = await runSimilaritySearch(session, anchorId, trace, emit);
  if (aborted?.()) return { presented: false, observation: "" };
  if (products.length === 0) return { presented: false, observation };

  const shortlist = products.slice(0, SIMILAR_RAIL_SIZE);
  await verifyBoardItems(session, shortlist.map((p) => p.id), trace, emit);
  if (aborted?.()) return { presented: false, observation: "" };

  const intent = ledgerToBaseIntent(session.ledger);
  const items: VerifiedBoardItem[] = [];
  for (const product of shortlist) {
    // Delta from the SAME evidence entry the card's displayed price comes
    // from — a fresh search payload can carry a newer price than the card.
    const entry = session.evidence.get(resolveEvidenceId(session, product.id));
    if (!entry) continue;
    const isPick = items.length < 2;
    const delta = priceDelta(entry.product, anchorOffer);
    const insight =
      delta.text != null
        ? delta.sign === 0
          ? `Close catalog match at ${delta.text}`
          : `Close catalog match — ${delta.text} than the one you tapped`
        : "The catalog's own close match for the one you tapped";
    const tradeoff = isPick ? null : "Lower down the catalog's similar-items list";
    const item = notarizeBoardItem(
      session,
      { productId: product.id, insight, tradeoff, isPick, trusted: true },
      intent,
    );
    if (item) items.push(item);
  }
  if (items.length === 0) {
    return {
      presented: false,
      observation: `${observation}\nSYSTEM: none of the similar results survived the budget/currency/stock screens.`,
    };
  }

  // The headline only ranks what is actually shown.
  const tail =
    items.length >= 3
      ? " — the first two are the tightest"
      : items.length === 2
        ? " — both are tight matches"
        : "";
  const presentation: VerifiedPresentation = {
    message:
      `Pulled ${items.length} close ${items.length === 1 ? "match" : "matches"} for "${shortTitle(anchorTitle)}" straight from the catalog's own similarity engine${tail}. Tell me what to tweak (colour, price, vibe) and I'll narrow from here.`,
    layout: "picks",
    assumptions: [],
    sections: [],
    leftOut: [],
    totalMinor: null,
    totalCurrency: null,
    currency: session.ledger.constraints.currency,
    droppedCards: 0,
    followUp: null,
    // A longer title in the rail name keeps two different anchors from
    // colliding into one merged category on the client.
    board: [{ name: `Similar to ${shortTitle(anchorTitle, 48)}`, items }],
    compositions: [],
  };
  if (aborted?.()) return { presented: false, observation: "" };
  emit({ type: "present", presentation });
  for (const item of items) session.boardedIds.add(item.productId);
  session.transcript.push({
    role: "assistant",
    content: `Showed ${items.length} catalog-similar matches for "${anchorTitle}" (instant similarity rail).`,
    turn: session.turn,
  });
  return {
    presented: true,
    observation: `${observation}\nSYSTEM: these were ALREADY presented to the shopper as an instant "Similar to" rail.`,
  };
}

/**
 * Last-resort board built entirely in code from the session's VERIFIED evidence
 * — grouped by catalog category — so a turn that would otherwise DEGRADE (the
 * model narrated instead of presenting, ran out of steps, or timed out) still
 * hands the shopper real products instead of a dead end. Everything goes through
 * notarizeBoardItem, so the same budget / currency / opt-in / price screens
 * apply. Returns null only when there is genuinely nothing verified to show.
 */
export function composeFallbackPresentation(session: AgentSession): VerifiedPresentation | null {
  const intent = ledgerToBaseIntent(session.ledger);
  const byCategory = new Map<string, VerifiedBoardItem[]>();
  const order: string[] = [];
  for (const [id, entry] of session.evidence) {
    if (session.boardedIds.has(id)) continue; // don't repeat what's already on screen
    const item = notarizeBoardItem(
      session,
      { productId: id, insight: "One of the options I found for you.", isPick: false, trusted: true },
      intent,
    );
    if (!item) continue;
    const leaf = leafCategory(entry.product.categories[0]?.value ?? "Options") || "Options";
    const name = leaf.charAt(0).toUpperCase() + leaf.slice(1);
    if (!byCategory.has(name)) {
      byCategory.set(name, []);
      order.push(name);
    }
    const bucket = byCategory.get(name)!;
    if (bucket.length < CATEGORY_TARGET) bucket.push(item);
  }
  const board: VerifiedBoardCategory[] = order
    .map((name) => ({ name, items: byCategory.get(name) ?? [] }))
    .filter((c) => c.items.length > 0)
    .slice(0, 6);
  if (board.reduce((n, c) => n + c.items.length, 0) === 0) return null;
  return {
    message:
      "Here are the options I pulled together for you — tell me what to refine (price, style, or anything else) and I'll narrow it down.",
    layout: "picks",
    assumptions: [],
    sections: [],
    leftOut: [],
    totalMinor: null,
    totalCurrency: null,
    currency: session.ledger.constraints.currency,
    droppedCards: 0,
    followUp: null,
    board,
    compositions: [],
  };
}

/**
 * Words too generic to signal relevance — a shared "men"/"budget" means nothing
 * about whether a sweatshirt belongs in a Shirts rail. Only DISTINCTIVE terms
 * (salicylic, vitamin, cleanser, linen…) count toward the relevance score.
 */
const GENERIC_QUERY_WORDS = new Set([
  "men", "mens", "women", "womens", "unisex", "kids", "kid", "boys", "girls", "ladies", "gents",
  "best", "top", "new", "good", "great", "cheap", "budget", "premium", "quality", "affordable",
  "value", "pack", "set", "size", "piece", "pcs", "for", "the", "and", "with", "your", "his", "her",
]);

/** Words of the category name (singularized) that can vouch for a product. */
function categoryNouns(categoryName: string): string[] {
  return categoryName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.replace(/(?:es|s)$/, ""));
}

/** The leaf segment of a taxonomy path ("Apparel > Clothing > Shirts" → "Shirts"). */
function leafCategory(value: string): string {
  const parts = value.split(">");
  return (parts[parts.length - 1] ?? value).trim();
}

/** Singularized whole-word tokens — substring tricks ("sweatSHIRT") don't count. */
function wordTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.replace(/(?:es|s)$/, "")),
  );
}

/**
 * How ON-TARGET a candidate is for a component, 0..N: how many of the
 * component's PROFILE terms (the words of the generic searches that built the
 * category, plus the category name) actually appear in the product's title or
 * leaf categories. This is what keeps breadth from becoming noise — a generic
 * "vitamin c serum" search returns lots of products, but only the ones that
 * genuinely carry "vitamin"/"serum" score, and we fill the board best-first.
 */
function relevanceScore(product: NormalizedProduct, profile: Set<string>): number {
  if (profile.size === 0) return 1; // nothing to judge against — don't over-filter
  const tokens = wordTokens(
    `${product.title} ${product.categories.map((c) => leafCategory(c.value)).join(" ")}`,
  );
  let score = 0;
  for (const t of profile) if (tokens.has(t)) score += 1;
  return score;
}

/**
 * A same-search sibling still has to LOOK like the category before it fills a
 * slot: a category-name noun must appear as a WHOLE WORD in its title or leaf
 * catalog category, or it must share a leaf catalog category with an item
 * already admitted there. Whole-word + leaf-only matching keeps "sweatshirt"
 * out of Shirts, "laptop sleeve" out of Tops, and stops the "Apparel &
 * Accessories" taxonomy ancestor from vouching every garment into Accessories.
 */
function fitsCategory(
  session: AgentSession,
  candidate: NormalizedProduct,
  categoryName: string,
  existingIds: string[],
): boolean {
  const candidateTokens = wordTokens(
    `${candidate.title} ${candidate.categories.map((c) => leafCategory(c.value)).join(" ")}`,
  );
  if (categoryNouns(categoryName).some((noun) => candidateTokens.has(noun))) return true;
  const candidateLeaves = new Set(
    candidate.categories.map((c) => leafCategory(c.value).toLowerCase()),
  );
  for (const id of existingIds) {
    const product = session.evidence.get(resolveEvidenceId(session, id))?.product;
    if (!product) continue;
    for (const c of product.categories) {
      if (candidateLeaves.has(leafCategory(c.value).toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Refill thin board categories from the searches that produced their items —
 * verified, category-checked, and labeled honestly as auto-added. Mutates the
 * presentation in place; returns how many items were added.
 */
export async function topUpBoard(
  session: AgentSession,
  presentation: VerifiedPresentation,
  trace: TraceCollector,
  emit: Emit,
  aborted?: () => boolean,
): Promise<number> {
  // Never re-add anything already visible: this presentation's board AND its
  // featured cards, plus everything boarded in earlier turns (the client's
  // board is add-only, so a cross-turn duplicate renders twice on screen).
  const boardSeen = new Set([
    ...presentation.board.flatMap((c) => c.items.map((i) => i.productId)),
    ...presentation.sections.flatMap((s) => s.cards.map((c) => c.productId)),
    ...session.boardedIds,
  ]);
  const intent = ledgerToBaseIntent(session.ledger);
  let added = 0;

  for (const category of presentation.board) {
    if (category.items.length >= CATEGORY_TARGET) continue;
    const existingIds = category.items.map((i) => i.productId);

    // The candidate pool: every product surfaced by a search that contributed
    // at least one item already in this category, in result order. As we walk
    // the contributing searches we also build the component's RELEVANCE PROFILE
    // (their query words + the category name) so we can keep only on-target
    // siblings — breadth without noise.
    const profile = new Set<string>();
    for (const noun of categoryNouns(category.name)) {
      if (!GENERIC_QUERY_WORDS.has(noun)) profile.add(noun);
    }
    const pool: string[] = [];
    const inPool = new Set<string>();
    for (const [query, ids] of session.searchHits.entries()) {
      if (!ids.some((id) => existingIds.includes(id))) continue;
      for (const t of wordTokens(query)) if (!GENERIC_QUERY_WORDS.has(t)) profile.add(t);
      for (const id of ids) {
        if (boardSeen.has(id) || inPool.has(id)) continue;
        inPool.add(id);
        pool.push(id);
      }
    }
    if (pool.length === 0) continue;

    const candidates = pool.slice(0, TOP_UP_POOL);
    await verifyBoardItems(session, candidates, trace, emit);
    if (aborted?.()) return added;

    // Score each verified candidate for relevance to the component, then fill
    // the board MOST-RELEVANT first (ties keep catalog result order). A generic
    // search gives lots of options; this makes sure the ones we auto-add are
    // the ones that actually match the plan component.
    const scored = candidates
      .map((id) => {
        const product = session.evidence.get(resolveEvidenceId(session, id))?.product ?? null;
        return product ? { id, product, score: relevanceScore(product, profile) } : null;
      })
      .filter((x): x is { id: string; product: NormalizedProduct; score: number } => x != null)
      .sort((a, b) => b.score - a.score);

    const top = category.items[0] ?? null;
    for (const { id, product, score } of scored) {
      if (category.items.length >= CATEGORY_TARGET) break;
      const entry = session.evidence.get(resolveEvidenceId(session, id));
      if (!entry) continue;
      // Admit an on-target sibling: it either LOOKS like the category
      // (fitsCategory — right catalog kind) OR shares a real term with the
      // component's search profile (score >= 1). Either alone is enough — a
      // "salicylic serum" sibling fills a "Treatments" category via the profile
      // term even though "treatment" isn't in its title. Only a sibling that
      // matches NEITHER is noise we skip. The score also ordered them best-first.
      if (score < 1 && !fitsCategory(session, product, category.name, existingIds)) continue;
      const delta = priceDelta(entry.product, top);
      const insight =
        delta.text != null
          ? delta.sign === 0
            ? "From the same aisle, same price as the top pick"
            : `From the same aisle — ${delta.text} than the top pick`
          : "From the same search aisle as the picks above";
      const item = notarizeBoardItem(
        session,
        {
          productId: id,
          insight,
          tradeoff: "Auto-added from search results, not hand-argued",
          isPick: false,
          trusted: true,
        },
        intent,
      );
      if (!item) continue;
      category.items.push(item);
      boardSeen.add(item.productId);
      added += 1;
    }
  }

  // Phase 2 — WHOLE-BOARD richness. A small model often boards ONE component and
  // drops the rest it found (presents "Carbs" but not the protein / veg / fats,
  // or one "Treatments" item and no cleanser / SPF). If the board is still thin
  // overall, fill it from ALL candidates, grouped by catalog category, up to a
  // rich total. Everything still passes notarizeBoardItem (budget / currency /
  // opt-in / price), so gated items (e.g. supplements without consent) never slip
  // in — we just keep pulling until the board is rich or the pool is exhausted.
  const boardTotal = () => presentation.board.reduce((n, c) => n + c.items.length, 0);
  if (boardTotal() < OVERALL_TARGET) {
    const fresh = [...session.candidates.keys()]
      .filter((id) => !boardSeen.has(resolveEvidenceId(session, id)))
      .slice(0, 24);
    if (fresh.length > 0) {
      await verifyBoardItems(session, fresh, trace, emit);
      if (aborted?.()) return added;
      for (const id of fresh) {
        if (boardTotal() >= OVERALL_TARGET) break;
        const entry = session.evidence.get(resolveEvidenceId(session, id));
        if (!entry) continue;
        const item = notarizeBoardItem(
          session,
          { productId: id, insight: "Also part of the plan — one to consider.", isPick: false, trusted: true },
          intent,
        );
        if (!item || boardSeen.has(item.productId)) continue;
        const leaf = leafCategory(entry.product.categories[0]?.value ?? "Options") || "Options";
        const name = leaf.charAt(0).toUpperCase() + leaf.slice(1);
        const existing = presentation.board.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          if (existing.items.length >= CATEGORY_TARGET) continue;
          existing.items.push(item);
        } else {
          presentation.board.push({ name, items: [item] });
        }
        boardSeen.add(item.productId);
        added += 1;
      }
    }
  }

  return added;
}
