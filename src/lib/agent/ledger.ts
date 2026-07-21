import type { BaseIntent } from "@/lib/modes/types";
import { detectCareFlags, hedgeInferredValue } from "./safety";
import { SELF_SUBJECT_ID } from "@/lib/personalization/types";
import type {
  AgentSession,
  CareFlag,
  ExpertLensId,
  ExpertRequest,
  LedgerFact,
  LedgerView,
  SessionLedger,
} from "./types";

/**
 * Session Ledger mechanics: provenance-tagged facts, sticky care flags,
 * quoted consents, and the BaseIntent adapter that lets the truth layer reuse
 * checkHardConstraints unchanged.
 */

/** Fact ids are session-scoped: a module counter would recycle ids on restart. */
function nextFactId(session: AgentSession): string {
  session.factSeq += 1;
  return `${session.id.slice(0, 8)}-f${session.factSeq}`;
}

export function newSession(id: string, lens: ExpertLensId): AgentSession {
  return {
    id,
    lens,
    turn: 0,
    createdAtMs: Date.now(),
    userId: null,
    activeSubjectId: SELF_SUBJECT_ID,
    subjectActivatedTurn: 0,
    knownSubjects: [],
    hydratedLenses: [],
    removedFactKeys: [],
    transcript: [],
    ledger: {
      facts: [],
      constraints: {
        budgetMaxMinor: null,
        budgetMinMinor: null,
        currency: "INR",
        country: null,
        postalCode: null,
        deadline: null,
        exclusions: [],
      },
      careFlags: [],
      consents: [],
      askedQuestions: [],
      searchQueries: [],
    },
    evidence: new Map(),
    candidates: new Map(),
    searchHits: new Map(),
    boardedIds: new Set(),
    boardedIdentities: new Set(),
    budgetScreenedCap: new Map(),
    uploadedImage: null,
    outfitRead: null,
    sawMock: false,
    mockAnnounced: false,
    framedLenses: [],
    questionCount: 0,
    factSeq: 0,
  };
}

/**
 * Re-point the session at a different subject (person or `self`).
 *
 * Facts and the subject-specific shopping constraints (budget, deadline,
 * exclusions) describe the PREVIOUS person, so they are cleared and the caller
 * re-hydrates the new subject straight after. The product caches are cleared
 * too: a shirt found for Rajesh must never resurface as a pick for Priya.
 *
 * What stays is account-level or safety context: currency/country, care flags
 * (safety is sticky and must not regress on a switch) and consents. Returns
 * whether the subject actually changed.
 */
export function switchSubject(session: AgentSession, subjectId: string): boolean {
  if (session.activeSubjectId === subjectId) return false;
  session.activeSubjectId = subjectId;
  // Read signals (gender from pronouns, etc.) must ignore the previous person's
  // messages, which stay in the transcript across the switch.
  session.subjectActivatedTurn = session.turn;

  session.ledger.facts = [];
  const c = session.ledger.constraints;
  c.budgetMaxMinor = null;
  c.budgetMinMinor = null;
  c.deadline = null;
  c.exclusions = [];

  // Re-hydration is keyed on this — clear it so the new subject reloads.
  session.hydratedLenses = [];
  // Pending removals referred to the previous subject's ledger ids.
  session.removedFactKeys = [];

  // Product context is per-person: drop it so the next turn searches fresh.
  session.evidence.clear();
  session.candidates.clear();
  session.searchHits.clear();
  session.boardedIds.clear();
  session.boardedIdentities.clear();
  session.budgetScreenedCap.clear();

  return true;
}

/**
 * The active subject's gender, when it can be known — the gift/style lenses need
 * it because "men's shirt" and "women's shirt" are different products (fit,
 * sizing, cut). Read first from an explicit ledger fact the model recorded
 * (recipient.gender / pronouns / sex), then backstopped by counting gendered
 * pronouns in the shopper's own messages. Null when genuinely unknown — a guess
 * here would mislabel a real person, so we only return a value on clear signal.
 */
export function recipientGender(session: AgentSession): "woman" | "man" | null {
  const womanWords = /\b(she|her|hers|woman|women|female|girl|lady|ladies|wife|girlfriend|mum|mom|mother|sister|daughter|aunt|niece|grandmother|granny)\b/gi;
  const manWords = /\b(he|him|his|man|men|male|boy|guy|husband|boyfriend|dad|father|brother|son|uncle|nephew|grandfather|grandpa)\b/gi;

  // 1) An explicit fact the model recorded wins — it's the most deliberate signal.
  for (const f of session.ledger.facts) {
    if (!/gender|\bsex\b|pronoun/i.test(f.key)) continue;
    const v = String(f.value).toLowerCase();
    if (/\b(female|woman|she|her)\b/.test(v)) return "woman";
    if (/\b(male|man|he|him)\b/.test(v)) return "man";
  }

  // 2) Backstop: which gendered pronouns/relationships does the shopper use for
  //    THIS subject? Scope to messages since the subject was activated — the
  //    transcript survives a switch, so an earlier person's pronouns must not
  //    count. Only decide when one side clearly dominates.
  let woman = 0;
  let man = 0;
  for (const t of session.transcript) {
    if (t.role !== "user" || t.turn < session.subjectActivatedTurn) continue;
    woman += (t.content.match(womanWords) ?? []).length;
    man += (t.content.match(manWords) ?? []).length;
  }
  if (woman >= 2 && woman > man * 2) return "woman";
  if (man >= 2 && man > woman * 2) return "man";
  return null;
}

/** Normalize for quote-in-transcript checks: lowercase, collapse whitespace, fold curly quotes. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `quote` appears verbatim (normalized) in a USER message. `minTurn`
 * restricts the search to messages from that turn onward — used so a revoked
 * consent cannot be resurrected by replaying words spoken before the revocation.
 */
export function quoteInUserWords(
  session: AgentSession,
  quote: string,
  minTurn = 0,
): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 2) return false;
  return session.transcript.some(
    (t) => t.role === "user" && t.turn >= minTurn && normalizeForMatch(t.content).includes(q),
  );
}

/**
 * Apply model-authored fact patches. "said" facts require a verbatim user
 * quote or they are downgraded to "inferred" (the model cannot launder a guess
 * into testimony). Inferred values get the certainty-language hedge.
 */
export function applyFactPatches(
  session: AgentSession,
  patches: Array<{ key: string; value: string; provenance: "said" | "inferred" | "assumed"; quote?: string | null }>,
): void {
  for (const p of patches) {
    let provenance = p.provenance;
    let quote: string | null = p.quote ?? null;
    if (provenance === "said") {
      if (!quote || !quoteInUserWords(session, quote)) {
        provenance = "inferred";
        quote = null;
      }
    }
    const value = provenance === "inferred" ? hedgeInferredValue(p.value) : p.value;
    const existing = session.ledger.facts.find((f) => f.key === p.key && f.value === value);
    if (existing) continue;
    session.ledger.facts.push({
      id: nextFactId(session),
      key: p.key,
      value,
      provenance,
      quote,
      turn: session.turn,
      // Stamp the lens now: a later lens switch must not re-file this fact.
      lens: session.lens,
    });
  }
  // Ledger bloat guard.
  if (session.ledger.facts.length > 60) {
    session.ledger.facts = session.ledger.facts.slice(-60);
  }
}

/**
 * Consent is a recorded speech act: the quote must be a verbatim substring of
 * a user message or the consent is rejected. Returns whether it was recorded.
 */
export function recordConsent(
  session: AgentSession,
  category: string,
  quote: string,
): boolean {
  // After a revocation, only words spoken SINCE it can re-open the gate —
  // otherwise replaying the original quote would resurrect revoked consent.
  const lastRevokedTurn = session.ledger.consents
    .filter((c) => c.category === category && c.revoked)
    .reduce((max, c) => Math.max(max, c.turn), -1);
  const minTurn = lastRevokedTurn >= 0 ? lastRevokedTurn + 1 : 0;
  if (!quoteInUserWords(session, quote, minTurn)) return false;
  const existing = session.ledger.consents.find(
    (c) => c.category === category && !c.revoked,
  );
  if (existing) return true;
  session.ledger.consents.push({
    category,
    quote,
    turn: session.turn,
    revoked: false,
  });
  return true;
}

export function hasConsent(ledger: SessionLedger, category: string): boolean {
  return ledger.consents.some((c) => c.category === category && !c.revoked);
}

/** Union new care flags in (sticky, add-only — one entry per kind). */
export function mergeCareFlags(session: AgentSession, flags: CareFlag[]): CareFlag[] {
  const added: CareFlag[] = [];
  for (const flag of flags) {
    if (!session.ledger.careFlags.some((f) => f.kind === flag.kind)) {
      session.ledger.careFlags.push(flag);
      added.push(flag);
    }
  }
  return added;
}

/** Run the deterministic net over a user message and union the results. */
export function detectAndMergeCareFlags(session: AgentSession, text: string): CareFlag[] {
  return mergeCareFlags(session, detectCareFlags(text, session.turn));
}

/** All denylist terms from active scope fences (fed into card + search checks). */
export function scopeFenceTerms(ledger: SessionLedger): string[] {
  return [...new Set(ledger.careFlags.flatMap((f) => f.scopeFence))];
}

/**
 * Portrait-panel ops (corrections + consent revocation). "more_like" is handled
 * in the loop, which has the product context it needs.
 */
export function applyOp(
  session: AgentSession,
  op: Exclude<NonNullable<ExpertRequest["op"]>, { kind: "more_like" }>,
): string {
  if (op.kind === "correct_fact") {
    const idx = session.ledger.facts.findIndex((f) => f.id === op.factId);
    if (idx === -1) return "The user tried to correct a fact that no longer exists.";
    const fact = session.ledger.facts[idx];
    if (op.remove) {
      session.ledger.facts.splice(idx, 1);
      // Persistence is additive, so record the removal explicitly — otherwise
      // the stored copy survives and the fact returns on the next session.
      // Tag with the lens it was learned in (session lens for a hydrated
      // fact), so persistence deletes the right lens's copy and no other.
      const removedLens = fact.lens ?? session.lens;
      if (
        !session.removedFactKeys.some(
          (r) => r.lens === removedLens && r.key === fact.key,
        )
      ) {
        session.removedFactKeys.push({ lens: removedLens, key: fact.key });
      }
      return `The user REMOVED this from your understanding: "${fact.key}: ${fact.value}". Do not rely on it again; acknowledge the correction.`;
    }
    const newValue = (op.newValue ?? "").trim();
    if (!newValue) return "Empty correction ignored.";
    const corrected: LedgerFact = {
      ...fact,
      value: newValue,
      provenance: "said",
      quote: newValue,
      turn: session.turn,
    };
    session.ledger.facts[idx] = corrected;
    return `The user CORRECTED your understanding: "${fact.key}" is now "${newValue}" (was "${fact.value}"). Acknowledge the delta and adjust.`;
  }
  const consent = session.ledger.consents.find(
    (c) => c.category === op.category && !c.revoked,
  );
  if (consent) {
    consent.revoked = true;
    // Stamp the revocation at the current turn so only later words can re-consent.
    consent.turn = session.turn;
  }
  return `The user REVOKED consent for "${op.category}". Do not show that category again unless they re-opt-in in their own words.`;
}

export function ledgerView(ledger: SessionLedger): LedgerView {
  return {
    facts: ledger.facts,
    constraints: ledger.constraints,
    careFlags: ledger.careFlags.map((f) => ({ kind: f.kind, label: f.label })),
    consents: ledger.consents.map((c) => ({
      category: c.category,
      quote: c.quote,
      revoked: c.revoked,
    })),
  };
}

/**
 * Adapter: the truth layer reuses checkHardConstraints/logisticsMessage
 * unchanged by projecting the ledger onto BaseIntent. Scope-fence terms ride
 * as exclusions so a care boundary constrains what can be SHOWN.
 */
export function ledgerToBaseIntent(ledger: SessionLedger): BaseIntent {
  return {
    budget: {
      minMajor: null,
      maxMajor: null,
      minMinor: ledger.constraints.budgetMinMinor,
      maxMinor: ledger.constraints.budgetMaxMinor,
      currency: ledger.constraints.currency,
    },
    destination: {
      country: ledger.constraints.country ?? "",
      region: null,
      city: null,
      postalCode: ledger.constraints.postalCode,
    },
    physicality: "either",
    deadline: ledger.constraints.deadline,
    hardConstraints: [],
    exclusions: [...ledger.constraints.exclusions, ...scopeFenceTerms(ledger)],
    softPreferences: [],
    searchThemes: [],
    interests: [],
    occasion: null,
    styleKeywords: [],
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}
