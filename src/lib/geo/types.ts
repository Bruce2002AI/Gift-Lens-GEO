import type {
  CatalogSource,
  NormalizedProduct,
  TraceEvent,
} from "@/lib/catalog/types";

/** Shared GEO Lens types (safe for client components). */

export type VisibilityStatus =
  | "appeared"
  | "not_observed"
  | "failed"
  | "ineligible";

export interface VisibilityTest {
  prompt: string;
  status: VisibilityStatus;
  /** 1-based position among inspected results when appeared. */
  position: number | null;
  resultsInspected: number;
  topCompetitor: { id: string; title: string; seller: string | null } | null;
  matchType: "product" | "variant" | null;
  timestamp: string;
  warning: string | null;
  /** Set when a hard filter (price/ships_to/availability) could have excluded the product. */
  hardFilterRisk: string | null;
}

export interface VisibilitySummary {
  tests: VisibilityTest[];
  coverage: number; // appeared / attempted (failed tests excluded from denominator)
  topThreeCount: number;
  averagePosition: number | null;
  notObservedCount: number;
  failedCount: number;
  attemptedCount: number;
}

export interface DimensionFinding {
  check: string;
  passed: boolean;
  evidence: string;
  points: number;
  maxPoints: number;
}

export interface DimensionScore {
  key: "naming" | "attributes" | "offer" | "media" | "trust" | "visibility";
  label: string;
  score: number;
  max: number;
  summary: string;
  findings: DimensionFinding[];
}

export interface CompetitorCard {
  id: string;
  title: string;
  seller: string | null;
  appearances: number;
  bestPosition: number | null;
  priceLabel: string | null;
  imageUrl: string | null;
}

export interface GeoRecommendation {
  category: string;
  issue: string;
  evidence: string;
  why: string;
  suggestion: string;
  priority: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
}

export interface BeforeAfterCopy {
  beforeTitle: string;
  afterTitle: string;
  beforeDescription: string;
  afterDescription: string;
}

export interface GeoAuditResponse {
  ok: boolean;
  error?: string | null;
  resolved: boolean;
  notFoundMessage?: string | null;
  product?: NormalizedProduct | null;
  source: CatalogSource | "mixed";
  aiMode: "ai" | "heuristic";
  totalScore: number;
  dimensions: DimensionScore[];
  confidence: "high" | "medium" | "low";
  confidenceReasons: string[];
  visibility: VisibilitySummary | null;
  competitors: CompetitorCard[];
  recommendations: GeoRecommendation[];
  beforeAfter: BeforeAfterCopy | null;
  trace: TraceEvent[];
  lastRefreshed: string;
}

export interface GeoAuditInput {
  productUrl: string;
  country: string;
  currency: string;
  audience?: string | null;
  occasion?: string | null;
  budgetMax?: number | null;
  positioning?: string | null;
  customPrompts?: string[] | null;
}
