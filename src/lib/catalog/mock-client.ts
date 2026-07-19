import { MOCK_PRODUCTS, findMockProduct } from "@/data/mock-products";
import { sleep } from "@/lib/utils";
import { selectVariantWithRelaxation } from "./variant-select";
import type {
  GetProductParams,
  GetProductResult,
  LookupResult,
  NormalizedProduct,
  SearchParams,
  SearchResult,
} from "./types";

/**
 * Mock catalog client. Serves the fixture set with deterministic keyword
 * scoring so the full pipeline (three strategies, dedupe, ranking, GEO
 * visibility tests) genuinely executes in mock mode. The UI labels every
 * mock result with a persistent "Demo catalog data" banner.
 */

const MOCK_LATENCY_MS = 120;

function scoreProduct(
  product: NormalizedProduct & { keywords: string[] },
  query: string,
): number {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9₹\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return 0.01;
  const haystackTitle = product.title.toLowerCase();
  const haystackDesc = product.description.toLowerCase();
  const haystackKeywords = product.keywords.join(" ").toLowerCase();
  const haystackCats = product.categories.map((c) => c.value).join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystackTitle.includes(term)) score += 3;
    if (haystackKeywords.includes(term)) score += 2;
    if (haystackDesc.includes(term)) score += 1;
    if (haystackCats.includes(term)) score += 1;
  }
  return score;
}

function applyFilters(
  products: Array<NormalizedProduct & { keywords: string[] }>,
  params: SearchParams,
): Array<NormalizedProduct & { keywords: string[] }> {
  const f = params.filters;
  return products.filter((p) => {
    if (f?.available !== false) {
      if (!p.variants.some((v) => v.available)) return false;
    }
    const min = f?.priceMinMinor ?? null;
    const max = f?.priceMaxMinor ?? null;
    const pMin = p.priceRange.minMinor;
    if (max != null && pMin != null && pMin > max) return false;
    if (min != null) {
      const pMax = p.priceRange.maxMinor ?? pMin;
      if (pMax != null && pMax < min) return false;
    }
    return true;
  });
}

export async function searchMock(params: SearchParams): Promise<SearchResult> {
  await sleep(MOCK_LATENCY_MS);
  let candidates = applyFilters(MOCK_PRODUCTS, params);

  if (params.like?.productId) {
    const seed = findMockProduct(params.like.productId) as
      | (NormalizedProduct & { keywords: string[] })
      | undefined;
    if (seed) {
      const seedQuery = [seed.title, ...seed.keywords, params.query ?? ""].join(" ");
      candidates = candidates
        .filter((p) => p.id !== seed.id)
        .map((p) => ({ p, s: scoreProduct(p, seedQuery) }))
        .filter(({ s }) => s > 0)
        .sort((a, b) => b.s - a.s)
        .map(({ p }) => p);
      return {
        products: candidates.slice(0, params.limit ?? 10),
        source: "mock",
        messages: [],
      };
    }
  }

  // Image similarity has no meaningful mock — return a labeled subset rather
  // than pretending to understand the image.
  if (params.like?.imageDataUrl && !params.query) {
    return {
      products: candidates.slice(0, params.limit ?? 10),
      source: "mock",
      messages: [
        {
          type: "warning",
          code: "mock_image_search",
          message:
            "Mock mode cannot analyze images; showing demo products instead.",
        },
      ],
    };
  }

  const query = params.query ?? "";
  const scored = candidates
    .map((p) => ({ p, s: scoreProduct(p, query) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);

  return {
    products: scored.slice(0, params.limit ?? 10),
    source: "mock",
    messages: [],
  };
}

export async function lookupMock(ids: string[]): Promise<LookupResult> {
  await sleep(MOCK_LATENCY_MS);
  const products: NormalizedProduct[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const p = findMockProduct(id);
    if (p) products.push(p);
    else notFound.push(id);
  }
  return {
    products,
    notFound,
    source: "mock",
    messages: notFound.map((id) => ({
      type: "error",
      code: "not_found",
      message: `Identifier not resolved: ${id}`,
    })),
  };
}

export async function getProductMock(
  params: GetProductParams,
): Promise<GetProductResult> {
  await sleep(MOCK_LATENCY_MS);
  const product = findMockProduct(params.productId) ?? null;
  if (!product) {
    return {
      product: null,
      selectedVariant: null,
      source: "mock",
      messages: [
        {
          type: "error",
          code: "not_found",
          message: `Identifier not resolved: ${params.productId}`,
        },
      ],
    };
  }
  const selectedVariant = selectVariantWithRelaxation(
    product.variants,
    params.selected,
    params.preferenceOrder,
  );
  return { product, selectedVariant, source: "mock", messages: [] };
}
