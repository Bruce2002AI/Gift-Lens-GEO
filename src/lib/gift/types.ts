import type { GiftIntent } from "@/lib/ai/schemas";
import type { CatalogSource, NormalizedProduct, TraceEvent } from "@/lib/catalog/types";
import type { Pick, RecommendationRole, ScoreBreakdown } from "@/lib/modes/types";

/** Shared request/response types for the gift API (safe to import from client components). */

// The recommendation shape is shared across all ShopLens modes; a gift
// recommendation is just a `Pick`. Re-exported so existing imports keep working.
export type { RecommendationRole, ScoreBreakdown };
export type GiftRecommendation = Pick;

export interface ConciergeResponse {
  ok: boolean;
  stage: "clarification" | "recommendations" | "error";
  clarificationQuestion?: string | null;
  assistantMessage?: string | null;
  intent?: GiftIntent;
  aiMode: "ai" | "heuristic";
  source: CatalogSource | "mixed";
  recommendations: GiftRecommendation[];
  limitation?: string | null;
  trace: TraceEvent[];
  error?: string | null;
}

export interface LinkCheckResponse {
  ok: boolean;
  product?: NormalizedProduct | null;
  verdict?: "strong" | "reasonable" | "weak";
  reasons?: string[];
  concerns?: string[];
  alternatives?: GiftRecommendation[];
  source: CatalogSource | "mixed";
  aiMode: "ai" | "heuristic";
  trace: TraceEvent[];
  error?: string | null;
}
