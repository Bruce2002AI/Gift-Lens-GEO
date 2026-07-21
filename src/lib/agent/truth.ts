import type { NormalizedProduct, NormalizedVariant } from "@/lib/catalog/types";
import { checkHardConstraints, logisticsMessage } from "@/lib/gift/constraints";
import { formatMinor } from "@/lib/gift/currency";
import { productIdentityKey } from "./dedup";
import { hasConsent, ledgerToBaseIntent, normalizeForMatch } from "./ledger";
import { interpretationViolations, isSupplementCategory, lintOutbound } from "./safety";
import type {
  AgentSession,
  Presentation,
  ProductFacts,
  ProductFactsVariant,
  VerifiedBoardCategory,
  VerifiedBoardItem,
  VerifiedCard,
  VerifiedClaim,
  VerifiedComposition,
  VerifiedPresentation,
  VerifiedSection,
} from "./types";

/**
 * Project the complete catalog record onto the wire shape the UI expands.
 *
 * A pure projection of `NormalizedProduct` — no model text passes through here,
 * so nothing needs lint/verification: these are the catalog's own facts, which
 * is precisely why they can be shown verbatim next to the verified claims.
 */
export function buildProductFacts(
  product: NormalizedProduct,
  selectedVariantId: string | null,
): ProductFacts {
  const variants: ProductFactsVariant[] = product.variants.map((v) => ({
    id: v.id,
    title: v.title,
    sku: v.sku,
    priceMinor: v.priceMinor,
    currency: v.currency,
    available: v.available,
    availabilityStatus: v.availabilityStatus,
    runningLow: v.runningLow,
    requiresShipping: v.requiresShipping,
    nativeCheckoutEligible: v.nativeCheckoutEligible,
    url: v.url,
    imageUrl: v.imageUrl,
    options: v.options,
    condition: v.condition,
    rating: v.rating,
    description: v.description,
    isSelected: selectedVariantId != null && v.id === selectedVariantId,
  }));

  return {
    description: product.description,
    handle: product.handle,
    categories: product.categories.map((c) => c.value),
    rating: product.rating,
    specs: product.metadata.specs,
    topFeatures: product.metadata.topFeatures,
    uniqueSellingPoints: product.metadata.uniqueSellingPoints,
    images: product.images,
    options: product.options,
    variants,
    seller: product.seller,
    priceRange: product.priceRange,
    inStockVariants: variants.filter((v) => v.available === true).length,
    totalVariants: variants.length,
  };
}

/**
 * The truth layer (docs/AI-EXPERIENCE-REDESIGN.md §7): every pixel crosses this
 * boundary. The model composes; this notarizes. Claims must quote verbatim
 * substrings of real catalog fields AND the sentence shown to the user must be
 * entailed by that evidence; unverifiable content is dropped and counted, never
 * replaced with filler.
 */

// ---------------------------------------------------------------------------
// Evidence fields + quote-picker snippets
// ---------------------------------------------------------------------------

/** The catalog fields a claim may cite, resolved to their full text. */
export function evidenceFieldText(product: NormalizedProduct, field: string): string | null {
  switch (field) {
    case "title":
      return product.title;
    case "description":
      return product.description;
    case "categories":
      return product.categories.map((c) => c.value).join(" | ");
    case "techSpecs":
      return product.metadata.techSpecs.join(" | ");
    case "topFeatures":
      return product.metadata.topFeatures.join(" | ");
    case "uniqueSellingPoints":
      return product.metadata.uniqueSellingPoints.join(" | ");
    case "options":
      return product.options
        .map((o) => `${o.name}: ${o.values.map((v) => v.label).join(", ")}`)
        .join(" | ");
    case "rating":
      return product.rating.value != null
        ? `rated ${product.rating.value}${product.rating.scaleMax ? `/${product.rating.scaleMax}` : ""}${product.rating.count ? ` by ${product.rating.count} reviewers` : ""}`
        : null;
    case "price": {
      // Code-constructed from real catalog data so price claims have a legitimate quote source.
      const { minMinor, maxMinor, currency } = product.priceRange;
      if (minMinor == null || !currency) return null;
      const min = formatMinor(minMinor, currency);
      return maxMinor != null && maxMinor !== minMinor
        ? `priced ${min} to ${formatMinor(maxMinor, currency)}`
        : `priced at ${min}`;
    }
    default:
      return null;
  }
}

export const EVIDENCE_FIELDS = [
  "title",
  "description",
  "categories",
  "techSpecs",
  "topFeatures",
  "uniqueSellingPoints",
  "options",
  "rating",
  "price",
] as const;

/** Quote-picker snippets returned with get_product so the model can cite verbatim. */
export function buildSnippets(product: NormalizedProduct): Array<{ field: string; text: string }> {
  const snippets: Array<{ field: string; text: string }> = [];
  for (const field of EVIDENCE_FIELDS) {
    const text = evidenceFieldText(product, field);
    if (!text) continue;
    if (field === "description") {
      // Sentence-level snippets from long descriptions.
      for (const sentence of text.split(/(?<=[.!?])\s+/).slice(0, 12)) {
        const s = sentence.trim();
        if (s.length > 15) snippets.push({ field, text: s.slice(0, 240) });
      }
    } else {
      snippets.push({ field, text: text.slice(0, 300) });
    }
  }
  return snippets.slice(0, 18);
}

// ---------------------------------------------------------------------------
// Claim verification: quote must be verbatim AND the shown sentence must be
// entailed by the evidence field (a tiny quote can't notarize a big claim).
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","been","but","by","can","for","from","had","has","have","he",
  "her","his","in","is","it","its","of","on","or","she","so","that","the","their","them","then",
  "there","these","they","this","to","up","was","were","what","when","which","who","will","with",
  "you","your","yours","i","we","our","us","not","no","if","into","also","just","very","more","most",
  "than","them","here","how","why","all","any","each","other","some","such","only","own","same",
  "too","s","t","don","now","per","one","two","three","comes","come","made","make","makes","get",
  "gets","use","uses","using","it's","that's","doesn't","don't",
]);

/** Content words used for entailment: no stopwords, no pure punctuation. */
function contentTokens(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^\p{L}\p{N}%.\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Singular/plural-tolerant membership so "burrs" matches "burr". */
function tokenCovered(token: string, haystack: Set<string>): boolean {
  if (haystack.has(token)) return true;
  const singular = token.replace(/(?:es|s)$/, "");
  if (singular.length > 2 && haystack.has(singular)) return true;
  for (const h of haystack) {
    if (h.length > 3 && (h.startsWith(token) || token.startsWith(h))) return true;
  }
  return false;
}

const MIN_QUOTE_CHARS = 12;

/**
 * Tokens that carry a checkable product FACT. These must be fully covered by
 * the evidence — they're what an invented claim smuggles in ("waterproof",
 * "lifetime warranty", "50m", "organic"). Ordinary descriptive words get a
 * coverage ratio instead, so honest restatements survive.
 */
const HARD_FACT_LEXEMES =
  /^(waterproof|water-?resistant|shockproof|scratch-?proof|hypoallergenic|organic|certified|sterile|vegan|cruelty-?free|fragrance-?free|non-?comedogenic|dermatologist|clinically|warranty|warranties|guaranteed|handmade|hand-?crafted|titanium|sterling|merino|cashmere|silk|leather|suede|linen|bamboo|ceramic|stainless|copper|brass|platinum|diamond|gold|silver|wool|cotton|spf|paraben|sulfate|gluten|dishwasher|microwave|rechargeable|bluetooth|waterproofing)$/i;

function isHardFact(token: string): boolean {
  return /\d/.test(token) || HARD_FACT_LEXEMES.test(token);
}

/** Ordinary wording may drift; this much of it still has to be in the listing. */
const MIN_COVERAGE = 0.6;

export interface ClaimVerification {
  ok: boolean;
  reason: string | null;
}

/**
 * A claim is notarized only when (a) its quote is a non-trivial verbatim
 * substring of the named field and (b) every content word of the sentence the
 * USER SEES is present in that field's text. Without (b) the model could quote
 * "headphones" and assert "waterproof to 50m with a lifetime warranty".
 */
export function verifyClaimDetailed(
  product: NormalizedProduct,
  field: string,
  quote: string,
  claimText: string,
): ClaimVerification {
  const fieldText = evidenceFieldText(product, field);
  if (!fieldText) return { ok: false, reason: `no evidence field "${field}"` };
  const normalizedField = normalizeForMatch(fieldText);
  const q = normalizeForMatch(quote);
  if (q.length < 3) return { ok: false, reason: "quote too short" };
  if (!normalizedField.includes(q)) return { ok: false, reason: "quote is not verbatim in that field" };
  // A trivially short quote cannot carry a substantive sentence.
  const quoteTokens = contentTokens(quote);
  if (q.length < MIN_QUOTE_CHARS && quoteTokens.length < 2) {
    return { ok: false, reason: "quote too small to support the claim" };
  }
  // Entailment: what the shopper is told must be supported by the evidence.
  // Hard facts (numbers, materials, certifications, warranties) must be fully
  // covered; ordinary phrasing only has to be mostly covered, so a faithful
  // restatement survives while an invented attribute does not.
  const haystack = new Set(contentTokens(fieldText));
  const claimTokens = contentTokens(claimText);
  if (claimTokens.length === 0) return { ok: true, reason: null };
  const uncovered = claimTokens.filter((t) => !tokenCovered(t, haystack));
  const uncoveredFacts = uncovered.filter(isHardFact);
  if (uncoveredFacts.length > 0) {
    return {
      ok: false,
      reason: `claim asserts "${uncoveredFacts.slice(0, 3).join(", ")}" which the listing does not state`,
    };
  }
  const coverage = (claimTokens.length - uncovered.length) / claimTokens.length;
  if (coverage < MIN_COVERAGE) {
    return {
      ok: false,
      reason: `claim goes well beyond the listing (${Math.round(coverage * 100)}% of it is supported)`,
    };
  }
  return { ok: true, reason: null };
}

/** Back-compat helper: quote-only verification (used by tests and callers). */
export function verifyClaim(product: NormalizedProduct, field: string, quote: string): boolean {
  return verifyClaimDetailed(product, field, quote, quote).ok;
}

// ---------------------------------------------------------------------------
// Offer selection — price, currency, merchant and link must describe ONE offer
// ---------------------------------------------------------------------------

export function selectOffer(product: NormalizedProduct): {
  variant: NormalizedVariant | null;
  priceMinor: number | null;
  currency: string | null;
} {
  const priced = product.variants.filter((v) => v.priceMinor != null && v.currency);
  const pool = priced.filter((v) => v.available === true);
  const candidates = pool.length > 0 ? pool : priced;
  const best = candidates.reduce<NormalizedVariant | null>(
    (min, v) => (min === null || (v.priceMinor ?? 0) < (min.priceMinor ?? 0) ? v : min),
    null,
  );
  if (best) {
    return { variant: best, priceMinor: best.priceMinor, currency: best.currency };
  }
  // No priced variant — fall back to the product-level range, which is self-consistent.
  return {
    variant: product.variants.find((v) => v.available === true) ?? product.variants[0] ?? null,
    priceMinor: product.priceRange.minMinor,
    currency: product.priceRange.currency,
  };
}

/**
 * The lowest price we'll show against a stated budget. Catalog data carries
 * rounding-error listings — a ₹1 "wholesale button", a ₹15 "moisturiser Mrp 15"
 * — that are almost always mis-scraped, not bargains.
 *
 * The screen is 2% of the budget, but CAPPED: this guard exists to catch
 * absurd data, not to impose a minimum price. Uncapped, a ₹50,000 budget
 * produced a ₹1,000 floor and silently discarded perfectly real ₹900 gifts —
 * and even a ₹5,000 budget threw away a legitimate ₹99 clay-tool set. Ten
 * currency units is comfortably above mis-scraped listings (which cluster at
 * 0-5) and safely below anything genuinely purchasable, including the cheap
 * pantry staples the nutrition lens needs.
 */
const JUNK_FLOOR_CAP_MINOR = 1000;

export function junkPriceFloorMinor(budgetMaxMinor: number | null): number {
  if (budgetMaxMinor == null) return 100;
  const proportional = Math.max(100, Math.round(budgetMaxMinor * 0.02));
  return Math.min(proportional, JUNK_FLOOR_CAP_MINOR);
}

// ---------------------------------------------------------------------------
// Board-item notarization — shared by the presentation notarizer, the instant
// similarity rail, and the code-side category top-up. One admission standard:
// verified evidence, constraint pass, opt-in gate, sane price, one currency.
// ---------------------------------------------------------------------------

export interface BoardItemInput {
  productId: string;
  insight: string;
  tradeoff?: string | null;
  isPick?: boolean;
  /**
   * Code-authored insight/tradeoff (computed from verified offers, e.g. a price
   * delta). Skips the interpretation-stratum fact lint — which exists to keep
   * MODEL-invented product facts out — but still passes the outbound safety lint.
   */
  trusted?: boolean;
}

/** Resolve a possibly-truncated product id against this session's evidence. */
export function resolveEvidenceId(session: AgentSession, rawId: string): string {
  if (session.evidence.has(rawId)) return rawId;
  return (
    [...session.evidence.keys()].find((k) => k.endsWith(`/${rawId}`) || k.endsWith(rawId)) ?? rawId
  );
}

/**
 * Admit one product to the board, or refuse. `intent` is passed in so batch
 * callers derive it once; junk-price floor scales with the shopper's budget so
 * a ₹1 "trousers" listing (wholesale part, bad data) never fills a slot.
 */
export function notarizeBoardItem(
  session: AgentSession,
  input: BoardItemInput,
  intent: ReturnType<typeof ledgerToBaseIntent>,
): VerifiedBoardItem | null {
  const resolvedId = resolveEvidenceId(session, input.productId);
  const entry = session.evidence.get(resolvedId);
  if (!entry) return null;
  // The agent sometimes admits a padded slot in its own words — that item
  // does not belong on a shortlist.
  const admission = `${input.insight} ${input.tradeoff ?? ""}`;
  if (/\b(not (a|an) |placeholder|novelty|unrelated|isn'?t (a|an) )/i.test(admission)) return null;
  const product = entry.product;
  const screenedCap = session.budgetScreenedCap.get(product.id);
  const passes = checkHardConstraints(product, intent, {
    catalogBudgetFilterApplied:
      screenedCap != null &&
      session.ledger.constraints.budgetMaxMinor != null &&
      screenedCap <= session.ledger.constraints.budgetMaxMinor,
  }).pass;
  if (!passes) return null;
  const itemText = [
    product.title,
    product.description,
    product.categories.map((c) => c.value).join(" "),
  ].join(" ");
  if (isSupplementCategory(itemText) && !hasConsent(session.ledger, "supplements")) return null;
  const insight = lintOutbound(input.insight).text;
  if (!insight || (!input.trusted && interpretationViolations(insight))) return null;
  // The tradeoff is interpretation text too: model-authored spec assertions
  // ("only 250ml", "genuine leather trim") are dropped, never rendered — the
  // item survives, the unverifiable line does not.
  let tradeoff = input.tradeoff ? lintOutbound(input.tradeoff).text || null : null;
  if (tradeoff && !input.trusted && interpretationViolations(tradeoff)) tradeoff = null;
  const offer = selectOffer(product);
  // A shortlist has to be priceable: we can't show an item next to a budget
  // when its currency is unknown or differs.
  if (
    offer.priceMinor == null ||
    offer.priceMinor < junkPriceFloorMinor(session.ledger.constraints.budgetMaxMinor)
  ) {
    return null;
  }
  const wantedCurrency = session.ledger.constraints.currency?.toUpperCase() ?? null;
  if (wantedCurrency && (offer.currency ?? "").toUpperCase() !== wantedCurrency) return null;
  return {
    productId: product.id,
    title: product.title,
    imageUrl: product.images[0]?.url ?? null,
    priceMinor: offer.priceMinor,
    currency: offer.currency,
    merchant: offer.variant?.seller?.name ?? null,
    productUrl: offer.variant?.url ?? product.url ?? null,
    insight,
    tradeoff,
    isPick: input.isPick ?? false,
    source: entry.source,
    facts: buildProductFacts(product, offer.variant?.id ?? null),
  };
}

// ---------------------------------------------------------------------------
// The notarizer
// ---------------------------------------------------------------------------

export interface VerifyOutcome {
  presentation: VerifiedPresentation;
  /** Honest gaps the loop should surface in voice. */
  notes: string[];
}

export function verifyPresentation(
  session: AgentSession,
  raw: Presentation,
): VerifyOutcome {
  const intent = ledgerToBaseIntent(session.ledger);
  const notes: string[] = [];
  let droppedCards = 0;

  const sections: VerifiedSection[] = raw.sections.map((section) => {
    const cards: VerifiedCard[] = [];
    for (const spec of section.cards ?? []) {
      const entry = session.evidence.get(spec.productId);
      if (!entry) {
        droppedCards += 1;
        notes.push(
          "A pick was dropped: no verified product evidence for it (the agent must inspect a product before presenting it).",
        );
        continue;
      }
      const product = entry.product;
      // Budget screening may only be assumed for products the CATALOG returned
      // under a price cap — not for anything fetched by id afterwards.
      const screenedCap = session.budgetScreenedCap.get(product.id);
      const constraintOpts = {
        catalogBudgetFilterApplied:
          screenedCap != null &&
          session.ledger.constraints.budgetMaxMinor != null &&
          screenedCap <= session.ledger.constraints.budgetMaxMinor,
      };
      const check = checkHardConstraints(product, intent, constraintOpts);
      if (!check.pass) {
        droppedCards += 1;
        notes.push(`"${product.title}" was dropped: ${check.violations.join(" ")}`);
        continue;
      }
      // Same junk-price screen as the board: a ₹15 "moisturiser" against a
      // ₹1,000 budget is mis-scraped data, not a featured pick.
      const cardOffer = selectOffer(product);
      if (
        cardOffer.priceMinor != null &&
        cardOffer.priceMinor < junkPriceFloorMinor(session.ledger.constraints.budgetMaxMinor)
      ) {
        droppedCards += 1;
        notes.push(`"${product.title}" was dropped: its listed price looks like bad catalog data.`);
        continue;
      }
      // Consent gate: opt-in categories render only against recorded consent.
      const cardText = [
        product.title,
        product.description,
        product.categories.map((c) => c.value).join(" "),
        ...spec.claims.flatMap((c) => [c.text, c.quote]),
      ].join(" ");
      if (isSupplementCategory(cardText) && !hasConsent(session.ledger, "supplements")) {
        droppedCards += 1;
        notes.push(
          `"${product.title}" was held back: supplements are strictly opt-in and the shopper hasn't opted in.`,
        );
        continue;
      }

      // Claims stratum: verbatim quote + entailment of the shown sentence.
      const claims: VerifiedClaim[] = [];
      let droppedClaims = 0;
      for (const claim of spec.claims) {
        const lint = lintOutbound(claim.text);
        if (!lint.text) {
          droppedClaims += 1;
          continue;
        }
        const verdict = verifyClaimDetailed(product, claim.field, claim.quote, lint.text);
        if (verdict.ok) {
          claims.push({ text: lint.text, field: claim.field, quote: claim.quote });
        } else {
          droppedClaims += 1;
        }
      }

      // Interpretation stratum: personal reasoning only — product-attribute
      // assertions must live in claims, so they're nudged out here.
      const whyForYou = spec.whyForYou
        .map((s) => lintOutbound(s).text)
        .filter((s) => s.length > 0 && !interpretationViolations(s));

      const offer = selectOffer(product);
      cards.push({
        productId: product.id,
        role: spec.role ? lintOutbound(spec.role).text.slice(0, 40) || null : null,
        title: product.title,
        imageUrl: product.images[0]?.url ?? null,
        priceMinor: offer.priceMinor,
        currency: offer.currency,
        productUrl: offer.variant?.url ?? product.url ?? null,
        merchant: offer.variant?.seller?.name ?? null,
        variantId: offer.variant?.id ?? null,
        claims,
        whyForYou,
        tradeoff: spec.tradeoff ? lintOutbound(spec.tradeoff).text || null : null,
        runnerUp: spec.runnerUp ? lintOutbound(spec.runnerUp).text || null : null,
        droppedClaims,
        logistics: logisticsMessage(product, intent),
        source: entry.source,
        asOf: entry.fetchedAt,
        facts: buildProductFacts(product, offer.variant?.id ?? null),
      });
    }

    return {
      title: section.title ? lintOutbound(section.title).text || null : null,
      intro: section.intro ? lintOutbound(section.intro).text || null : null,
      steps: (section.steps ?? [])
        .map((s) => ({
          text: lintOutbound(s.text).text,
          why: s.why ? lintOutbound(s.why).text || null : null,
        }))
        .filter((s) => s.text.length > 0),
      cards,
    };
  });

  // Total: plan layouts only, and only when every priced card shares a currency.
  // The total is reported in the CARDS' currency — never the ledger's.
  let totalMinor: number | null = null;
  let totalCurrency: string | null = null;
  if (raw.layout === "plan") {
    const priced = sections
      .flatMap((s) => s.cards)
      .filter((c) => c.priceMinor != null && c.currency);
    const currencies = new Set(priced.map((c) => c.currency!.toUpperCase()));
    if (priced.length > 0 && currencies.size === 1) {
      totalMinor = priced.reduce((sum, c) => sum + (c.priceMinor ?? 0), 0);
      totalCurrency = [...currencies][0];
    }
  }

  // Board: every option, grouped by category. Same evidence rule as the cards —
  // an item without a verified get_product fetch has no render path — but the
  // board carries the agent's reasoning rather than quoted claims.
  const board: VerifiedBoardCategory[] = [];
  const boardSeen = new Set<string>();
  // Content identities already shown — seeded with earlier turns' board so a
  // multi-merchant relisting can't reappear as a "new" option across turns.
  const boardSeenIdentity = new Set<string>(session.boardedIdentities);
  let boardUnverified = 0;
  for (const category of raw.board ?? []) {
    const items: VerifiedBoardItem[] = [];
    for (const [index, item] of category.items.entries()) {
      const resolvedId = resolveEvidenceId(session, item.productId);
      if (boardSeen.has(resolvedId)) continue; // no duplicate slots
      const entry = session.evidence.get(resolvedId);
      // An item whose evidence fetch failed vanishes with an accounting note —
      // never silently (the shortlist the message describes must be the one shown).
      if (!entry) {
        boardUnverified += 1;
        continue;
      }
      // The catalog is multi-merchant: skip a relisting of something already on
      // the board this turn or on an earlier one (same content identity).
      const identity = productIdentityKey(entry.product);
      if (boardSeenIdentity.has(identity)) continue;
      const verified = notarizeBoardItem(
        session,
        { productId: item.productId, insight: item.insight, tradeoff: item.tradeoff, isPick: index < 2 },
        intent,
      );
      if (!verified) continue;
      boardSeen.add(verified.productId);
      boardSeenIdentity.add(identity);
      items.push(verified);
    }
    if (items.length > 0) {
      // A lint-emptied name must NOT fall back to the raw model text — that
      // would ship the very sentence the lint dropped as a section header.
      board.push({ name: lintOutbound(category.name).text || "More options", items });
    }
  }
  if (boardUnverified > 0) {
    notes.push(
      `${boardUnverified} shortlisted item${boardUnverified === 1 ? "" : "s"} couldn't be verified in time and ${boardUnverified === 1 ? "was" : "were"} left off the board.`,
    );
  }

  // Compositions may only reference products that survived onto the board/cards.
  const shown = new Set([
    ...board.flatMap((c) => c.items.map((i) => i.productId)),
    ...sections.flatMap((s) => s.cards.map((c) => c.productId)),
  ]);
  const compositions: VerifiedComposition[] = (raw.compositions ?? [])
    .map((c) => ({
      name: lintOutbound(c.name).text || "Suggested set",
      rationale: lintOutbound(c.rationale).text,
      productIds: c.productIds.filter((id) => shown.has(id)),
    }))
    // A "way to put it together" needs at least two pieces — a set of one is
    // just a pick, and rendering it as "1 option" is exactly the emptiness the
    // shopper called out. Let the board carry the single ideas instead.
    .filter((c) => c.productIds.length >= 2 && c.rationale.length > 0);

  const followUpText = raw.followUp ? lintOutbound(raw.followUp.text).text : "";
  const fork = raw.followUp?.fork
    ? {
        ifA: lintOutbound(raw.followUp.fork.ifA).text,
        thenA: lintOutbound(raw.followUp.fork.thenA).text,
        ifB: lintOutbound(raw.followUp.fork.ifB).text,
        thenB: lintOutbound(raw.followUp.fork.thenB).text,
      }
    : null;

  const message = lintOutbound(raw.message).text;
  return {
    presentation: {
      message,
      layout: raw.layout,
      assumptions: (raw.assumptions ?? []).map((a) => lintOutbound(a).text).filter(Boolean),
      sections,
      leftOut: (raw.leftOut ?? [])
        .map((l) => ({ item: lintOutbound(l.item).text, reason: lintOutbound(l.reason).text }))
        .filter((l) => l.item.length > 0),
      totalMinor,
      totalCurrency,
      currency: session.ledger.constraints.currency,
      droppedCards,
      board,
      compositions,
      followUp: followUpText
        ? {
            text: followUpText,
            fork: fork && fork.thenA && fork.thenB ? fork : null,
            quickReplies: (raw.followUp?.quickReplies ?? [])
              .map((q) => lintOutbound(q).text)
              .filter(Boolean)
              .slice(0, 4),
          }
        : null,
    },
    notes,
  };
}
