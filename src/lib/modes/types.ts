import type { ZodType } from "zod";
import type {
  CatalogSource,
  NormalizedProduct,
  TraceEvent,
} from "@/lib/catalog/types";

/**
 * ShopLens mode system — the shared contract for one agent that handles many
 * shopping "lenses". A mode is DATA (schema + prompts + constraints + safety +
 * presentation), not a fork of the app. The engine routes a message to a mode,
 * extracts its intent, then runs either the "picks" pipeline (ranked products)
 * or the "plan" pipeline (a multi-component bundle). Everything below is
 * type-only so this file is safe to import from client components.
 */

export const MODE_IDS = [
  "gift",
  "skincare",
  "style",
  "nutrition",
  "room",
  "travel",
  "hobby",
  "lifestage",
  "swap",
  "occasion",
] as const;
export type ShoppingModeId = (typeof MODE_IDS)[number];

export type ResultKind = "picks" | "plan";
export type AiMode = "ai" | "heuristic";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** Optional structured form fields the UI can pass alongside the conversation. */
export interface AgentFormFields {
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  country?: string | null;
  occasion?: string | null;
  relationship?: string | null;
}

// ---------------------------------------------------------------------------
// Base intent — the common denominator the shared engine (constraints, ranking,
// reranker, explanations) reads. Every mode's rich intent is projected onto
// this via the mode's `toBaseIntent`.
// ---------------------------------------------------------------------------

export interface BaseBudget {
  minMajor: number | null;
  maxMajor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
  currency: string;
}

export interface Destination {
  country: string;
  region: string | null;
  city: string | null;
  postalCode: string | null;
}

export interface BaseIntent {
  budget: BaseBudget;
  destination: Destination;
  physicality: "physical" | "digital" | "either";
  deadline: string | null;
  /** Explicit hard constraints ("exclude: X", "no Y"). */
  hardConstraints: string[];
  /** Things to avoid (dislikes, disliked ingredients/brands…). */
  exclusions: string[];
  /** Soft vibe/style words. */
  softPreferences: string[];
  /** Keywords used for semantic (interest) scoring. */
  searchThemes: string[];
  /** What the shopper/recipient cares about (drives recipientFit). */
  interests: string[];
  /** Occasion / goal, drives occasionFit. */
  occasion: string | null;
  /** Aesthetic/style tokens (drives occasionFit + novelty). */
  styleKeywords: string[];
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
}

// ---------------------------------------------------------------------------
// Picks result (Gift, Swap) — reuses the gift recommendation shape, widened so
// modes can supply their own badge/role keys.
// ---------------------------------------------------------------------------

export type KnownRole = "best_match" | "delight_pick" | "safe_pick" | "more";
// The `(string & {})` keeps autocomplete on the known roles while allowing any
// mode-specific badge key (e.g. "cheaper", "sustainable", "primary").
export type RecommendationRole = KnownRole | (string & {});

export interface ScoreBreakdown {
  recipientFit: number;
  occasionFit: number;
  logistics: number;
  quality: number;
  completeness: number;
  novelty: number;
}

export interface Pick {
  role: RecommendationRole;
  productId: string;
  variantId: string | null;
  totalScore: number;
  scoreBreakdown: ScoreBreakdown;
  reasons: string[];
  tradeoff: string;
  evidence: Array<{ claim: string; sourceField: string }>;
  confidence: "high" | "medium" | "low";
  logisticsMessage: string;
  product: NormalizedProduct;
  source: CatalogSource;
}

// ---------------------------------------------------------------------------
// Plan result (the 8 bundle modes) — a blueprint of components, each resolved
// to a primary product + alternatives, with a running total.
// ---------------------------------------------------------------------------

export interface PlanComponentSpec {
  key: string;
  /** e.g. "Gentle cleanser", "Footwear", "Breakfast protein". */
  label: string;
  /** Why this component belongs in the plan (evidence-neutral rationale). */
  why: string;
  essential: boolean;
  /** Catalog search query for this component. */
  query: string;
  /** Relative share of the total budget (weights need not sum to 1). */
  budgetWeight: number;
  /** Optional section grouping: "Morning"/"Evening", "Must have now"/"Later", … */
  group: string | null;
}

export interface Blueprint {
  components: PlanComponentSpec[];
  note: string | null;
}

export interface PlanComponentResult {
  key: string;
  label: string;
  why: string;
  essential: boolean;
  group: string | null;
  primary: Pick | null;
  alternatives: Pick[];
  /** Set when nothing satisfied the constraints for this component. */
  note: string | null;
}

export interface PlanResult {
  components: PlanComponentResult[];
  /** Sum of primaries in minor units (null if any primary lacks a comparable price). */
  totalMinor: number | null;
  currency: string;
  limitation: string | null;
}

// ---------------------------------------------------------------------------
// Unified agent response (discriminated by resultKind + stage).
// ---------------------------------------------------------------------------

export interface AgentResponseBase {
  ok: boolean;
  modeId: ShoppingModeId;
  /** Router confidence 0..1 (heuristic or LLM). */
  routeConfidence?: number;
  aiMode: AiMode;
  source: CatalogSource | "mixed";
  trace: TraceEvent[];
  assistantMessage?: string | null;
  /** Persistent safety/educational disclaimer for the mode, when any. */
  disclaimer?: string | null;
  error?: string | null;
}

export interface PicksResponse extends AgentResponseBase {
  resultKind: "picks";
  stage: "clarification" | "recommendations";
  clarificationQuestion?: string | null;
  recommendations: Pick[];
  limitation?: string | null;
}

export interface PlanResponse extends AgentResponseBase {
  resultKind: "plan";
  stage: "clarification" | "plan_approval" | "plan";
  clarificationQuestion?: string | null;
  blueprint?: Blueprint | null;
  plan?: PlanResult | null;
}

export type AgentResponse = PicksResponse | PlanResponse;

// ---------------------------------------------------------------------------
// Client-safe display metadata (mode picker, badges, copy).
// ---------------------------------------------------------------------------

export interface ModeBadge {
  key: string;
  label: string;
  blurb: string;
}

export interface ModeMeta {
  id: ShoppingModeId;
  /** Product name for this lens, e.g. "GiftLens", "RoutineLens". */
  name: string;
  /** Short chip label, e.g. "Gift", "Skincare". */
  short: string;
  tagline: string;
  /** lucide-react icon name, resolved in the client. */
  icon: string;
  accent: "plum" | "gold" | "ink";
  resultKind: ResultKind;
  examplePrompt: string;
  /** Heuristic router keywords (lowercased). */
  keywords: string[];
  /** Few-shot phrases for the LLM router. */
  routeExamples: string[];
  refinements: string[];
  /** Picks roles or plan tiers, in display order. */
  badges: ModeBadge[];
  requiresApproval: boolean;
  /** Safety-gated (educational) modes carry an extra disclaimer. */
  educational?: boolean;
}

// ---------------------------------------------------------------------------
// Server-side mode descriptor (the "skill"). Lives in modes/skills/<id>.ts and
// is lazy-loaded by the registry. Type-only here; concrete objects are server.
// ---------------------------------------------------------------------------

export interface SafetyPolicy {
  /** Always-shown educational disclaimer. */
  disclaimer: string;
  /** Patterns stripped/rejected from any generated copy (diagnose/cure/guarantee). */
  blockedClaimPatterns: RegExp[];
  /** Returns a "see a professional" message for red-flag inputs, else null. */
  gate?: (intent: BaseIntent) => string | null;
  /** Categories that must be explicitly opted into (e.g. supplements). */
  requireOptIn?: string[];
}

export interface StrategyPlan {
  strategies: Array<{ strategy: string; query: string; rationale: string }>;
}

/**
 * A skill descriptor. Non-generic: the mode's rich intent is opaque (`unknown`)
 * to the engine, which only ever projects it to a BaseIntent via `toBaseIntent`.
 * Each skill casts to its own intent type inside its hooks.
 */
export interface ShoppingMode {
  meta: ModeMeta;
  /** Zod schema validating this mode's finalized rich intent (approval/refine round-trips). */
  intentSchema: ZodType;
  /** Zod schema for what the extraction model returns (before minor-unit finalization). */
  rawSchema: ZodType;
  /** System persona for extraction + explanations. */
  persona: string;
  /** What to call an item in generated copy ("gift", "routine step", …). */
  noun?: string;
  /** Builds the extraction prompt from the conversation + optional form. */
  extractPrompt: (conversation: ConversationTurn[], form?: AgentFormFields) => string;
  /** Turns the model's raw JSON into the validated rich intent (computes minor units, etc.). */
  finalizeIntent: (raw: unknown, form?: AgentFormFields) => unknown;
  /** Deterministic heuristic intent when no model is available. */
  heuristicIntent: (conversation: ConversationTurn[], form?: AgentFormFields) => unknown;
  /** Projection onto the shared BaseIntent for constraints/ranking. */
  toBaseIntent: (intent: unknown) => BaseIntent;
  clarifyMax: number;

  // Picks modes:
  planStrategies?: (intent: unknown) => StrategyPlan;

  // Plan modes:
  buildBlueprint?: (intent: unknown) => Promise<{ blueprint: Blueprint; aiMode: AiMode }>;

  // Shared hooks:
  /** Extra hard constraints on top of budget/availability/destination/exclusions. */
  extraConstraints?: (product: NormalizedProduct, intent: unknown) => string[];
  safety?: SafetyPolicy;
}
