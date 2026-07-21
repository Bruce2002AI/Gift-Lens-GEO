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
/** Verification budget per thin category (one parallel evidence batch). */
const TOP_UP_POOL = 12;

/**
 * The whole board should read as a real shelf to choose from — the shopper's
 * explicit ask is "at least 10-20 options". These bound the breadth top-up that
 * fills the board toward a floor after the model + category top-up have run.
 */
const BOARD_TARGET = 14;
/** No single category may swallow the entire breadth fill. */
const CATEGORY_CAP = 8;
/** One parallel evidence batch caps the breadth pass's verification cost. */
const BREADTH_VERIFY_POOL = 20;

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
    // at least one item already in this category, in result order.
    const pool: string[] = [];
    const inPool = new Set<string>();
    for (const ids of session.searchHits.values()) {
      if (!ids.some((id) => existingIds.includes(id))) continue;
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

    const top = category.items[0] ?? null;
    for (const id of candidates) {
      if (category.items.length >= CATEGORY_TARGET) break;
      const entry = session.evidence.get(resolveEvidenceId(session, id));
      if (!entry) continue;
      if (!fitsCategory(session, entry.product, category.name, existingIds)) continue;
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
  return added;
}

/**
 * Guarantee the board is a real shelf to choose from — the shopper's own words:
 * "at least 10-20 options". Where `topUpBoard` only deepens the categories the
 * model already drew, this fills the board TOWARD a floor by pulling verified
 * candidates from EVERY search this session ran — most-recently-searched aisle
 * first, so a fresh interest ("movies", a favourite character) leads rather than
 * the stale opening aisle. Each item slots into a category it genuinely fits, or
 * an honest catch-all "More ideas" group rather than mislabel an existing rail.
 *
 * Same admission standard as everything else (`notarizeBoardItem`): verified
 * evidence, constraint pass, opt-in gate, sane price, one currency. Every
 * insight is code-authored from real offers, never an invented product claim.
 * Mutates the presentation in place; returns how many items were added.
 */
export async function ensureBoardBreadth(
  session: AgentSession,
  presentation: VerifiedPresentation,
  trace: TraceCollector,
  emit: Emit,
  aborted?: () => boolean,
): Promise<number> {
  // Everything already visible: this presentation's board AND featured cards,
  // plus every product boarded in earlier turns (the client's board is add-only,
  // so a cross-turn duplicate renders twice on screen).
  const shown = new Set<string>([
    ...presentation.board.flatMap((c) => c.items.map((i) => i.productId)),
    ...presentation.sections.flatMap((s) => s.cards.map((c) => c.productId)),
    ...session.boardedIds,
  ]);
  let total = presentation.board.reduce((n, c) => n + c.items.length, 0);
  if (total >= BOARD_TARGET) return 0;

  // Candidate pool: every product surfaced by any search this session, most
  // recently searched first, in each aisle's own result order, minus anything
  // already on screen.
  const pool: string[] = [];
  const inPool = new Set<string>();
  for (const ids of [...session.searchHits.values()].reverse()) {
    for (const id of ids) {
      const rid = resolveEvidenceId(session, id);
      if (shown.has(id) || shown.has(rid) || inPool.has(rid)) continue;
      inPool.add(rid);
      pool.push(id);
    }
  }
  if (pool.length === 0) return 0;

  // Verify enough to cover the gap with headroom for items that fail screens.
  const gap = BOARD_TARGET - total;
  const toVerify = pool
    .filter((id) => !session.evidence.has(resolveEvidenceId(session, id)))
    .slice(0, Math.min(BREADTH_VERIFY_POOL, gap * 2 + 6));
  if (toVerify.length > 0) {
    await verifyBoardItems(session, toVerify, trace, emit);
    if (aborted?.()) return 0;
  }

  const intent = ledgerToBaseIntent(session.ledger);
  const anchor = presentation.board[0]?.items[0] ?? null;
  const active = session.knownSubjects.find((x) => x.subjectId === session.activeSubjectId);
  const catchAllName = `More ideas${active && active.kind === "person" ? ` for ${active.name}` : ""}`;
  let catchAll: VerifiedBoardCategory | null =
    presentation.board.find((c) => c.name === catchAllName) ?? null;
  let added = 0;

  for (const id of pool) {
    if (total >= BOARD_TARGET) break;
    const entry = session.evidence.get(resolveEvidenceId(session, id));
    if (!entry) continue;
    if (shown.has(entry.product.id)) continue;

    // Prefer a category the item genuinely belongs to (with room); otherwise it
    // joins the honest catch-all rather than mislabel an existing rail.
    let target = presentation.board.find(
      (cat) =>
        cat !== catchAll &&
        cat.items.length < CATEGORY_CAP &&
        fitsCategory(session, entry.product, cat.name, cat.items.map((i) => i.productId)),
    );
    if (!target) {
      catchAll ??= addCatchAll(presentation, catchAllName);
      target = catchAll;
    }

    const delta = priceDelta(
      entry.product,
      anchor ? { priceMinor: anchor.priceMinor, currency: anchor.currency } : null,
    );
    const insight =
      delta.text != null && delta.sign !== 0
        ? `Another option from your searches — ${delta.text} than the top pick`
        : "Another option surfaced by your searches";
    const item = notarizeBoardItem(
      session,
      {
        productId: id,
        insight,
        tradeoff: "More to choose from — auto-added from your searches",
        isPick: false,
        trusted: true,
      },
      intent,
    );
    if (!item) continue;
    target.items.push(item);
    shown.add(item.productId);
    total += 1;
    added += 1;
  }
  return added;
}

/** Create the catch-all category, append it, and return it. */
function addCatchAll(
  presentation: VerifiedPresentation,
  name: string,
): VerifiedBoardCategory {
  const cat: VerifiedBoardCategory = { name, items: [] };
  presentation.board.push(cat);
  return cat;
}
