import "server-only";
import { getProduct, lookupCatalog } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { majorToMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import { generatePrompts } from "./prompts";
import {
  deriveRecommendations,
  suggestBeforeAfter,
} from "./recommendations";
import { auditConfidence, computeAgentReadiness } from "./scoring";
import type { GeoAuditInput, GeoAuditResponse } from "./types";
import { runVisibilitySuite } from "./visibility";

/**
 * GEO audit flow:
 * validate URL → lookup_catalog → get_product → prompt suite →
 * search_catalog × N visibility tests → readiness score → recommendations.
 * Read-only: never modifies the merchant listing.
 */

export function validateProductUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // Accept catalog identifiers directly.
  if (/^gid:\/\/shopify\//.test(trimmed) || /^mock:/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // The URL is passed to lookup_catalog as an identifier — ShopLens never
    // fetches brand-supplied URLs itself (SSRF prevention).
    return url.toString();
  } catch {
    return null;
  }
}

export async function runGeoAudit(input: GeoAuditInput): Promise<GeoAuditResponse> {
  const trace = new TraceCollector();
  const lastRefreshed = new Date().toISOString();
  const budgetMaxMinor = majorToMinor(input.budgetMax, input.currency);

  const base: Omit<
    GeoAuditResponse,
    "resolved" | "product" | "totalScore" | "dimensions" | "confidence" | "confidenceReasons"
  > = {
    ok: true,
    source: "live",
    aiMode: "heuristic",
    visibility: null,
    competitors: [],
    recommendations: [],
    beforeAfter: null,
    trace: [],
    lastRefreshed,
  };

  const identifier = validateProductUrl(input.productUrl);
  if (!identifier) {
    return {
      ...base,
      ok: false,
      error:
        "That does not look like a valid product URL or catalog identifier. Paste an http(s) Shopify product URL.",
      resolved: false,
      product: null,
      totalScore: 0,
      dimensions: [],
      confidence: "low",
      confidenceReasons: ["No valid identifier was provided."],
      trace: trace.list(),
    };
  }

  // 1. Resolve the identifier.
  const lookup = await lookupCatalog(
    [identifier],
    { country: input.country, currency: input.currency },
    trace,
  );

  if (lookup.products.length === 0) {
    return {
      ...base,
      resolved: false,
      notFoundMessage:
        "ShopLens could not resolve this identifier in the selected catalog context. This is a diagnostic signal — it does not mean Shopify has penalized the product. Check that the URL is a public product page and that the product is published to the catalog.",
      product: null,
      source: lookup.source,
      totalScore: 0,
      dimensions: [],
      confidence: "low",
      confidenceReasons: [
        "The identifier did not resolve, so no product data could be audited.",
      ],
      trace: trace.list(),
    };
  }

  // 2. Deep product retrieval.
  const resolvedId = lookup.products[0].id;
  let product = lookup.products[0];
  let source = lookup.source;
  try {
    const detail = await getProduct(
      {
        productId: resolvedId,
        context: { country: input.country, currency: input.currency },
      },
      trace,
    );
    if (detail.product) {
      product = detail.product;
      source = detail.source;
    }
  } catch (err) {
    logger.warn("geo audit: get_product failed; auditing lookup data", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3-4. Prompt suite + visibility tests.
  const { prompts, aiMode: promptMode } = await generatePrompts(product, input);
  const { summary, competitors } = await runVisibilitySuite(
    product,
    prompts,
    { country: input.country, currency: input.currency, budgetMaxMinor },
    trace,
  );

  // 5. Score + confidence.
  const { total, dimensions } = computeAgentReadiness(product, summary, input.country);
  const conf = auditConfidence(true, product, summary);

  // 6. Recommendations + before/after copy.
  const recommendations = deriveRecommendations(product, dimensions, summary);
  const missedPrompts = summary.tests
    .filter((t) => t.status === "not_observed")
    .map((t) => t.prompt);
  const { copy, aiMode: copyMode } = await suggestBeforeAfter(product, missedPrompts);

  return {
    ...base,
    resolved: true,
    product,
    // Derive the banner label from every catalog call made (product resolution
    // AND the 10 visibility searches), so mock fallbacks anywhere in the audit
    // are never presented under a "Live" label.
    source: trace.overallSource(source),
    aiMode: promptMode === "ai" || copyMode === "ai" ? "ai" : "heuristic",
    totalScore: total,
    dimensions,
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    visibility: summary,
    competitors,
    recommendations,
    beforeAfter: copy,
    trace: trace.list(),
    lastRefreshed,
  };
}
