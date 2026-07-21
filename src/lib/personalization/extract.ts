import { fieldsForLens } from "./schema";
import type { FactUpsert, ProfileLens } from "./types";

/**
 * Deterministic form-filling from the shopper's own words.
 *
 * The agent records what it understands via `update_ledger`, but that is a
 * best-effort behaviour: on a busy turn (care flags, safety framing, a long
 * search plan) the model reliably prioritises answering over bookkeeping, and
 * plainly-stated facts go unrecorded. Waiting for the model to be perfect
 * would mean the form only half-fills.
 *
 * So code does the easy half. Every option-driven field in the schema declares
 * its vocabulary, which makes literal matching safe and free: if the shopper
 * writes "my skin is oily" and `skin.type` offers "Oily", that is not a guess
 * about meaning, it is a word match.
 *
 * Two rules keep this honest:
 *  - everything extracted here is stored as `inferred`, so it renders with an
 *    "Inferred" badge and Confirm / Edit / Delete — never as if the shopper
 *    filled the form themselves, and
 *  - it only ever fills BLANK fields; the repository additionally refuses to
 *    let an inferred write overwrite an explicit answer.
 */

/** Options too generic to match on without inviting false positives. */
const AMBIGUOUS = new Set([
  "none",
  "no preference",
  "normal",
  "fine",
  "balanced",
  "moderate",
  "regular",
  "other",
  "email",
  "adult",
  "child",
  "weekly",
  "rarely",
  "beginner",
]);

/** Confidence for a literal word match — high enough to show, low enough to hedge. */
const MATCH_CONFIDENCE = 0.6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word, case-insensitive containment.
 *
 * Multi-word options ("Smart casual") match as a phrase, and a trailing plural
 * is tolerated so "I prefer serums" still matches the option "Serum". The
 * boundaries are what keep this safe — "Formal" must never fire on
 * "informally", which a bare substring check would.
 */
function mentions(haystack: string, needle: string): boolean {
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(s|es)?([^\\p{L}\\p{N}]|$)`,
    "iu",
  );
  return re.test(haystack);
}

/**
 * Scan a message for values that match a lens's option-driven fields.
 *
 * `alreadyFilled` holds `category.key` identities we already hold, so this only
 * ever fills gaps. Returns upserts ready for the repository.
 */
export function extractFieldsFromText(
  lens: ProfileLens,
  text: string,
  alreadyFilled: ReadonlySet<string> = new Set(),
): FactUpsert[] {
  const message = text.trim();
  if (message.length < 3) return [];

  const out: FactUpsert[] = [];

  for (const field of fieldsForLens(lens)) {
    const optioned =
      field.control === "chips" ||
      field.control === "multichips" ||
      field.control === "choice";
    if (!optioned || !field.options?.length) continue;
    if (alreadyFilled.has(`${field.category}.${field.key}`)) continue;

    const hits = field.options.filter((opt) => {
      const o = opt.toLowerCase();
      if (AMBIGUOUS.has(o)) return false;
      if (o.length < 3) return false;
      // Options often carry a parenthetical ("Minimal (2-3 steps)") — match on
      // the meaningful head, not the annotation.
      const head = opt.split("(")[0].trim();
      return mentions(message, head.length >= 3 ? head : opt);
    });
    if (hits.length === 0) continue;

    // Single-value controls take the first match only; a message naming two
    // mutually exclusive options is ambiguous, so we take none.
    if (field.control !== "multichips" && hits.length > 1) continue;

    out.push({
      lens: field.lens,
      category: field.category,
      key: field.key,
      value: field.control === "multichips" ? hits : hits[0],
      source: "inferred",
      confidence: MATCH_CONFIDENCE,
      sensitivity: field.sensitivity ?? "standard",
      // Never opt into cross-lens sharing on the shopper's behalf.
      consentScope: "lens_only",
      quote: null,
    });
  }

  out.push(...extractAllergies(lens, message, alreadyFilled));

  return out;
}

/**
 * Trigger phrases for an allergy/intolerance/reaction. The capture group is the
 * offending thing; a following clause boundary ends it.
 */
const ALLERGY_TRIGGERS: RegExp[] = [
  /\ballergic to (.+?)(?:[.,;!?]|$)/i,
  /\ballergy to (.+?)(?:[.,;!?]|$)/i,
  /\bintolerant to (.+?)(?:[.,;!?]|$)/i,
  /\bcan'?t (?:eat|have|use|tolerate) (.+?)(?:[.,;!?]|$)/i,
  /\bsensitive to (.+?)(?:[.,;!?]|$)/i,
];

/** "fragrance makes me itch" — 1-4 words immediately before the reaction verb. */
const REACTION_RE =
  /(?:^|[.,;!?]\s*|\band\s+)([\p{L}][\p{L} ]{1,40}?)\s+(?:makes? me|gives me|leaves me)\s+(?:itch|itchy|break out|breakout|react|a rash|hives|irritated|inflamed|red|bloated|sick|nauseous|congested)/giu;

/** Words that follow a trigger but aren't an allergen. */
const NON_ALLERGEN = new Set([
  "it",
  "them",
  "this",
  "that",
  "anything",
  "everything",
  "much",
  "being",
  "waiting",
  "you",
]);

/**
 * Deterministically capture allergies/reactions from free text.
 *
 * These are the highest-stakes facts in the whole system — a stored allergy is
 * a hard exclusion the agent must respect — so leaving them to the model alone
 * is the weakest link. Everything found is `inferred` and lens-local, so a
 * false positive is a chip the shopper deletes, never a silent hard rule.
 * Runs only for lenses that actually have an allergies field.
 */
function extractAllergies(
  lens: ProfileLens,
  message: string,
  alreadyFilled: ReadonlySet<string>,
): FactUpsert[] {
  const field = fieldsForLens(lens).find(
    (f) => f.category === "allergies" && f.key === "list",
  );
  if (!field) return [];
  if (alreadyFilled.has("allergies.list")) return [];

  const found: string[] = [];
  const take = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(/[,;]|\band\b/gi)) {
      const item = part
        .trim()
        .replace(/^(any|some|all|the|a|an)\s+/i, "")
        .replace(/\s+/g, " ");
      const lower = item.toLowerCase();
      // Reject if the whole phrase, or its first word, is a non-allergen —
      // "being late" starts with "being", a verb, not a substance.
      const head = lower.split(" ")[0];
      if (
        item.length >= 2 &&
        item.length <= 40 &&
        !NON_ALLERGEN.has(lower) &&
        !NON_ALLERGEN.has(head)
      ) {
        found.push(item);
      }
    }
  };

  for (const re of ALLERGY_TRIGGERS) {
    const m = message.match(re);
    if (m) take(m[1]);
  }
  for (const m of message.matchAll(REACTION_RE)) take(m[1]);

  if (found.length === 0) return [];
  const deduped = [...new Map(found.map((f) => [f.toLowerCase(), f])).values()];

  return [
    {
      lens: field.lens,
      category: "allergies",
      key: "list",
      value: deduped,
      source: "inferred",
      confidence: MATCH_CONFIDENCE,
      // Always health, always lens-local — this is exactly the data that must
      // never cross a lens.
      sensitivity: "health",
      consentScope: "lens_only",
      quote: null,
    },
  ];
}
