import { z } from "zod";
import type { CatalogSource, NormalizedProduct } from "@/lib/catalog/types";

/**
 * The Expert Loop contract (see docs/AI-EXPERIENCE-REDESIGN.md).
 *
 * One agentic loop: the model chooses every next action; code is the truth
 * layer. This file is the shared contract between the loop engine, the truth
 * validators, the streaming API route, and the UI.
 */

// ---------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------

export const EXPERT_LENS_IDS = ["gift", "skincare", "style", "nutrition"] as const;
export type ExpertLensId = (typeof EXPERT_LENS_IDS)[number];

export function isExpertLens(id: string | null | undefined): id is ExpertLensId {
  return EXPERT_LENS_IDS.includes(id as ExpertLensId);
}

// ---------------------------------------------------------------------------
// Session Ledger — the agent's provenance-tagged working memory
// ---------------------------------------------------------------------------

/** Where a ledger fact came from. Inferred facts render hedged + correctable. */
export type Provenance = "said" | "inferred" | "assumed";

export interface LedgerFact {
  id: string;
  /** Short dotted slug, e.g. "recipient.loves", "skin.feel", "wardrobe.anchor". */
  key: string;
  value: string;
  provenance: Provenance;
  /** The user's own words — required when provenance is "said". */
  quote: string | null;
  turn: number;
}

export interface LedgerConstraints {
  budgetMaxMinor: number | null;
  budgetMinMinor: number | null;
  currency: string;
  country: string | null;
  /** Deadline/urgency is a first-class constraint — reasoned with, never promised against. */
  deadline: string | null;
  exclusions: string[];
}

/** A sticky, add-only safety flag. Retired only by an explicit, logged user correction. */
export interface CareFlag {
  kind: string;
  label: string;
  /** The text that triggered it (user quote or detector match). */
  matchedText: string;
  turn: number;
  /** Terms denylisted from cards/searches while this flag is active (scope fence). */
  scopeFence: string[];
  /** Last turn a care segment was delivered for this flag (cooldown bookkeeping). */
  lastCaredTurn: number | null;
}

/** Consent as a recorded speech act: quoted, turn-stamped, revocable. */
export interface ConsentRecord {
  category: string;
  quote: string;
  turn: number;
  revoked: boolean;
}

export interface SessionLedger {
  facts: LedgerFact[];
  constraints: LedgerConstraints;
  careFlags: CareFlag[];
  consents: ConsentRecord[];
  /** Questions already asked (dedup guard). */
  askedQuestions: string[];
  /** Normalized queries already run (dedup guard). */
  searchQueries: string[];
}

/** Per-product evidence: the ONLY permissible source of product-fact claims. */
export interface EvidenceEntry {
  product: NormalizedProduct;
  source: CatalogSource;
  fetchedAt: string;
  /** Quote-picker snippets so the model can cite verbatim substrings. */
  snippets: Array<{ field: string; text: string }>;
}

export interface AgentSession {
  id: string;
  lens: ExpertLensId;
  turn: number;
  createdAtMs: number;
  transcript: Array<{ role: "user" | "assistant"; content: string; turn: number }>;
  ledger: SessionLedger;
  /** productId → evidence from get_product. Server-side only. */
  evidence: Map<string, EvidenceEntry>;
  /** Compact candidate summaries from searches this session (id → summary line). */
  candidates: Map<string, string>;
  /**
   * Which products each search surfaced (normalized query → ids, result order).
   * Lets code refill a thin board category with siblings from the same aisle.
   */
  searchHits: Map<string, string[]>;
  /**
   * Every product ever shown on a board this session. The code-side top-up
   * never re-adds one of these under a new header — the same card appearing
   * twice with different framing reads as a glitch, not a suggestion.
   */
  boardedIds: Set<string>;
  /**
   * productId → the price cap the catalog itself applied when returning it.
   * Only these products may claim catalog-side budget screening (a foreign-
   * currency offer fetched without a price filter has NOT been screened).
   */
  budgetScreenedCap: Map<string, number>;
  /** Uploaded image for catalog visual similarity / vision analysis. */
  uploadedImage: { dataUrl: string; note: string } | null;
  /** Structured read of the uploaded outfit photo, when a vision model saw it. */
  outfitRead: unknown | null;
  /** Catalog sources seen this session (mock disclosure). */
  sawMock: boolean;
  /** Whether the demo-data notice has been shown (survives across turns). */
  mockAnnounced: boolean;
  /** Lenses whose mandatory educational framing has been delivered. */
  framedLenses: ExpertLensId[];
  /** Total questions asked this session (standalone + follow-ups) — hard-capped. */
  questionCount: number;
  /** Per-session fact id sequence (module-global counters recycle ids). */
  factSeq: number;
}

// ---------------------------------------------------------------------------
// Model action envelope — flat object (robust for structured output); the
// loop validates per-action semantic requirements in code.
// ---------------------------------------------------------------------------

// A creative model sometimes omits a fork field; ".catch" keeps the object
// parseable (the loop drops any fork whose branches aren't both filled).
export const ForkSchema = z.object({
  ifA: z.string().catch(""),
  thenA: z.string().catch(""),
  ifB: z.string().catch(""),
  thenB: z.string().catch(""),
});
export type Fork = z.infer<typeof ForkSchema>;

// The model occasionally writes a query as a bare string instead of {query}.
// Coerce it so a good search isn't lost to a shape nit.
export const SearchSpecSchema = z.preprocess(
  (v) => (typeof v === "string" ? { query: v } : v),
  z.object({
    query: z.string(),
    maxPriceMinor: z.number().nullish(),
    likeProductId: z.string().nullish(),
    /** Catalog visual similarity against the user's uploaded image (agent hasn't seen it). */
    useUploadedImage: z.boolean().nullish(),
  }),
);
export type SearchSpec = z.infer<typeof SearchSpecSchema>;

export const FactPatchSchema = z.object({
  key: z.string(),
  value: z.string(),
  provenance: z.enum(["said", "inferred", "assumed"]),
  /** Required for "said" — must be a verbatim substring of a user message. */
  quote: z.string().nullish(),
});

/** Constraint updates in MAJOR units (natural for the model); code converts. */
export const ConstraintPatchSchema = z.object({
  budgetMaxMajor: z.number().nullish(),
  budgetMinMajor: z.number().nullish(),
  currency: z.string().nullish(),
  country: z.string().nullish(),
  deadline: z.string().nullish(),
  exclusionsAdd: z.array(z.string()).nullish(),
});

export const ClaimSchema = z.object({
  /** The sentence shown to the user. */
  text: z.string(),
  /** Evidence pointer: which product field backs it. */
  field: z.string(),
  /** Verbatim substring of that field (normalized match, code-verified). */
  quote: z.string(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const CardSpecSchema = z.object({
  productId: z.string(),
  role: z.string().nullish(),
  /** Product-fact stratum: every entry is evidence-verified or dropped. */
  claims: z.array(ClaimSchema),
  /** Interpretation stratum: why this fits — barred from product-attribute facts. */
  whyForYou: z.array(z.string()),
  tradeoff: z.string().nullish(),
  /** Runner-up autopsy: what this beat and why, citing the user's words. */
  runnerUp: z.string().nullish(),
});
export type CardSpec = z.infer<typeof CardSpecSchema>;

export const PresentSectionSchema = z.object({
  title: z.string().nullish(),
  intro: z.string().nullish(),
  /** Non-product plan steps (sleep, "stop the scrub", owned items) — first-class. */
  steps: z.array(z.object({ text: z.string(), why: z.string().nullish() })).nullish(),
  cards: z.array(CardSpecSchema).nullish(),
});

/**
 * The product board: every option the agent found, grouped by category
 * (shirts/trousers/shoes, cleanser/serum/SPF, diet/supplement stage…). Rendered
 * in the side panel so the shopper sees the full shortlist, not just the picks.
 */
export const BoardItemSchema = z.object({
  productId: z.string(),
  /** Why this one is here, for THIS shopper — one line. */
  insight: z.string(),
  /** What you give up. Required for alternatives (beyond the first two). */
  tradeoff: z.string().nullish(),
});

export const BoardCategorySchema = z.object({
  /** "Shirts", "Trousers", "Cleanser", "Protein sources"… — the agent's own grouping. */
  name: z.string(),
  items: z.array(BoardItemSchema),
});

/** A complete look/plan composed from board items (fashion outfits, routine stages). */
export const CompositionSchema = z.object({
  name: z.string(),
  /** Why these pieces work together — colour harmony, occasion, comfort. */
  rationale: z.string(),
  productIds: z.array(z.string()),
});

/** A narrowing question shown UNDER the products — show-and-ask in one turn. */
export const FollowUpSchema = z.object({
  text: z.string().catch(""),
  fork: ForkSchema.nullish(),
  quickReplies: z.array(z.string()).nullish(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

// The scaffolding fields (message/layout/sections) are defaulted with ".catch"
// so a present that carries the real payload — the board — still parses when a
// creative model omits or malforms the wrapper. The board is what matters.
export const PresentationSchema = z.object({
  message: z.string().catch(""),
  layout: z.enum(["picks", "plan", "single", "comparison"]).catch("picks"),
  assumptions: z.array(z.string()).nullish(),
  sections: z.array(PresentSectionSchema).catch([]),
  /** "What I left out on purpose" — items considered and rejected, with reasons. */
  leftOut: z.array(z.object({ item: z.string(), reason: z.string() })).nullish(),
  /** One narrowing question to refine the picks — the agent keeps shopping while it asks. */
  followUp: FollowUpSchema.nullish(),
  /** Every option found, grouped by category — powers the side panel. */
  board: z.array(BoardCategorySchema).nullish(),
  /** Composed looks/stages built from board items (e.g. 3 outfits). */
  compositions: z.array(CompositionSchema).nullish(),
});
export type Presentation = z.infer<typeof PresentationSchema>;

export const ACTION_KINDS = [
  "say",
  "ask_user",
  "search_catalog",
  "get_product",
  "update_ledger",
  "propose_direction",
  "present",
  "note_limitation",
] as const;

export const ActionSchema = z.object({
  action: z.enum(ACTION_KINDS),
  /** say / ask_user / note_limitation text. */
  text: z.string().nullish(),
  /** ask_user: the two recommendation branches that hinge on the answer. */
  fork: ForkSchema.nullish(),
  quickReplies: z.array(z.string()).nullish(),
  /** search_catalog: 1–4 queries, run concurrently. */
  queries: z.array(SearchSpecSchema).nullish(),
  /** get_product: one id, or a batch fetched concurrently (cheaper than N actions). */
  productId: z.string().nullish(),
  productIds: z.array(z.string()).nullish(),
  rationale: z.string().nullish(),
  /** update_ledger. */
  facts: z.array(FactPatchSchema).nullish(),
  constraints: ConstraintPatchSchema.nullish(),
  consent: z.object({ category: z.string(), quote: z.string() }).nullish(),
  careFlagAdd: z.string().nullish(),
  /** propose_direction. */
  summary: z.string().nullish(),
  sections: z.array(z.object({ title: z.string(), detail: z.string() })).nullish(),
  /** present. */
  presentation: PresentationSchema.nullish(),
});
export type AgentAction = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Verified (server-notarized) presentation — what the UI actually receives
// ---------------------------------------------------------------------------

export interface VerifiedClaim {
  text: string;
  field: string;
  quote: string;
}

export interface VerifiedCard {
  productId: string;
  role: string | null;
  title: string;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string | null;
  productUrl: string | null;
  merchant: string | null;
  variantId: string | null;
  claims: VerifiedClaim[];
  whyForYou: string[];
  tradeoff: string | null;
  runnerUp: string | null;
  /** Honest gaps: claims the model made that could not be evidence-verified. */
  droppedClaims: number;
  logistics: string;
  source: CatalogSource;
  /** Evidence freshness — "as of" timestamp of the get_product fetch. */
  asOf: string;
}

export interface VerifiedSection {
  title: string | null;
  intro: string | null;
  steps: Array<{ text: string; why: string | null }>;
  cards: VerifiedCard[];
}

/** A side-panel product: real catalog data + the agent's reasoning. */
export interface VerifiedBoardItem {
  productId: string;
  title: string;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string | null;
  merchant: string | null;
  productUrl: string | null;
  insight: string;
  tradeoff: string | null;
  /** Among the agent's top two in this category (used in the compositions). */
  isPick: boolean;
  source: CatalogSource;
}

export interface VerifiedBoardCategory {
  name: string;
  items: VerifiedBoardItem[];
}

export interface VerifiedComposition {
  name: string;
  rationale: string;
  productIds: string[];
}

export interface VerifiedPresentation {
  message: string;
  layout: Presentation["layout"];
  assumptions: string[];
  sections: VerifiedSection[];
  leftOut: Array<{ item: string; reason: string }>;
  totalMinor: number | null;
  /** The cards' own currency — never the ledger's, which may differ. */
  totalCurrency: string | null;
  currency: string;
  /** Cards dropped entirely by the truth layer (acknowledged in voice). */
  droppedCards: number;
  /** A narrowing question shown under the picks — the agent keeps shopping while it asks. */
  followUp: { text: string; fork: Fork | null; quickReplies: string[] } | null;
  /** Every verified option, grouped by category — the side panel. */
  board: VerifiedBoardCategory[];
  /** Composed looks/stages built from board items. */
  compositions: VerifiedComposition[];
}

// ---------------------------------------------------------------------------
// Client-safe ledger view (the Living Portrait panel)
// ---------------------------------------------------------------------------

export interface LedgerView {
  facts: LedgerFact[];
  constraints: LedgerConstraints;
  careFlags: Array<{ kind: string; label: string }>;
  consents: Array<{ category: string; quote: string; revoked: boolean }>;
}

// ---------------------------------------------------------------------------
// NDJSON stream events (server → client, one JSON object per line)
// ---------------------------------------------------------------------------

export type ExpertEvent =
  | { type: "session"; sessionId: string; lens: ExpertLensId }
  | { type: "say"; text: string }
  | { type: "trace"; kind: "search" | "inspect" | "note"; label: string; detail?: string; ok?: boolean }
  | { type: "ledger"; view: LedgerView }
  | { type: "care"; text: string; flags: string[] }
  | { type: "ask"; text: string; fork: Fork | null; quickReplies: string[] }
  | { type: "propose"; summary: string; sections: Array<{ title: string; detail: string }> }
  | { type: "present"; presentation: VerifiedPresentation }
  | { type: "limitation"; text: string }
  | { type: "notice"; tone: "mock" | "degraded" | "info"; text: string }
  | { type: "done"; terminal: "ask" | "present" | "propose" | "degraded" | "error" }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Client → server request
// ---------------------------------------------------------------------------

export const ExpertRequestSchema = z.object({
  sessionId: z.string().nullish(),
  lens: z.enum(EXPERT_LENS_IDS).nullish(),
  message: z.string().nullish(),
  /** Structured ops from the Portrait panel and product cards. */
  op: z
    .union([
      z.object({
        kind: z.literal("correct_fact"),
        factId: z.string(),
        newValue: z.string().nullish(),
        remove: z.boolean().nullish(),
      }),
      z.object({ kind: z.literal("revoke_consent"), category: z.string() }),
      /** "More like this" under a product card → similarity search on that product. */
      z.object({ kind: z.literal("more_like"), productId: z.string() }),
    ])
    .nullish(),
  /** Image for catalog visual similarity — the agent is told it has NOT seen it. */
  imageDataUrl: z.string().nullish(),
});
export type ExpertRequest = z.infer<typeof ExpertRequestSchema>;
