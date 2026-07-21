import { z } from "zod";
import { EXPERT_LENS_IDS } from "@/lib/agent/types";

/**
 * The personalization contract.
 *
 * Design note — why an extensible fact model instead of columns:
 * personalization vocabulary grows constantly (a new lens, a new question, a
 * new inferred signal). Rigid columns would mean a migration per idea. A
 * `(lens, category, key) → value` fact carries its own provenance, confidence,
 * sensitivity and consent, so new signals are data, not schema changes.
 *
 * Design note — why this costs the LLM nothing:
 * the agent ALREADY emits `update_ledger` facts during a normal turn. We
 * persist those and rehydrate them next session. No extra model call is made
 * to "remember" anything; memory is a database concern, not a prompt concern.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** Facts either belong to one lens or to the shared cross-lens profile. */
export const PROFILE_LENSES = [...EXPERT_LENS_IDS, "shared"] as const;
export type ProfileLens = (typeof PROFILE_LENSES)[number];

export function isProfileLens(v: string | null | undefined): v is ProfileLens {
  return PROFILE_LENSES.includes(v as ProfileLens);
}

// ---------------------------------------------------------------------------
// Subjects — WHO a fact is about
// ---------------------------------------------------------------------------

/**
 * A "subject" is the person a conversation (and its profile) is about. By
 * default that is the account owner — the reserved id `self`. When the shopper
 * talks about someone else ("a gift for my dad Rajesh", "a routine for Anaya"),
 * that person becomes a subject with their own id, and their facts live under
 * it. This is what keeps shopping for a sister from ever getting mixed up with
 * shopping for a manager — the fact identity carries the subject.
 */
export const SELF_SUBJECT_ID = "self";

/** How a subject came to exist. Agent-created ones are labelled in the UI. */
export const SUBJECT_ORIGINS = ["user", "agent"] as const;
export type SubjectOrigin = (typeof SUBJECT_ORIGINS)[number];

export type SubjectKind = "self" | "person";

export interface ProfileSubject {
  id: string;
  userId: string;
  /** Stable per-user slug. Always `self` for the account owner. */
  subjectId: string;
  kind: SubjectKind;
  /** Display name — "You" for self, "Rajesh", "Priya"… */
  name: string;
  /** Relationship to the account owner, e.g. "dad", "sister". Null for self. */
  relationship: string | null;
  createdBy: SubjectOrigin;
  /** A denormalized preview (interests, dislikes…) for the switcher subtitle. */
  data: Record<string, FactValue>;
  createdAt: string;
  updatedAt: string;
}

/** The always-present account-owner subject, materialized for lists/prompts. */
export function selfSubject(userId: string): ProfileSubject {
  return {
    id: SELF_SUBJECT_ID,
    userId,
    subjectId: SELF_SUBJECT_ID,
    kind: "self",
    name: "You",
    relationship: null,
    createdBy: "user",
    data: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Normalize a name into a stable per-user subject id. Deterministic (so the
 * same name resolves to the same subject across turns) and collision-tolerant:
 * two genuinely different people who share a name would share a profile, which
 * the shopper can split by renaming — far better than silently minting a new,
 * empty profile every time a common name recurs.
 */
export function subjectIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "person";
}

/** Human labels for the lens tabs. Keeps UI copy in one place. */
export const LENS_LABELS: Record<ProfileLens, string> = {
  shared: "Shared",
  gift: "Gift",
  skincare: "Skincare & Supplements",
  style: "Fashion",
  nutrition: "Nutrition",
};

// ---------------------------------------------------------------------------
// Fact taxonomy
// ---------------------------------------------------------------------------

/**
 * How we came to believe a fact.
 *  - explicit:   the shopper stated/selected it
 *  - imported:   pulled from another system (order history, connected account)
 *  - behavioral: derived from what they did (saved, rejected, purchased)
 *  - inferred:   the agent's guess — always rendered hedged + correctable
 */
export const FACT_SOURCES = ["explicit", "imported", "behavioral", "inferred"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/**
 * Sensitivity drives default visibility.
 *  - standard: ordinary preference (colour, budget)
 *  - personal: identifying-ish (measurements, important dates, household)
 *  - health:   voluntarily-shared health context. Hidden by default in the UI
 *              and NEVER crosses lenses without an explicit opt-in.
 */
export const FACT_SENSITIVITIES = ["standard", "personal", "health"] as const;
export type FactSensitivity = (typeof FACT_SENSITIVITIES)[number];

/** Whether a fact may inform other lenses. Defaults to lens_only. */
export const CONSENT_SCOPES = ["lens_only", "approved_cross_lens"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface ProfileFact {
  id: string;
  userId: string;
  /** WHO this fact is about — `self` (the account owner) or a person's id. */
  subjectId: string;
  lens: ProfileLens;
  /** Grouping within a lens, e.g. "budget", "allergies", "fit", "recipient". */
  category: string;
  /** Stable slug within the category, e.g. "max_minor", "dislikes". */
  key: string;
  /** Arbitrary JSON — string, number, boolean, or array of strings. */
  value: FactValue;
  source: FactSource;
  /** 0–1. Explicit answers are 1; inferred signals start lower. */
  confidence: number;
  sensitivity: FactSensitivity;
  consentScope: ConsentScope;
  /** The shopper's own words, when they said it — shown when confirming. */
  quote: string | null;
  lastConfirmedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Values are intentionally simple so they render without bespoke components. */
export const FactValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export type FactValue = z.infer<typeof FactValueSchema>;

// ---------------------------------------------------------------------------
// Structured records (lists that don't fit a single key→value fact)
// ---------------------------------------------------------------------------

/**
 * Record kinds:
 *  - recipient      (Gift)       who you shop for
 *  - wardrobe_item  (Fashion)    what you already own
 *  - supplement     (Skincare)   your current stack
 *  - pantry_item    (Nutrition)  what's in the kitchen
 *  - household      (Nutrition)  who you cook for
 *  - meal_preference(Nutrition)  liked/disliked dishes & cuisines
 */
export const RECORD_KINDS = [
  "recipient",
  "wardrobe_item",
  "supplement",
  "pantry_item",
  "household",
  "meal_preference",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** Which lens owns each record kind — enforced server-side, not just in UI. */
export const RECORD_KIND_LENS: Record<RecordKind, ProfileLens> = {
  recipient: "gift",
  wardrobe_item: "style",
  supplement: "skincare",
  pantry_item: "nutrition",
  household: "nutrition",
  meal_preference: "nutrition",
};

export interface ProfileRecord {
  id: string;
  userId: string;
  lens: ProfileLens;
  kind: RecordKind;
  /** Display name, e.g. "Mum", "Navy linen shirt", "Vitamin D3". */
  label: string;
  /** Kind-specific payload (relationship, size, dose, timing…). */
  data: Record<string, FactValue>;
  sensitivity: FactSensitivity;
  consentScope: ConsentScope;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Outcomes — how the system learns without asking the model anything
// ---------------------------------------------------------------------------

export const OUTCOMES = [
  "liked",
  "rejected",
  "purchased",
  "returned",
  "kept",
  "used",
  "tolerated",
  "completed",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that should make us favour a product's attributes in future. */
export const POSITIVE_OUTCOMES: readonly Outcome[] = [
  "liked",
  "purchased",
  "kept",
  "used",
  "tolerated",
  "completed",
];

export interface OutcomeEvent {
  id: string;
  userId: string;
  lens: ProfileLens;
  productId: string;
  productTitle: string | null;
  outcome: Outcome;
  /** Optional free-text reason, e.g. a return reason. */
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Wire validation (API boundary)
// ---------------------------------------------------------------------------

export const FactUpsertSchema = z.object({
  /** WHO the fact is about. Omitted → the account owner (`self`). */
  subjectId: z.string().min(1).max(64).optional(),
  lens: z.enum(PROFILE_LENSES),
  category: z.string().min(1).max(60),
  key: z.string().min(1).max(60),
  value: FactValueSchema,
  source: z.enum(FACT_SOURCES).default("explicit"),
  confidence: z.number().min(0).max(1).default(1),
  sensitivity: z.enum(FACT_SENSITIVITIES).default("standard"),
  consentScope: z.enum(CONSENT_SCOPES).default("lens_only"),
  quote: z.string().max(500).nullish(),
  /** ISO date; omit for facts that never expire. */
  expiresAt: z.string().datetime().nullish(),
});
export type FactUpsert = z.infer<typeof FactUpsertSchema>;

export const FactPatchSchema = z.object({
  value: FactValueSchema.optional(),
  consentScope: z.enum(CONSENT_SCOPES).optional(),
  sensitivity: z.enum(FACT_SENSITIVITIES).optional(),
  /** Confirming an inferred fact promotes it to explicit with full confidence. */
  confirm: z.boolean().optional(),
});
export type FactPatch = z.infer<typeof FactPatchSchema>;

export const RecordUpsertSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  label: z.string().min(1).max(120),
  data: z.record(z.string(), FactValueSchema).default({}),
  sensitivity: z.enum(FACT_SENSITIVITIES).default("standard"),
  consentScope: z.enum(CONSENT_SCOPES).default("lens_only"),
});
export type RecordUpsert = z.infer<typeof RecordUpsertSchema>;

export const SubjectCreateSchema = z.object({
  name: z.string().min(1).max(80),
  relationship: z.string().max(60).nullish(),
});
export type SubjectCreate = z.infer<typeof SubjectCreateSchema>;

export const OutcomeCreateSchema = z.object({
  lens: z.enum(PROFILE_LENSES),
  productId: z.string().min(1).max(300),
  productTitle: z.string().max(300).nullish(),
  outcome: z.enum(OUTCOMES),
  note: z.string().max(500).nullish(),
});
export type OutcomeCreate = z.infer<typeof OutcomeCreateSchema>;

// ---------------------------------------------------------------------------
// Consent / visibility rules — enforced in ONE place so UI and agent agree
// ---------------------------------------------------------------------------

/**
 * Can a fact owned by `fact.lens` inform work in `targetLens`?
 *
 * Rules, in order:
 *  1. Shared-profile facts inform every lens (that's what "shared" means).
 *  2. A fact always informs its own lens.
 *  3. Anything else requires an explicit `approved_cross_lens` opt-in.
 *  4. Health data additionally NEVER crosses lenses — opting in to cross-lens
 *     sharing for a health fact is possible, but rule 4 is applied first for
 *     any lens the fact does not belong to, so health stays put unless the
 *     shopper both marks it cross-lens AND it is not health-sensitive.
 *
 * Keeping this a pure function means the API, the Personalization Center and
 * the agent's hydration all obey identical rules — no drift.
 */
export function factVisibleToLens(
  fact: Pick<ProfileFact, "lens" | "consentScope" | "sensitivity">,
  targetLens: ProfileLens,
): boolean {
  if (fact.lens === targetLens) return true;
  if (fact.lens === "shared") {
    // Shared health data still requires an explicit cross-lens opt-in.
    return fact.sensitivity !== "health" || fact.consentScope === "approved_cross_lens";
  }
  if (fact.sensitivity === "health") return false;
  return fact.consentScope === "approved_cross_lens";
}

/** Facts that expired are treated as absent without needing a sweep job. */
export function factIsLive(
  fact: Pick<ProfileFact, "expiresAt">,
  now: number = Date.now(),
): boolean {
  if (!fact.expiresAt) return true;
  const t = Date.parse(fact.expiresAt);
  return Number.isNaN(t) || t > now;
}

/** Inferred/low-confidence facts render hedged and ask for confirmation. */
export function needsConfirmation(
  fact: Pick<ProfileFact, "source" | "confidence" | "lastConfirmedAt">,
): boolean {
  if (fact.lastConfirmedAt) return false;
  return fact.source === "inferred" || fact.source === "behavioral" || fact.confidence < 0.7;
}

/** Render a fact value for display without leaking JSON syntax. */
export function formatFactValue(value: FactValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
