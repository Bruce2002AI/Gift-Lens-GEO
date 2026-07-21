/**
 * Normalized internal catalog types. The UI and ranking logic depend on these,
 * never on raw UCP wire responses. All fields the official schema does not
 * guarantee are optional/nullable.
 */

export interface CatalogMessage {
  type: string;
  code?: string | null;
  message?: string | null;
  severity?: string | null;
  [key: string]: unknown;
}

export interface NormalizedImage {
  url: string;
  altText: string | null;
  /** "image" | "video" | … — UCP labels each media item; lets the UI pick a player. */
  type: string | null;
}

/** A rating with its scale, so "4.7" is never shown without knowing it's out of 5. */
export interface NormalizedRating {
  value: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  count: number | null;
}

/**
 * `metadata.tech_specs` arrives as newline-separated "Label: value" lines.
 * Parsing it into pairs turns an opaque blob into a real spec table; lines
 * without a colon are preserved as `label: null` so nothing is lost.
 */
export interface NormalizedSpec {
  label: string;
  value: string | null;
}

export interface NormalizedOptionValue {
  label: string;
  available?: boolean;
  exists?: boolean;
}

export interface NormalizedOption {
  name: string;
  values: NormalizedOptionValue[];
}

export interface NormalizedSeller {
  id: string | null;
  name: string | null;
  url: string | null;
  domain: string | null;
  policyLinks: Array<{ type: string; url: string }>;
}

export interface NormalizedVariant {
  id: string;
  title: string;
  /** Merchant product-page URL for this variant, when returned. */
  url: string | null;
  sku: string | null;
  priceMinor: number | null;
  currency: string | null;
  available: boolean | null;
  availabilityStatus: string | null;
  runningLow: boolean | null;
  checkoutUrl: string | null;
  nativeCheckoutEligible: boolean | null;
  requiresShipping: boolean | null;
  imageUrl: string | null;
  options: Array<{ name: string; label: string }>;
  seller: NormalizedSeller | null;
  /** Variants carry their own copy text — often more specific than the product's. */
  description: string;
  /** Variants carry their own rating, which can differ from the product's. */
  rating: NormalizedRating;
  /** e.g. ["new"], ["refurbished"] — a real buying signal, so never dropped. */
  condition: string[];
}

export interface NormalizedProduct {
  id: string;
  title: string;
  description: string;
  url: string | null;
  /** Merchant handle/slug, when the catalog returns one. */
  handle: string | null;
  categories: Array<{ value: string; taxonomy?: string }>;
  images: NormalizedImage[];
  priceRange: {
    minMinor: number | null;
    maxMinor: number | null;
    currency: string | null;
  };
  options: NormalizedOption[];
  variants: NormalizedVariant[];
  rating: NormalizedRating;
  /**
   * Product-level seller. UCP reports the seller per variant, so this is the
   * first variant seller — surfaced here because the storefront + its policy
   * links (refund/privacy/terms) are trust signals the shopper needs up front.
   */
  seller: NormalizedSeller | null;
  metadata: {
    techSpecs: string[];
    topFeatures: string[];
    uniqueSellingPoints: string[];
    /** techSpecs parsed into label/value pairs for a real spec table. */
    specs: NormalizedSpec[];
  };
  rawMessages: CatalogMessage[];
}

/** Sanitized trace event surfaced to the UI for judges. Never contains secrets. */
export interface TraceEvent {
  id: string;
  tool:
    | "search_catalog"
    | "lookup_catalog"
    | "get_product"
    | "auth"
    | "ai"
    | "pipeline";
  label: string;
  detail?: string;
  durationMs: number;
  resultCount?: number;
  cacheHit?: boolean;
  source: "live" | "mock";
  ok: boolean;
  error?: string;
  startedAt: string;
}

export type CatalogSource = "live" | "mock";

export interface SearchResult {
  products: NormalizedProduct[];
  source: CatalogSource;
  messages: CatalogMessage[];
}

export interface LookupResult {
  /** Products keyed in the order requested; unresolved entries reported in notFound. */
  products: NormalizedProduct[];
  notFound: string[];
  source: CatalogSource;
  messages: CatalogMessage[];
}

export interface GetProductResult {
  product: NormalizedProduct | null;
  /** The variant matching the current selection, when the API designates one. */
  selectedVariant: NormalizedVariant | null;
  source: CatalogSource;
  messages: CatalogMessage[];
}

export interface BuyerContext {
  country: string;
  region?: string | null;
  postalCode?: string | null;
  currency?: string | null;
  language?: string | null;
  intent?: string | null;
}

export interface SearchFilters {
  available?: boolean;
  shipsTo?: string;
  priceMinMinor?: number | null;
  priceMaxMinor?: number | null;
  category?: string | null;
  minRating?: number | null;
}

export interface SearchParams {
  query?: string;
  /** Similarity seed: a known product id or an uploaded image data URL. */
  like?: { productId?: string; imageDataUrl?: string } | null;
  context?: BuyerContext | null;
  filters?: SearchFilters | null;
  limit?: number;
}

export interface GetProductParams {
  productId: string;
  /** Option selections, e.g. { Color: "Black", Size: "M" }. */
  selected?: Record<string, string> | null;
  /** Option names in priority order for relaxation semantics. */
  preferenceOrder?: string[] | null;
  context?: BuyerContext | null;
}
