import "server-only";
import pLimit from "p-limit";
import { getProduct, searchCatalog } from "@/lib/catalog/client";
import type { TraceCollector } from "@/lib/catalog/trace";
import type { NormalizedProduct, SearchParams } from "@/lib/catalog/types";
import { formatMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import { phraseInText } from "@/lib/utils";
import { dedupeProducts, productIdentityKey } from "./dedup";
import { recipientGender, scopeFenceTerms } from "./ledger";
import { buildSnippets, resolveEvidenceId } from "./truth";
import type { AgentSession, ExpertEvent, SearchSpec } from "./types";

/**
 * Tool executors for the loop. Each returns an observation string for the
 * model and emits UI trace chips. Constraints the model must not forget
 * (budget cap, ships-to, availability) are injected into search args by code.
 */

export type Emit = (event: ExpertEvent) => void;

/** Below this, a query was too niche to give the shopper a real choice. */
const THIN_RESULTS = 9;
/** Gift/style are shopped by browsing many options, so their shelves run deeper. */
const THIN_RESULTS_BROWSE = 12;

/** Results per catalog call. The board wants deep category rails, so ask big. */
const SEARCH_LIMIT = 16;

/**
 * Garments/accessories whose fit, sizing and cut are gendered — a "shirt" for a
 * man and for a woman are different products. When we know who we're shopping
 * for, these queries get a gender prefix; genderless items (mugs, books, gadgets)
 * are left exactly as written.
 */
// Bare "top"/"tee" are deliberately excluded — they collide with "spinning top",
// "golf tee" and similar non-apparel gifts. T-shirts are covered by "t-shirts?".
const APPAREL_NOUN =
  /\b(shirt|t-?shirts?|blouse|dress(?:es)?|gown|kurtas?|kurti|saree|sari|lehenga|salwar|jeans|trousers?|pants?|chinos?|shorts?|skirts?|leggings|jackets?|blazers?|coats?|hoodies?|sweat(?:er|shirt)s?|jumper|cardigans?|suits?|shoes?|sneakers?|trainers?|boots?|sandals?|heels?|loafers?|watch(?:es)?|wallets?|belts?|sunglasses|perfume|fragrances?|cologne|deodorant|grooming|jewell?ery|necklaces?|bracelets?|earrings?|handbags?|purses?|backpacks?|scarf|scarves|gloves|socks|nightwear|pyjamas?|pajamas?|lingerie|innerwear)\b/i;
const GENDER_WORD =
  /\b(men'?s?|man|male|women'?s?|woman|female|unisex|boys?|girls?|ladies|gents?|kids?|\bhim\b|\bher\b)\b/i;

/** Prefix an apparel query with the recipient's gender, unless one is present. */
export function withGender(query: string, gender: "woman" | "man"): string {
  if (GENDER_WORD.test(query) || !APPAREL_NOUN.test(query)) return query;
  return `${gender === "woman" ? "women's" : "men's"} ${query.trim()}`;
}

const COLOUR_WORDS = new Set([
  "white","black","blue","navy","grey","gray","green","olive","brown","tan","beige","cream",
  "red","maroon","pink","purple","yellow","orange","khaki","charcoal","ivory","gold","silver",
]);

/** Modifiers that make a query hyper-specific; the tail after these rarely helps. */
const CUT_AT = /\b(with|for|featuring|that|which|having|in a|made of|suitable)\b/i;

/**
 * Progressively broader variants of a niche query. A precise phrase like
 * "white slim fit button-down shirt with black contrast buttons" finds two
 * results; "white slim fit shirt" and "white shirt" find the shortlist the
 * shopper actually wants to choose from.
 */
export function broadenQuery(query: string): string[] {
  const cleaned = query.split(CUT_AT)[0].trim().replace(/[,;]+$/, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const variants: string[] = [];
  if (words.length > 4) variants.push(words.slice(0, 4).join(" "));
  // Head noun (last word of the trimmed phrase) plus its colour, if any.
  const head = words[words.length - 1];
  const colour = words.find((w) => COLOUR_WORDS.has(w.toLowerCase()));
  if (head) {
    // Never emit a bare single word — the catalog errors on queries that broad.
    const core =
      colour && colour.toLowerCase() !== head.toLowerCase()
        ? `${colour} ${head}`
        : words.slice(-2).join(" ");
    if (core.split(/\s+/).filter(Boolean).length >= 2) variants.push(core);
  }
  return [...new Set(variants.map((v) => v.trim()).filter((v) => v && v.toLowerCase() !== query.toLowerCase()))];
}

/** A sensible market for a currency, so price filters are unambiguous. */
const CURRENCY_HOME: Record<string, string> = {
  INR: "IN", USD: "US", GBP: "GB", EUR: "DE", AUD: "AU",
  CAD: "CA", SGD: "SG", AED: "AE", JPY: "JP", NZD: "NZ",
};

/**
 * The buyer context must always carry the currency: a price cap sent without
 * one is interpreted in the catalog's own currency, so a ₹4,000 budget can come
 * back as $4,000 of headroom. When the shopper hasn't named a country we infer
 * the currency's home market for the query only — it never enters the ledger.
 */
function buyerContext(session: AgentSession) {
  const c = session.ledger.constraints;
  const country = c.country ?? CURRENCY_HOME[c.currency?.toUpperCase() ?? ""] ?? null;
  return country ? { country, currency: c.currency ?? undefined } : undefined;
}

export async function runSearches(
  session: AgentSession,
  specs: SearchSpec[],
  trace: TraceCollector,
  emit: Emit,
  maxConcurrent = 4,
): Promise<string> {
  const fences = scopeFenceTerms(session.ledger);
  const c = session.ledger.constraints;
  // Gendered fit matters for gift/style: "men's shirt" ≠ "women's shirt". When
  // we know who we're shopping for, apparel queries get the prefix (code, not the
  // model, so it's never forgotten); null for genderless lenses/unknown gender.
  const gender =
    session.lens === "gift" || session.lens === "style" ? recipientGender(session) : null;
  // Gift/style are browsed across many options, so widen their shelves harder.
  const thin =
    session.lens === "gift" || session.lens === "style" ? THIN_RESULTS_BROWSE : THIN_RESULTS;
  // Cap concurrency: firing 8 catalog calls at once gets the burst throttled
  // and searches come back "failed" for no good reason.
  const gate = pLimit(2);
  const results = await Promise.all(
    specs.slice(0, maxConcurrent).map((spec) => gate(async () => {
      // The shopper's budget is the ceiling: a model-supplied cap may tighten
      // it, never loosen it.
      const capMinor =
        c.budgetMaxMinor != null
          ? Math.min(spec.maxPriceMinor ?? Number.POSITIVE_INFINITY, c.budgetMaxMinor)
          : (spec.maxPriceMinor ?? null);
      // Models routinely echo truncated ids; the catalog requires a full gid,
      // so resolve against what this session has seen (like every other path).
      const like: SearchParams["like"] = spec.likeProductId
        ? { productId: resolveProductId(session, spec.likeProductId) }
        : spec.useUploadedImage && session.uploadedImage
          ? { imageDataUrl: session.uploadedImage.dataUrl }
          : null;

      /** One catalog call plus the filters every result set gets. */
      const runOne = async (rawQuery: string): Promise<NormalizedProduct[]> => {
        const query = gender ? withGender(rawQuery, gender) : rawQuery;
        const params: SearchParams = {
          query,
          limit: SEARCH_LIMIT,
          context: buyerContext(session),
          filters: {
            available: true,
            shipsTo: c.country ?? undefined,
            priceMinMinor: null,
            priceMaxMinor: Number.isFinite(capMinor as number) ? (capMinor as number) : null,
          },
        };
        if (like) params.like = like;
        // The catalog throttles bursts of calls within a turn. Back off and
        // retry rather than reporting a perfectly good query as "failed".
        let res;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            res = await searchCatalog(params, trace);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
              logger.warn("catalog search retry", {
                query,
                attempt: attempt + 1,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        if (res.source === "mock") session.sawMock = true;
        // Scope-fenced items never even reach the model's candidate list.
        const allowed = res.products.filter((p) => {
          const text = `${p.title} ${p.categories.map((x) => x.value).join(" ")}`.toLowerCase();
          return !fences.some((t) => phraseInText(text, t, { stemPlurals: true }));
        });
        // Prefer offers in the shopper's own currency: a foreign-currency price
        // can't be compared to their budget without inventing an FX rate, and
        // mixing currencies in one shortlist is confusing. Only applied when
        // enough same-currency options remain.
        const wanted = c.currency?.toUpperCase();
        const sameCurrency = wanted
          ? allowed.filter((p) => {
              const cur = (
                p.priceRange.currency ?? p.variants.find((v) => v.currency)?.currency ?? null
              )?.toUpperCase();
              return cur == null || cur === wanted;
            })
          : allowed;
        return sameCurrency.length >= 3 ? sameCurrency : allowed;
      };

      const normalized = spec.query.trim().toLowerCase();
      const repeated = session.ledger.searchQueries.includes(normalized);
      session.ledger.searchQueries.push(normalized);
      if (session.ledger.searchQueries.length > 40) session.ledger.searchQueries.shift();

      const collected = new Map<string, NormalizedProduct>();
      let firstError: string | null = null;
      try {
        const first = await runOne(spec.query);
        for (const p of first) collected.set(p.id, p);
        emit({
          type: "trace",
          kind: "search",
          label: spec.query,
          detail: `${first.length} results`,
          ok: true,
        });
      } catch (err) {
        firstError = err instanceof Error ? err.message : String(err);
        emit({ type: "trace", kind: "search", label: spec.query, detail: "failed", ok: false });
      }

      // A hyper-specific phrase finds two things; the shopper wants a shortlist.
      // Widen automatically rather than spending the agent's turn on it.
      if (collected.size < thin) {
        for (const variant of broadenQuery(spec.query)) {
          if (collected.size >= thin) break;
          try {
            const more = await runOne(variant);
            const before = collected.size;
            for (const p of more) collected.set(p.id, p);
            emit({
              type: "trace",
              kind: "search",
              label: variant,
              detail: `+${collected.size - before} more (broadened)`,
              ok: true,
            });
          } catch {
            // A broadened variant failing is not worth reporting — the original stands.
          }
        }
      }

      // Collapse relistings BEFORE anything downstream sees them: the catalog is
      // multi-merchant, so the same product comes back under several sellers.
      // Keep the cheapest instance so the shopper sees the best price, not five
      // copies of one pen. Candidates, the aisle memory and the budget-screen
      // record all key off this unique set.
      const products = dedupeProducts([...collected.values()]);
      // Remember which aisle these came from: a thin board category can be
      // topped up later with siblings from the same search, in result order.
      if (products.length > 0) {
        session.searchHits.set(normalized, products.map((p) => p.id));
        if (session.searchHits.size > 60) {
          const oldest = session.searchHits.keys().next().value;
          if (oldest != null) session.searchHits.delete(oldest);
        }
      }
      if (products.length === 0 && firstError) {
        logger.warn("expert search failed", { query: spec.query, error: firstError });
        return `SEARCH "${spec.query}" FAILED: ${firstError.slice(0, 160)}. Try a shorter, more general phrase (two or three words).`;
      }
      {
        const lines = products.map((p) => {
          // Record that the CATALOG applied this cap when returning the product —
          // the only basis on which a foreign-currency offer may be treated as
          // budget-screened later.
          if (capMinor != null && Number.isFinite(capMinor)) {
            const prev = session.budgetScreenedCap.get(p.id);
            if (prev == null || capMinor < prev) {
              session.budgetScreenedCap.set(p.id, capMinor as number);
            }
          }
          const price =
            p.priceRange.minMinor != null && p.priceRange.currency
              ? formatMinor(p.priceRange.minMinor, p.priceRange.currency)
              : "price unknown";
          const line = `${p.id} | ${p.title.slice(0, 80)} | ${price} | ${p.categories[0]?.value ?? "uncategorized"}`;
          session.candidates.set(p.id, line);
          return line;
        });
        const header = `SEARCH "${spec.query}" → ${products.length} result(s)${repeated ? " (note: you already ran this query)" : ""}:`;
        return [header, ...lines.map((l) => `  ${l}`)].join("\n");
      }
    })),
  );
  return results.join("\n");
}

/**
 * Search straight from what the vision model saw: for each garment, BOTH its
 * broad phrase (fills the shortlist) and its precise phrase (finds the exact
 * match). Run in code so the photo's attributes always reach the catalog —
 * the model tends to drift to one extreme or the other.
 */
export async function runVisionSearches(
  session: AgentSession,
  read: { garments: Array<{ type: string; color?: string | null; fit?: string | null; searchPhrase?: string | null; broadPhrase?: string | null }> },
  trace: TraceCollector,
  emit: Emit,
): Promise<string> {
  const specs: SearchSpec[] = [];
  for (const g of read.garments.slice(0, 4)) {
    const precise = g.searchPhrase ?? [g.color, g.fit, g.type].filter(Boolean).join(" ");
    let broad = (g.broadPhrase ?? [g.color, g.type].filter(Boolean).join(" ")).trim();
    // A one-word phrase ("shirt") is too broad for the catalog and errors out.
    if (broad.split(/\s+/).filter(Boolean).length < 2) {
      const fallback = [g.color, g.fit, g.type].filter(Boolean).join(" ").trim();
      broad = fallback.split(/\s+/).slice(0, 3).join(" ") || broad;
    }
    if (broad.split(/\s+/).filter(Boolean).length >= 2) specs.push({ query: broad });
    if (precise.trim() && precise.trim().toLowerCase() !== broad.trim().toLowerCase()) {
      specs.push({ query: precise.trim() });
    }
  }
  if (specs.length === 0) return "";
  const out = await runSearches(session, specs, trace, emit, 6);
  return `${out}\n\nSYSTEM: those searches came from the photo you looked at (broad + precise for each piece). Work from these candidates — you do NOT need to search again unless a piece is missing.`;
}

/**
 * Shopify's own similarity mechanism: `like: { productId }` with no text query.
 * Run in code the moment "Show Similar" is tapped — in EVERY lens — so the
 * shortlist never depends on the model writing a good query, and a failed
 * text search can't leave the shopper with nothing.
 */
export interface SimilarityResult {
  /** Model-facing observation text (also fine to log). */
  observation: string;
  /** The surviving similar products, catalog order. */
  products: NormalizedProduct[];
}

export async function runSimilaritySearch(
  session: AgentSession,
  productId: string,
  trace: TraceCollector,
  emit: Emit,
): Promise<SimilarityResult> {
  const c = session.ledger.constraints;
  try {
    const res = await searchCatalog(
      {
        like: { productId },
        limit: 16,
        context: buyerContext(session),
        filters: {
          available: true,
          shipsTo: c.country ?? undefined,
          priceMinMinor: null,
          priceMaxMinor: c.budgetMaxMinor ?? null,
        },
      },
      trace,
    );
    if (res.source === "mock") session.sawMock = true;
    const fences = scopeFenceTerms(session.ledger);
    // "Show similar" must return CLOSELY RELATED items, never the same product —
    // so exclude both the original id AND its relistings by other merchants
    // (same content identity), then collapse relistings among the results.
    const anchorProduct = session.evidence.get(resolveEvidenceId(session, productId))?.product;
    const anchorKey = anchorProduct ? productIdentityKey(anchorProduct) : null;
    const products = dedupeProducts(
      res.products.filter((p) => {
        if (p.id === productId) return false; // never re-offer the original
        if (anchorKey && productIdentityKey(p) === anchorKey) return false; // same item, other seller
        const text = `${p.title} ${p.categories.map((x) => x.value).join(" ")}`.toLowerCase();
        return !fences.some((t) => phraseInText(text, t, { stemPlurals: true }));
      }),
    );
    for (const p of products) {
      if (c.budgetMaxMinor != null) {
        const prev = session.budgetScreenedCap.get(p.id);
        if (prev == null || c.budgetMaxMinor < prev) {
          session.budgetScreenedCap.set(p.id, c.budgetMaxMinor);
        }
      }
    }
    emit({
      type: "trace",
      kind: "search",
      label: "Shopify similar products",
      detail: `${products.length} results`,
      ok: true,
    });
    const lines = products.map((p) => {
      const price =
        p.priceRange.minMinor != null && p.priceRange.currency
          ? formatMinor(p.priceRange.minMinor, p.priceRange.currency)
          : "price unknown";
      const line = `${p.id} | ${p.title.slice(0, 80)} | ${price} | ${p.categories[0]?.value ?? "uncategorized"}`;
      session.candidates.set(p.id, line);
      return line;
    });
    if (products.length > 0) {
      session.searchHits.set(`like:${productId}`, products.map((p) => p.id));
    }
    return {
      observation: [
        `SHOPIFY SIMILARITY (catalog's own "more like this" for ${productId}) → ${products.length} result(s):`,
        ...lines.map((l) => `  ${l}`),
      ].join("\n"),
      products,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("similarity search failed", { productId, error: message });
    emit({ type: "trace", kind: "search", label: "Shopify similar products", detail: "failed", ok: false });
    return {
      observation: `SHOPIFY SIMILARITY for ${productId} FAILED: ${message.slice(0, 140)}. Fall back to short, general text queries describing the item.`,
      products: [],
    };
  }
}

/**
 * Verify a batch of shortlisted (side-panel) products. Wider than the model's
 * own inspect batch and quiet in the trace: the board can hold 15-20 items.
 */
export async function verifyBoardItems(
  session: AgentSession,
  productIds: string[],
  trace: TraceCollector,
  emit: Emit,
): Promise<void> {
  const fresh = productIds.filter((id) => !session.evidence.has(id)).slice(0, 24);
  const silent: Emit = (event) => {
    if (event.type === "trace" && event.kind === "inspect") return; // don't flood the trace
    emit(event);
  };
  // Same burst discipline as searches: an ungated 24-call volley gets the
  // batch throttled and the board silently thins. Gate it, then give the
  // stragglers one quiet second-chance pass.
  const gate = pLimit(3);
  await Promise.all(fresh.map((id) => gate(() => runGetProduct(session, id, trace, silent))));
  const missed = fresh.filter((id) => !session.evidence.has(resolveProductId(session, id)));
  if (missed.length > 0) {
    await new Promise((r) => setTimeout(r, 800));
    await Promise.all(
      missed.slice(0, 8).map((id) => gate(() => runGetProduct(session, id, trace, silent))),
    );
  }
}

/** Inspect several candidates concurrently — one action, real choice for the shopper. */
export async function runGetProducts(
  session: AgentSession,
  productIds: string[],
  trace: TraceCollector,
  emit: Emit,
): Promise<string> {
  const fresh = productIds.filter((id) => !session.evidence.has(id)).slice(0, 6);
  const already = productIds.filter((id) => session.evidence.has(id));
  const results = await Promise.all(
    fresh.map((id) => runGetProduct(session, id, trace, emit)),
  );
  if (already.length > 0) {
    results.push(
      `SYSTEM: already verified (snippets are in VERIFIED EVIDENCE, don't re-fetch): ${already.join(", ")}`,
    );
  }
  return results.join("\n");
}

/**
 * Models routinely drop the "gid://shopify/p/" prefix when echoing an id back.
 * Resolve loosely against what this session has actually seen before giving up.
 */
export function resolveProductId(session: AgentSession, raw: string): string {
  const id = raw.trim();
  if (session.candidates.has(id) || session.evidence.has(id)) return id;
  const known = [...session.candidates.keys(), ...session.evidence.keys()];
  const suffix = known.find((k) => k.endsWith(`/${id}`) || k.endsWith(id));
  return suffix ?? id;
}

export async function runGetProduct(
  session: AgentSession,
  rawProductId: string,
  trace: TraceCollector,
  emit: Emit,
): Promise<string> {
  const productId = resolveProductId(session, rawProductId);
  try {
    const res = await getProduct({ productId, context: buyerContext(session) }, trace);
    if (res.source === "mock") session.sawMock = true;
    if (!res.product) {
      emit({ type: "trace", kind: "inspect", label: productId, detail: "not found", ok: false });
      return `GET_PRODUCT ${productId}: could not resolve this product. Do not present it.`;
    }
    const product = res.product;
    const snippets = buildSnippets(product);
    session.evidence.set(product.id, {
      product,
      source: res.source,
      fetchedAt: new Date().toISOString(),
      snippets,
    });
    emit({
      type: "trace",
      kind: "inspect",
      label: product.title.slice(0, 60),
      detail: "evidence verified",
      ok: true,
    });
    const price =
      product.priceRange.minMinor != null && product.priceRange.currency
        ? formatMinor(product.priceRange.minMinor, product.priceRange.currency)
        : "price unknown";
    const available = product.variants.some((v) => v.available === true)
      ? "in stock per catalog"
      : "availability unconfirmed";
    return [
      `EVIDENCE for ${product.id} — "${product.title}" | ${price} | ${available}`,
      `Quotable snippets (claims MUST quote one of these verbatim, citing its field):`,
      ...snippets.map((s) => `  [${s.field}] "${s.text}"`),
    ].join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("expert get_product failed", { productId, error: message });
    emit({ type: "trace", kind: "inspect", label: productId, detail: "failed", ok: false });
    return `GET_PRODUCT ${productId} FAILED: ${message.slice(0, 160)}. Its data is unverified — do not present it.`;
  }
}
