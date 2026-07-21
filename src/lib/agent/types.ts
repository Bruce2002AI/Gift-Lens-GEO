import { z } from "zod";
import type {
  CatalogSource,
  NormalizedImage,
  NormalizedOption,
  NormalizedProduct,
  NormalizedRating,
  NormalizedSeller,
  NormalizedSpec,
} from "@/lib/catalog/types";

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
// Subjects — who a conversation is about (self, or a named person)
// ---------------------------------------------------------------------------

/** A client-safe subject summary — powers the sidebar profile switcher. */
export interface SubjectSummary {
  subjectId: string;
  name: string;
  relationship: string | null;
  kind: "self" | "person";
  createdBy: "user" | "agent";
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
  /**
   * The lens this was learned under. A session can switch lenses mid-chat, so
   * without this the whole accumulated ledger would be persisted under whatever
   * lens happens to be active at the end of the turn.
   * Absent on facts hydrated from storage (they are never re-persisted).
   */
  lens?: ExpertLensId;
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
  /**
   * The signed-in shopper this session belongs to (null when anonymous).
   * Bound on first use; a request presenting this session id under a DIFFERENT
   * user is never allowed to adopt it, because the ledger may already hold the
   * first shopper's remembered profile.
   */
  userId: string | null;
  /**
   * WHO this conversation is currently about — `self` (the account owner) by
   * default, or a person's subject id once the shopper names someone. Facts are
   * hydrated and persisted under this subject, so the picks are for THEM.
   */
  activeSubjectId: string;
  /**
   * The turn the ACTIVE subject was activated on. Signals derived from the
   * shopper's words (e.g. gender from pronouns) must count only messages from
   * this turn onward — the transcript survives a subject switch, so an earlier
   * person's "she loves…" must not leak into the current recipient's read.
   */
  subjectActivatedTurn: number;
  /**
   * The shopper's known people (self excluded is fine — the UI prepends it),
   * cached so the prompt can list "profiles you can switch to" and the loop can
   * resolve a mid-chat name without a DB hit. Refreshed each turn.
   */
  knownSubjects: SubjectSummary[];
  /**
   * Lenses whose stored profile has been loaded into this session's ledger FOR
   * THE ACTIVE SUBJECT. Reset when the subject switches, so the new person's
   * memory is loaded rather than the previous one's reused.
   */
  hydratedLenses: ExpertLensId[];
  /**
   * Facts the shopper explicitly removed via the Portrait panel this session,
   * each tagged with the lens it was learned in. Persistence is otherwise
   * additive, so without this a deleted fact reappears next session — and the
   * lens tag is essential: allergies.list is a DIFFERENT fact per lens, so the
   * delete must be scoped, never applied across every lens.
   */
  removedFactKeys: Array<{ lens: ExpertLensId; key: string }>;
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
   * Content identities (title-normalized) of everything boarded this session.
   * The catalog is multi-merchant, so the SAME product relisted by a second
   * seller has a different id but the same identity — this stops that relisting
   * from filling a new board slot across turns. See `productIdentityKey`.
   */
  boardedIdentities: Set<string>;
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

export const ForkSchema = z.object({
  ifA: z.string(),
  thenA: z.string(),
  ifB: z.string(),
  thenB: z.string(),
});
export type Fork = z.infer<typeof ForkSchema>;

export const SearchSpecSchema = z.object({
  query: z.string(),
  maxPriceMinor: z.number().nullish(),
  likeProductId: z.string().nullish(),
  /** Catalog visual similarity against the user's uploaded image (agent hasn't seen it). */
  useUploadedImage: z.boolean().nullish(),
});
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
  text: z.string(),
  fork: ForkSchema.nullish(),
  quickReplies: z.array(z.string()).nullish(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const PresentationSchema = z.object({
  message: z.string(),
  layout: z.enum(["picks", "plan", "single", "comparison"]),
  assumptions: z.array(z.string()).nullish(),
  sections: z.array(PresentSectionSchema),
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

const ActionObjectSchema = z.object({
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

/**
 * Some models (notably small/fast ones) drop the "action" discriminator and
 * return just the payload — e.g. `{"presentation": {...}}` with no action.
 * Infer the missing action from the shape so a perfectly good present/search
 * isn't lost to a missing field. Most specific fields win.
 */
function inferAction(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  if (typeof o.action === "string" && (ACTION_KINDS as readonly string[]).includes(o.action)) return v;
  if (o.presentation != null) o.action = "present";
  else if (o.queries != null) o.action = "search_catalog";
  else if (o.productIds != null || o.productId != null) o.action = "get_product";
  else if (o.summary != null && o.sections != null) o.action = "propose_direction";
  else if (o.facts != null || o.constraints != null || o.consent != null || o.careFlagAdd != null)
    o.action = "update_ledger";
  else if (o.fork != null || o.quickReplies != null) o.action = "ask_user";
  else if (typeof o.text === "string") o.action = "say";
  return v;
}

export const ActionSchema = z.preprocess(inferAction, ActionObjectSchema);
export type AgentAction = z.infer<typeof ActionObjectSchema>;

// ---------------------------------------------------------------------------
// Verified (server-notarized) presentation — what the UI actually receives
// ---------------------------------------------------------------------------

export interface VerifiedClaim {
  text: string;
  field: string;
  quote: string;
}

/** One purchasable variant, with every buying signal UCP returns for it. */
export interface ProductFactsVariant {
  id: string;
  title: string;
  sku: string | null;
  priceMinor: number | null;
  currency: string | null;
  available: boolean | null;
  availabilityStatus: string | null;
  runningLow: boolean | null;
  requiresShipping: boolean | null;
  nativeCheckoutEligible: boolean | null;
  url: string | null;
  imageUrl: string | null;
  options: Array<{ name: string; label: string }>;
  /** e.g. ["new"] / ["refurbished"]. */
  condition: string[];
  /** Variants carry their own rating, often differing from the product's. */
  rating: NormalizedRating;
  description: string;
  /** True for the variant this card's price/offer was derived from. */
  isSelected: boolean;
}

/**
 * The complete catalog record for a product, exactly as UCP returned it.
 *
 * This is a DIFFERENT stratum from `claims`: claims are model-authored
 * sentences that the truth layer verifies against evidence, whereas these are
 * raw catalog facts with no model involvement at all. That's why they can be
 * rendered verbatim — there is nothing here for a model to have invented.
 */
export interface ProductFacts {
  description: string;
  handle: string | null;
  categories: string[];
  rating: NormalizedRating;
  /** `metadata.tech_specs` parsed into label/value pairs. */
  specs: NormalizedSpec[];
  topFeatures: string[];
  uniqueSellingPoints: string[];
  images: NormalizedImage[];
  options: NormalizedOption[];
  variants: ProductFactsVariant[];
  seller: NormalizedSeller | null;
  priceRange: {
    minMinor: number | null;
    maxMinor: number | null;
    currency: string | null;
  };
  /** Availability rollup so the UI can show "3 of 5 in stock" without recomputing. */
  inStockVariants: number;
  totalVariants: number;
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
  /** Full catalog record, powering the expandable "Everything the catalog knows" panel. */
  facts: ProductFacts;
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
  /** Full catalog record — board items expand to the same detail as picks. */
  facts: ProductFacts;
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
  /**
   * Who the conversation is about, and the profiles available to switch to.
   * `announce` is set when THIS turn switched or created a subject, so the UI
   * can surface "Now shopping for Rajesh (new profile)".
   */
  | {
      type: "subjects";
      active: string;
      list: SubjectSummary[];
      announce: { subjectId: string; name: string; created: boolean } | null;
      /** True when the products already on the board were for the PREVIOUS
       *  subject and should be cleared (a pre-turn switch), false when they
       *  belong to the subject just activated (a mid-turn backstop switch). */
      staleBoard: boolean;
    }
  | { type: "say"; text: string }
  | { type: "trace"; kind: "search" | "inspect" | "note"; label: string; detail?: string; ok?: boolean }
  | { type: "ledger"; view: LedgerView }
  | { type: "care"; text: string; flags: string[] }
  | { type: "ask"; text: string; fork: Fork | null; quickReplies: string[] }
  | { type: "propose"; summary: string; sections: Array<{ title: string; detail: string }> }
  | { type: "present"; presentation: VerifiedPresentation }
  | { type: "limitation"; text: string }
  /**
   * Profile fields the agent just learned, pushed so the always-visible form
   * fills itself mid-conversation. Structurally identical to ProfileFact —
   * declared inline because personalization/types imports from this module,
   * and importing it back would be a cycle.
   */
  | {
      type: "profile";
      facts: Array<{
        id: string;
        subjectId: string;
        lens: string;
        category: string;
        key: string;
        value: string | number | boolean | string[];
        source: "explicit" | "imported" | "behavioral" | "inferred";
        confidence: number;
        sensitivity: "standard" | "personal" | "health";
        consentScope: "lens_only" | "approved_cross_lens";
        quote: string | null;
        lastConfirmedAt: string | null;
        expiresAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }
  /** Remembered profile signals shaping this turn — powers "Personalized because…". */
  | {
      type: "personalization";
      signals: Array<{
        factId: string;
        label: string;
        value: string;
        source: "explicit" | "imported" | "behavioral" | "inferred";
        needsConfirmation: boolean;
      }>;
    }
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
  /**
   * Switch the active profile. `id` picks an existing subject (or "self");
   * `name` (no id) creates a new person profile. Sent by the sidebar switcher
   * and the "New profile" control, and can accompany a message or stand alone.
   */
  setSubject: z
    .object({
      id: z.string().max(64).nullish(),
      name: z.string().max(80).nullish(),
      relationship: z.string().max(60).nullish(),
    })
    .nullish(),
});
export type ExpertRequest = z.infer<typeof ExpertRequestSchema>;
