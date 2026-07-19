import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { CACHE_TTL, TtlCache, cacheKey } from "./cache";
import { CatalogError, normalizeCatalogError } from "./errors";
import { callCatalogTool } from "./json-rpc";
import { getProductMock, lookupMock, searchMock } from "./mock-client";
import { selectVariantWithRelaxation } from "./variant-select";
import {
  extractNotFound,
  normalizeCatalogProduct,
  normalizeMessages,
} from "./normalize";
import type { TraceCollector } from "./trace";
import type {
  GetProductParams,
  GetProductResult,
  LookupResult,
  SearchParams,
  SearchResult,
  BuyerContext,
} from "./types";

/**
 * The single centralized Catalog adapter. All Shopify Catalog access flows
 * through searchCatalog / lookupCatalog / getProduct — no raw fetches
 * anywhere else in the app.
 *
 * Modes:
 *  - live: always live; failures propagate (never silently mocked).
 *  - mock: always fixtures; UI shows a persistent demo banner.
 *  - auto: live first; falls back to mock ONLY when ALLOW_MOCK_FALLBACK=true,
 *    and the result is labeled source="mock" so the UI can show the banner.
 */

const searchCache = new TtlCache<SearchResult>(200);
const lookupCache = new TtlCache<LookupResult>(200);
const productCache = new TtlCache<GetProductResult>(200);

function hashImage(dataUrl: string): string {
  return createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
}

function buildContext(context: BuyerContext | null | undefined) {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  if (context.country) out.address_country = context.country;
  if (context.region) out.address_region = context.region;
  if (context.postalCode) out.postal_code = context.postalCode;
  if (context.currency) out.currency = context.currency;
  if (context.language) out.language = context.language;
  if (context.intent) out.intent = context.intent;
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildSearchArgs(params: SearchParams): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (params.query) args.query = params.query;

  // Official like-item schema (verified against the endpoint's tools/list):
  // a product reference is { id }, an inline image is { image: { content_type,
  // data } } with RAW base64 — never bare strings or data URLs.
  if (params.like?.productId || params.like?.imageDataUrl) {
    const like: unknown[] = [];
    if (params.like.productId) like.push({ id: params.like.productId });
    if (params.like.imageDataUrl) {
      const m = params.like.imageDataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
      if (m) like.push({ image: { content_type: m[1], data: m[2] } });
    }
    if (like.length > 0) args.like = like;
  }

  const context = buildContext(params.context);
  if (context) args.context = context;

  const f = params.filters;
  const filters: Record<string, unknown> = {};
  if (f) {
    if (typeof f.available === "boolean") filters.available = f.available;
    if (f.shipsTo) filters.ships_to = { country: f.shipsTo };
    const price: Record<string, number> = {};
    if (f.priceMinMinor != null) price.min = f.priceMinMinor;
    if (f.priceMaxMinor != null) price.max = f.priceMaxMinor;
    if (Object.keys(price).length > 0) filters.price = price;
    if (f.category) filters.categories = [f.category];
  }
  if (Object.keys(filters).length > 0) args.filters = filters;

  args.pagination = { limit: Math.min(Math.max(params.limit ?? 20, 1), 50) };
  return args;
}

type SourceDecision = "live" | "mock";

function initialSource(): SourceDecision {
  return env.catalogMode === "mock" ? "mock" : "live";
}

/**
 * "mock:" is GiftLens's own fixture namespace — those identifiers can never
 * resolve on the live catalog, so requests referencing them route straight to
 * the mock client (still labeled source="mock" end to end).
 */
function isMockId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("mock:");
}

function shouldFallbackToMock(): boolean {
  return env.catalogMode === "auto" && env.allowMockFallback;
}

async function withMode<T extends { source: "live" | "mock" }>(
  liveFn: () => Promise<T>,
  mockFn: () => Promise<T>,
  label: string,
  trace?: TraceCollector,
): Promise<T> {
  if (initialSource() === "mock") return mockFn();
  try {
    return await liveFn();
  } catch (err) {
    const catErr = normalizeCatalogError(err);
    if (shouldFallbackToMock()) {
      logger.warn(`catalog ${label}: live failed, falling back to mock`, {
        code: catErr.code,
      });
      trace?.add({
        tool: "pipeline",
        label: `${label}: live catalog failed (${catErr.code}) — using labeled mock fallback`,
        durationMs: 0,
        source: "mock",
        ok: true,
      });
      return mockFn();
    }
    throw catErr;
  }
}

export async function searchCatalog(
  params: SearchParams,
  trace?: TraceCollector,
  opts?: { forceSource?: "mock" },
): Promise<SearchResult> {
  const key = cacheKey({
    tool: "search",
    mode: env.catalogMode,
    forced: opts?.forceSource ?? null,
    query: params.query ?? null,
    likeProduct: params.like?.productId ?? null,
    likeImage: params.like?.imageDataUrl
      ? hashImage(params.like.imageDataUrl)
      : null,
    context: params.context ?? null,
    filters: params.filters ?? null,
    limit: params.limit ?? 20,
  });
  const cachedResult = searchCache.get(key);
  if (cachedResult) {
    trace?.add({
      tool: "search_catalog",
      label: params.query ?? "similarity search",
      durationMs: 0,
      resultCount: cachedResult.products.length,
      cacheHit: true,
      source: cachedResult.source,
      ok: true,
    });
    return cachedResult;
  }

  const detail = [
    params.filters?.shipsTo ? `ships_to=${params.filters.shipsTo}` : null,
    params.filters?.priceMaxMinor != null
      ? `max=${params.filters.priceMaxMinor}`
      : null,
    params.like?.productId ? "like=product" : null,
    params.like?.imageDataUrl ? "like=image" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const run = (source: SourceDecision) => async (): Promise<SearchResult> => {
    const fn =
      source === "live"
        ? async (): Promise<SearchResult> => {
            const structured = await callCatalogTool(
              "search_catalog",
              buildSearchArgs(params),
              { timeoutMs: 15_000 },
            );
            const messages = normalizeMessages(structured.messages);
            return {
              products: (structured.products ?? []).map(normalizeCatalogProduct),
              source: "live",
              messages,
            };
          }
        : () => searchMock(params);
    if (!trace) return fn();
    return trace.time(
      {
        tool: "search_catalog",
        label: params.query ?? "similarity search",
        detail,
        source,
      },
      fn,
      (r) => r.products.length,
    );
  };

  const result =
    opts?.forceSource === "mock" || isMockId(params.like?.productId)
      ? await run("mock")()
      : await withMode(run("live"), run("mock"), "search", trace);
  searchCache.set(key, result, CACHE_TTL.search);
  return result;
}

export async function lookupCatalog(
  ids: string[],
  context?: BuyerContext | null,
  trace?: TraceCollector,
): Promise<LookupResult> {
  if (ids.length === 0) {
    return { products: [], notFound: [], source: initialSource(), messages: [] };
  }
  // Mixed batches: fixture ids resolve via the mock client, the rest live.
  const mockIds = ids.filter((id) => isMockId(id));
  const liveIds = ids.filter((id) => !isMockId(id));
  if (mockIds.length > 0 && liveIds.length > 0) {
    const [mockPart, livePart] = await Promise.all([
      lookupCatalog(mockIds, context, trace),
      lookupCatalog(liveIds, context, trace),
    ]);
    return {
      products: [...mockPart.products, ...livePart.products],
      notFound: [...mockPart.notFound, ...livePart.notFound],
      source: mockPart.products.length > 0 ? "mock" : livePart.source,
      messages: [...mockPart.messages, ...livePart.messages],
    };
  }
  const forceMock = mockIds.length > 0;
  // Global Catalog documents a 50-identifier limit per request.
  const batch = ids.slice(0, 50);
  const key = cacheKey({
    tool: "lookup",
    mode: env.catalogMode,
    ids: batch,
    context: context ?? null,
  });
  const cachedResult = lookupCache.get(key);
  if (cachedResult) {
    trace?.add({
      tool: "lookup_catalog",
      label: `${batch.length} identifier${batch.length === 1 ? "" : "s"}`,
      durationMs: 0,
      resultCount: cachedResult.products.length,
      cacheHit: true,
      source: cachedResult.source,
      ok: true,
    });
    return cachedResult;
  }

  const run = (source: SourceDecision) => async (): Promise<LookupResult> => {
    const fn =
      source === "live"
        ? async (): Promise<LookupResult> => {
            const args: Record<string, unknown> = { ids: batch };
            const ctx = buildContext(context);
            if (ctx) args.context = ctx;
            const structured = await callCatalogTool("lookup_catalog", args, {
              timeoutMs: 12_000,
            });
            const messages = normalizeMessages(structured.messages);
            return {
              products: (structured.products ?? []).map(normalizeCatalogProduct),
              notFound: extractNotFound(messages),
              source: "live",
              messages,
            };
          }
        : () => lookupMock(batch);
    if (!trace) return fn();
    return trace.time(
      {
        tool: "lookup_catalog",
        label: `${batch.length} identifier${batch.length === 1 ? "" : "s"}`,
        source,
      },
      fn,
      (r) => r.products.length,
    );
  };

  const result = forceMock
    ? await run("mock")()
    : await withMode(run("live"), run("mock"), "lookup", trace);
  lookupCache.set(key, result, CACHE_TTL.lookup);
  return result;
}

export async function getProduct(
  params: GetProductParams,
  trace?: TraceCollector,
): Promise<GetProductResult> {
  const key = cacheKey({
    tool: "get_product",
    mode: env.catalogMode,
    id: params.productId,
    selected: params.selected ?? null,
    preferences: params.preferenceOrder ?? null,
    context: params.context ?? null,
  });
  const cachedResult = productCache.get(key);
  if (cachedResult) {
    trace?.add({
      tool: "get_product",
      label: params.productId,
      durationMs: 0,
      resultCount: cachedResult.product ? 1 : 0,
      cacheHit: true,
      source: cachedResult.source,
      ok: true,
    });
    return cachedResult;
  }

  const run = (source: SourceDecision) => async (): Promise<GetProductResult> => {
    const fn =
      source === "live"
        ? async (): Promise<GetProductResult> => {
            const args: Record<string, unknown> = { id: params.productId };
            if (params.selected && Object.keys(params.selected).length > 0) {
              args.selected = Object.entries(params.selected).map(
                ([name, label]) => ({ name, label }),
              );
            }
            if (params.preferenceOrder && params.preferenceOrder.length > 0) {
              args.preferences = params.preferenceOrder;
            }
            const ctx = buildContext(params.context);
            if (ctx) args.context = ctx;
            const structured = await callCatalogTool("get_product", args, {
              timeoutMs: 12_000,
            });
            const messages = normalizeMessages(structured.messages);
            const raw = structured.product ?? structured.products?.[0] ?? null;
            if (!raw) {
              const notFound = extractNotFound(messages);
              if (notFound.length > 0 || messages.length > 0) {
                return {
                  product: null,
                  selectedVariant: null,
                  source: "live",
                  messages,
                };
              }
              throw new CatalogError({
                code: "invalid_response",
                message: "get_product returned no product and no messages",
              });
            }
            const product = normalizeCatalogProduct(raw);
            product.rawMessages = messages;
            // Choose the variant matching the selection when the response
            // doesn't designate one: first available variant satisfying all
            // selected options, honoring preference order relaxation.
            const selectedVariant = selectVariantWithRelaxation(
              product.variants,
              params.selected,
              params.preferenceOrder,
            );
            return { product, selectedVariant, source: "live", messages };
          }
        : () => getProductMock(params);
    if (!trace) return fn();
    return trace.time(
      { tool: "get_product", label: params.productId, source },
      fn,
      (r) => (r.product ? 1 : 0),
    );
  };

  const result = isMockId(params.productId)
    ? await run("mock")()
    : await withMode(run("live"), run("mock"), "get_product", trace);
  productCache.set(key, result, CACHE_TTL.product);
  return result;
}

/** Current source the app would use for a fresh request (for status banners). */
export function catalogModeInfo(): {
  mode: "live" | "mock" | "auto";
  authenticated: boolean;
  allowMockFallback: boolean;
} {
  return {
    mode: env.catalogMode,
    authenticated: Boolean(env.catalogClientId && env.catalogClientSecret),
    allowMockFallback: env.allowMockFallback,
  };
}

/** Test hook. */
export function _clearCatalogCachesForTests(): void {
  searchCache.clear();
  lookupCache.clear();
  productCache.clear();
}
