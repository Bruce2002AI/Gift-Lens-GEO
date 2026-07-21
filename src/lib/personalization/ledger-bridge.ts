import type {
  LedgerConstraints,
  LedgerFact,
  SessionLedger,
} from "@/lib/agent/types";
import { coerceValueForField } from "./coerce";
import { resolveFieldForKey } from "./schema";
import {
  formatFactValue,
  type FactSensitivity,
  type FactUpsert,
  type ProfileFact,
  type ProfileLens,
} from "./types";

/**
 * The bridge between durable profile facts and the agent's in-session ledger.
 *
 * This is the whole "the agent remembers you" mechanism, and it costs the LLM
 * nothing extra:
 *  - on session start we translate stored facts into ledger facts, and the
 *    prompt builder already serializes the ledger (see loop.ts "LEDGER FACTS"),
 *  - during the turn the model already emits `update_ledger` actions, and
 *  - at the end of the turn we translate the ledger back into stored facts.
 *
 * No summarization call, no embedding call, no extra round-trip. Memory is a
 * database concern, not a prompt-engineering one.
 *
 * Deliberately pure (no DB imports) so the mapping is unit-testable and the
 * only I/O lives in the repository.
 */

// ---------------------------------------------------------------------------
// Sensitivity classification
// ---------------------------------------------------------------------------

/**
 * Health-adjacent keys are auto-classified so voluntarily-shared medical
 * context never silently becomes ordinary cross-lens preference data. Being
 * conservative here is the safe direction: a mis-flagged colour preference
 * merely stays lens-local, whereas a mis-classified medical note would leak.
 */
const HEALTH_PATTERNS = [
  "allerg",
  "medic",
  "medication",
  "condition",
  "diagnos",
  "symptom",
  "health",
  "pregnan",
  "breastfeed",
  "sensitivit",
  "intoleran",
  "eczema",
  "psoriasis",
  "acne",
  "rosacea",
  "derma",
  "supplement",
  "dose",
  "dosage",
  "side_effect",
  "side effect",
];

/** Personal-but-not-medical signals that shouldn't default to cross-lens. */
const PERSONAL_PATTERNS = [
  "measurement",
  "size",
  "weight",
  "height",
  "waist",
  "chest",
  "bust",
  "hip",
  "inseam",
  "birthday",
  "anniversar",
  "household",
  "address",
  "age",
];

export function classifySensitivity(
  category: string,
  key: string,
  lens: ProfileLens,
): FactSensitivity {
  const hay = `${category} ${key}`.toLowerCase();
  if (HEALTH_PATTERNS.some((p) => hay.includes(p))) return "health";
  // Health lenses treat body/skin context as health data by default.
  if ((lens === "skincare" || lens === "nutrition") && /skin|diet|body|goal/.test(hay)) {
    return "health";
  }
  if (PERSONAL_PATTERNS.some((p) => hay.includes(p))) return "personal";
  return "standard";
}

// ---------------------------------------------------------------------------
// Key mapping: "recipient.loves" <-> { category: "recipient", key: "loves" }
// ---------------------------------------------------------------------------

export function splitLedgerKey(ledgerKey: string): {
  category: string;
  key: string;
} {
  const idx = ledgerKey.indexOf(".");
  if (idx <= 0 || idx === ledgerKey.length - 1) {
    return { category: "general", key: ledgerKey || "note" };
  }
  return {
    category: ledgerKey.slice(0, idx),
    key: ledgerKey.slice(idx + 1).replace(/\./g, "_"),
  };
}

export function joinLedgerKey(category: string, key: string): string {
  return `${category}.${key}`;
}

// ---------------------------------------------------------------------------
// Profile → Ledger (session hydration)
// ---------------------------------------------------------------------------

/**
 * Provenance mapping. Stored `behavioral`/`inferred` facts surface as
 * "inferred" so the agent keeps hedging them and the shopper can correct them,
 * exactly as it would for a guess made this session.
 */
function toProvenance(source: ProfileFact["source"]): LedgerFact["provenance"] {
  return source === "explicit" || source === "imported" ? "said" : "inferred";
}

/**
 * Structural constraints (budget, currency, country, postal code) are restored
 * separately by `constraintsFromFacts` and shown — formatted — in the portrait's
 * Constraints strip. They must NOT also surface as raw display facts, or the
 * budget shows up twice: once as a properly formatted "up to ₹5,000.00" and once
 * as the bare minor-unit amount ("500000").
 */
const CONSTRAINT_SLUGS = new Set([
  "budget.max_minor",
  "budget.min_minor",
  "budget.currency",
  "profile.currency",
  "profile.country",
  "profile.postal_code",
]);

/**
 * Translate stored facts into ledger facts for the prompt.
 *
 * `turn: 0` marks them as pre-existing knowledge — the loop's "learned this
 * session" logic keys on turn, so memory never masquerades as something the
 * shopper just said.
 */
export function factsToLedgerFacts(facts: ProfileFact[]): LedgerFact[] {
  // A lens fact and a shared fact can share a ledger key (both budget.max_minor,
  // say). Emitting both puts the same line in the prompt twice and invites the
  // model to treat one as a correction of the other, so the lens-specific value
  // wins — it is the more precise statement about this conversation.
  const bySlug = new Map<string, ProfileFact>();
  for (const f of facts) {
    const slug = joinLedgerKey(f.category, f.key);
    if (CONSTRAINT_SLUGS.has(slug)) continue; // surfaced via Constraints, not as a fact
    const prior = bySlug.get(slug);
    if (!prior || (prior.lens === "shared" && f.lens !== "shared")) {
      bySlug.set(slug, f);
    }
  }

  return [...bySlug.entries()].map(([slug, f], i) => ({
    id: `m${i + 1}`,
    key: slug,
    value: formatFactValue(f.value),
    provenance: toProvenance(f.source),
    quote: f.quote,
    turn: 0,
  }));
}

/** Budget/currency/country restored from the shared profile. */
export function constraintsFromFacts(
  facts: ProfileFact[],
  base: LedgerConstraints,
): LedgerConstraints {
  const find = (category: string, key: string) =>
    facts.find((f) => f.category === category && f.key === key)?.value;

  const maxMinor = find("budget", "max_minor");
  const minMinor = find("budget", "min_minor");
  const currency = find("budget", "currency") ?? find("profile", "currency");
  const country = find("profile", "country");
  const postalCode = find("profile", "postal_code");

  return {
    ...base,
    budgetMaxMinor:
      typeof maxMinor === "number" && base.budgetMaxMinor == null
        ? maxMinor
        : base.budgetMaxMinor,
    budgetMinMinor:
      typeof minMinor === "number" && base.budgetMinMinor == null
        ? minMinor
        : base.budgetMinMinor,
    currency: typeof currency === "string" && currency ? currency : base.currency,
    country:
      typeof country === "string" && country && base.country == null
        ? country
        : base.country,
    postalCode:
      typeof postalCode === "string" && postalCode && base.postalCode == null
        ? postalCode
        : base.postalCode,
  };
}

/**
 * Hydrate a fresh session's ledger from the stored profile.
 *
 * Mutates in place (the session object is the loop's working memory) and skips
 * any key the session already holds, so a fact stated THIS turn always wins
 * over the remembered version.
 */
export function hydrateLedger(ledger: SessionLedger, facts: ProfileFact[]): void {
  const existing = new Set(ledger.facts.map((f) => f.key));
  const hydrated = factsToLedgerFacts(facts).filter((f) => !existing.has(f.key));
  ledger.facts = [...hydrated, ...ledger.facts];
  ledger.constraints = constraintsFromFacts(facts, ledger.constraints);
}

// ---------------------------------------------------------------------------
// Ledger → Profile (turn persistence)
// ---------------------------------------------------------------------------

/**
 * Which ledger facts are worth persisting.
 *
 * `turn: 0` facts came FROM the profile, so re-writing them would be a no-op
 * write on every turn. "assumed" facts are the model's weakest guesses and are
 * deliberately not persisted — a throwaway assumption should not harden into
 * long-term memory the shopper then has to go and delete.
 */
export function ledgerFactsToUpserts(
  ledger: SessionLedger,
  /** Fallback for facts recorded before lens tagging existed. */
  lens: ProfileLens,
): FactUpsert[] {
  const out: FactUpsert[] = [];
  const seen = new Set<string>();

  for (const f of ledger.facts) {
    if (f.turn === 0) continue;
    if (f.provenance === "assumed") continue;
    if (!f.value || !f.value.trim()) continue;

    // A session can switch lenses mid-chat, so each fact is filed under the
    // lens it was LEARNED under — not whichever lens happens to be active now.
    const factLens: ProfileLens = f.lens ?? lens;

    // Snap the model's slug onto a real form field when one matches, so what
    // the agent learns shows up in the control the shopper can edit rather
    // than as an orphan row. Unmatched facts are still stored verbatim.
    const field = resolveFieldForKey(factLens, f.key);
    const { category, key } = field
      ? { category: field.category, key: field.key }
      : splitLedgerKey(f.key);
    // A field that resolved to the shared scope belongs there, not in the lens.
    const targetLens: ProfileLens = field ? field.lens : factLens;
    // Identity includes the lens: the same key legitimately exists per lens.
    const identity = `${targetLens}.${category}.${key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    // Canonicalize onto the field's real type: a tag list becomes an array, a
    // money slider becomes minor units, a switch becomes a boolean. Without
    // this a budget stated as "5000 rupees" would be stored as ₹50.
    const value = field ? coerceValueForField(field, f.value) : f.value;
    if (value === null || value === "") continue;

    const explicit = f.provenance === "said";
    out.push({
      lens: targetLens,
      category,
      key,
      value,
      source: explicit ? "explicit" : "inferred",
      confidence: explicit ? 1 : 0.5,
      // The schema's own declaration wins: it knows a field is health data
      // even when the key's wording wouldn't give it away.
      sensitivity: field?.sensitivity ?? classifySensitivity(category, key, targetLens),
      // Nothing crosses lenses without the shopper saying so in the
      // Personalization Center. Lens-local is the only safe default.
      consentScope: "lens_only",
      quote: f.quote ?? null,
    });
  }
  return out;
}

/** Persist budget/country to the shared profile so every lens can reuse them. */
export function constraintsToUpserts(
  constraints: LedgerConstraints,
): FactUpsert[] {
  const out: FactUpsert[] = [];
  const base = {
    lens: "shared" as const,
    source: "explicit" as const,
    confidence: 1,
    sensitivity: "standard" as const,
    consentScope: "approved_cross_lens" as const,
    quote: null,
  };
  if (constraints.budgetMaxMinor != null) {
    out.push({ ...base, category: "budget", key: "max_minor", value: constraints.budgetMaxMinor });
  }
  if (constraints.budgetMinMinor != null) {
    out.push({ ...base, category: "budget", key: "min_minor", value: constraints.budgetMinMinor });
  }
  // `currency` is never null — newSession seeds it with a default — so writing
  // it unconditionally would store a currency the shopper never chose as an
  // "explicit" fact. Only persist it alongside a budget they actually stated.
  const budgetStated =
    constraints.budgetMaxMinor != null || constraints.budgetMinMinor != null;
  if (constraints.currency && budgetStated) {
    out.push({ ...base, category: "budget", key: "currency", value: constraints.currency });
  }
  if (constraints.country) {
    out.push({ ...base, category: "profile", key: "country", value: constraints.country });
  }
  if (constraints.postalCode) {
    out.push({ ...base, category: "profile", key: "postal_code", value: constraints.postalCode });
  }
  return out;
}

// ---------------------------------------------------------------------------
// "Personalized because…" — what memory actually shaped this answer
// ---------------------------------------------------------------------------

export interface PersonalizationSignal {
  factId: string;
  label: string;
  value: string;
  source: ProfileFact["source"];
  needsConfirmation: boolean;
}

/** Turn "recipient.loves" into "Recipient loves" for display. */
export function humanizeKey(category: string, key: string): string {
  const words = `${category} ${key}`.replace(/[._-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The handful of stored signals most likely to have shaped this turn's picks,
 * for the compact "Personalized because…" strip. Explicit + confident facts
 * lead, because those are the ones a shopper will recognise as their own.
 */
export function personalizationSignals(
  facts: ProfileFact[],
  limit = 4,
): PersonalizationSignal[] {
  // Structural constraints (budget/currency/country) belong in the formatted
  // Constraints strip, not here — otherwise the strip shows "Budget max minor:
  // 500000" instead of a real preference signal.
  const meaningful = facts.filter(
    (f) => !CONSTRAINT_SLUGS.has(joinLedgerKey(f.category, f.key)),
  );
  const ranked = [...meaningful].sort((a, b) => {
    const rank = (f: ProfileFact) => (f.source === "explicit" ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  return ranked.slice(0, limit).map((f) => ({
    factId: f.id,
    label: humanizeKey(f.category, f.key),
    value: formatFactValue(f.value),
    source: f.source,
    needsConfirmation: f.source !== "explicit" && !f.lastConfirmedAt,
  }));
}
