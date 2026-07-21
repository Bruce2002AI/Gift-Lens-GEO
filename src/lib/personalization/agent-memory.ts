import "server-only";

import { switchSubject } from "@/lib/agent/ledger";
import type { AgentSession, ExpertLensId, SubjectSummary } from "@/lib/agent/types";
import { logger } from "@/lib/logger";
import {
  constraintsToUpserts,
  hydrateLedger,
  ledgerFactsToUpserts,
  personalizationSignals,
  splitLedgerKey,
  type PersonalizationSignal,
} from "./ledger-bridge";
import { extractFieldsFromText } from "./extract";
import { resolveFieldForKey } from "./schema";
import { detectSubjectMention } from "./subject-detect";
import { personRecordFromUpserts } from "./records-bridge";
import {
  getSubject,
  listSubjects,
  resolveOrCreateSubject,
  upsertSubject,
} from "./subjects";
import { factsForLens, forgetFactByKey, upsertFacts } from "./repository";
import { SELF_SUBJECT_ID, type FactUpsert, type ProfileSubject } from "./types";
import type { ProfileFact, ProfileLens } from "./types";

/**
 * The agent's long-term memory: the only place the Expert Loop touches
 * personalization storage. Everything here is scoped to the session's ACTIVE
 * SUBJECT — `self` (the account owner) by default, or a named person once the
 * shopper says so. That subject is what makes the picks "for them".
 *
 * Every operation is best-effort AND time-boxed. Personalization is an
 * enhancement, never a precondition for shopping — if Mongo is unreachable the
 * shopper must still get a full turn, and must not wait on a dead socket to
 * find out. Hence the explicit races below.
 */

/** Hydration blocks the turn's first token, so it gets the tighter budget. */
const HYDRATE_TIMEOUT_MS = 2_000;
/** Subject resolution also blocks the turn's start; keep it just as tight. */
const SUBJECT_TIMEOUT_MS = 2_000;
/** Persistence happens after the answer is delivered; it can afford more. */
const PERSIST_TIMEOUT_MS = 5_000;
/** Subject mirroring is secondary to the facts; keep it on a tight leash. */
const SUBJECT_WRITE_TIMEOUT_MS = 2_000;

/** Resolve to `fallback` if `work` hasn't settled in time. Never rejects. */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      logger.warn("personalization timed out", { label, ms });
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Subjects — who this conversation is about
// ---------------------------------------------------------------------------

function toSummary(s: ProfileSubject): SubjectSummary {
  return {
    subjectId: s.subjectId,
    name: s.name,
    relationship: s.relationship,
    kind: s.kind,
    createdBy: s.createdBy,
  };
}

/** The subject to hand the UI when a switch resolves to `self`. */
function selfSummary(): SubjectSummary {
  return { subjectId: SELF_SUBJECT_ID, name: "You", relationship: null, kind: "self", createdBy: "user" };
}

export interface SubjectResolution {
  /** The full profile list (self first) for the sidebar switcher. */
  list: SubjectSummary[];
  /** The active subject after resolution. */
  active: SubjectSummary;
  /** True if THIS request changed the active subject. */
  changed: boolean;
  /** True if the active subject was created just now. */
  created: boolean;
}

/**
 * Decide who the turn is about, BEFORE hydration, and switch the session to
 * them so their remembered profile is what the model sees.
 *
 * Order of authority: an explicit UI pick (`setSubject`) wins; otherwise the
 * shopper's own words are read for a name/relationship/self reference. A new
 * name creates a profile on the spot — that is the agent "creating a profile
 * itself". Anonymous visitors have no store, so they stay on `self`.
 */
export async function resolveActiveSubject(
  session: AgentSession,
  userId: string | null,
  message: string | null | undefined,
  setSubject:
    | { id?: string | null; name?: string | null; relationship?: string | null }
    | null
    | undefined,
): Promise<SubjectResolution | null> {
  if (!userId) {
    session.knownSubjects = [selfSummary()];
    return null;
  }

  const list = await withTimeout(
    listSubjects(userId).catch((err) => {
      logger.warn("subject list failed", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    SUBJECT_TIMEOUT_MS,
    [],
    "subject-list",
  );
  const summaries = list.length > 0 ? list.map(toSummary) : [selfSummary()];
  session.knownSubjects = summaries;
  const persons = summaries.filter((s) => s.kind === "person");

  // Resolve a TARGET subject id (+ whether we minted it). Explicit pick first.
  let target: { subjectId: string; created: boolean } | null = null;

  if (setSubject) {
    if (setSubject.id === SELF_SUBJECT_ID) {
      target = { subjectId: SELF_SUBJECT_ID, created: false };
    } else if (setSubject.id) {
      const existing = await getSubject(userId, setSubject.id).catch(() => null);
      if (existing) target = { subjectId: existing.subjectId, created: false };
    } else if (setSubject.name && setSubject.name.trim()) {
      const res = await resolveOrCreateSubject(userId, {
        name: setSubject.name,
        relationship: setSubject.relationship ?? null,
        createdBy: "user",
      }).catch(() => null);
      if (res) {
        target = { subjectId: res.subject.subjectId, created: res.created };
        if (res.created || !summaries.some((s) => s.subjectId === res.subject.subjectId)) {
          session.knownSubjects = [...summaries, toSummary(res.subject)];
        }
      }
    }
  }

  // Otherwise read the message for who they're talking about.
  if (!target && message) {
    const mention = detectSubjectMention(message, persons.map((p) => p.name));
    if (mention?.target === "self") {
      target = { subjectId: SELF_SUBJECT_ID, created: false };
    } else if (mention?.target === "person") {
      const res = await resolveOrCreateSubject(userId, {
        name: mention.name,
        relationship: mention.relationship,
        createdBy: "agent",
      }).catch(() => null);
      if (res) {
        target = { subjectId: res.subject.subjectId, created: res.created };
        if (res.created) session.knownSubjects = [...session.knownSubjects, toSummary(res.subject)];
      }
    } else if (mention?.target === "relationship") {
      // Prefer an existing person with that relationship; else open one for it.
      const match = persons.find((p) => p.relationship === mention.relationship);
      if (match) {
        target = { subjectId: match.subjectId, created: false };
      } else {
        const label = `My ${mention.relationship}`;
        const res = await resolveOrCreateSubject(userId, {
          name: label,
          relationship: mention.relationship,
          createdBy: "agent",
        }).catch(() => null);
        if (res) {
          target = { subjectId: res.subject.subjectId, created: res.created };
          if (res.created) session.knownSubjects = [...session.knownSubjects, toSummary(res.subject)];
        }
      }
    }
  }

  const targetId = target?.subjectId ?? session.activeSubjectId;
  const changed = switchSubject(session, targetId);
  const active =
    session.knownSubjects.find((s) => s.subjectId === session.activeSubjectId) ?? selfSummary();

  return {
    list: session.knownSubjects,
    active,
    changed,
    created: Boolean(target?.created && changed),
  };
}

/** Refresh the cached subject list without changing the active one. */
export async function syncKnownSubjects(
  session: AgentSession,
  userId: string | null,
): Promise<SubjectSummary[]> {
  if (!userId) {
    session.knownSubjects = [selfSummary()];
    return session.knownSubjects;
  }
  const list = await listSubjects(userId).catch(() => []);
  session.knownSubjects = list.length > 0 ? list.map(toSummary) : [selfSummary()];
  return session.knownSubjects;
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Load the active subject's profile for the CURRENT lens into the ledger.
 *
 * Tracked per lens (reset on a subject switch), so switching lens OR person
 * mid-session loads the right memory rather than silently reusing the last.
 * Costs zero extra model calls — the ledger is already serialized into the
 * prompt by the loop's prompt builder.
 */
export async function hydrateSessionMemory(
  session: AgentSession,
  userId: string | null,
): Promise<PersonalizationSignal[]> {
  const lens = session.lens;
  if (!userId || session.hydratedLenses.includes(lens)) return [];
  // Mark first: a failing load must not be retried on every turn of a long chat.
  session.hydratedLenses.push(lens);

  const subjectId = session.activeSubjectId;
  const facts = await withTimeout(
    factsForLens(userId, lens as ProfileLens, subjectId).catch((err) => {
      logger.warn("personalization hydrate failed", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    HYDRATE_TIMEOUT_MS,
    [],
    "hydrate",
  );

  if (facts.length === 0) return [];
  hydrateLedger(session.ledger, facts);
  return personalizationSignals(facts);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Shared facts (currency, country, general budget) belong to the OWNER; a
 * person only owns their lens-specific facts. */
function assignSubjectIds(upserts: FactUpsert[], subjectId: string): FactUpsert[] {
  return upserts.map((u) => ({
    ...u,
    subjectId: u.lens === "shared" ? SELF_SUBJECT_ID : subjectId,
  }));
}

/** The person named by this turn's gift facts, if any. */
function giftRecipientName(upserts: FactUpsert[]): string | null {
  const u = upserts.find(
    (x) => x.lens === "gift" && x.category === "recipient" && x.key === "name",
  );
  return typeof u?.value === "string" && u.value.trim() ? u.value.trim() : null;
}

export interface PersistResult {
  facts: ProfileFact[];
  /** Set when the turn's own content re-pointed the profile at a new person. */
  switchedTo: { subjectId: string; name: string; created: boolean } | null;
}

/**
 * Persist what the agent learned this turn, under the active subject.
 *
 * The model already emitted these as `update_ledger` facts, so this is pure
 * translation + a write — no summarization, no embedding. Facts default to
 * lens-local; nothing crosses lenses until the shopper says so.
 *
 * Backstop: if the conversation was nominally about the owner (`self`) but the
 * turn actually named a gift recipient, we recognise the detector missed it,
 * create/resolve THAT person, and file their gift facts under them — so a name
 * that surfaces mid-answer still lands on the right profile.
 */
export async function persistSessionMemory(
  session: AgentSession,
  userId: string | null,
): Promise<PersistResult> {
  const empty: PersistResult = { facts: [], switchedTo: null };
  if (!userId) return empty;
  const lens = session.lens as ProfileLens;

  // The subject removals were recorded against (before any backstop switch).
  const removalSubject = session.activeSubjectId;

  let switchedTo: PersistResult["switchedTo"] = null;
  let upsertsForSubject: FactUpsert[] = [];

  const factsWork: Promise<ProfileFact[]> = (async () => {
    // Removals first, scoped to the subject the fact was learned under. Shared
    // facts live on the owner; lens facts on whoever was active at removal time.
    for (const { lens: removedLens, key } of session.removedFactKeys) {
      const field = resolveFieldForKey(removedLens, key);
      const target = field
        ? { lens: field.lens, category: field.category, key: field.key }
        : { lens: removedLens as ProfileLens, ...splitLedgerKey(key) };
      const subjectId = target.lens === "shared" ? SELF_SUBJECT_ID : removalSubject;
      try {
        await forgetFactByKey(userId, subjectId, target.lens, target.category, target.key);
      } catch {
        // One failed removal must not block the rest of the turn's writes.
      }
    }
    session.removedFactKeys = [];

    const fromLedger = ledgerFactsToUpserts(session.ledger, lens);

    // Belt and braces: code fills the blanks the model can prove from the
    // shopper's own words. Only fields still blank after the model's own writes.
    const known = new Set<string>([
      ...session.ledger.facts.map((f) => f.key),
      ...fromLedger.map((u) => `${u.category}.${u.key}`),
    ]);
    const lastUserMessage =
      [...session.transcript].reverse().find((t) => t.role === "user")?.content ?? "";
    const fromText = extractFieldsFromText(lens, lastUserMessage, known);

    const upserts = [
      ...fromLedger,
      ...fromText,
      ...constraintsToUpserts(session.ledger.constraints),
    ];
    if (upserts.length === 0) return [];

    // Decide the effective subject. Backstop only when nominally the owner.
    let effective = session.activeSubjectId;
    if (session.activeSubjectId === SELF_SUBJECT_ID) {
      const name = giftRecipientName(upserts);
      if (name) {
        const res = await resolveOrCreateSubject(userId, {
          name,
          relationship: recipientRelationship(upserts),
          createdBy: "agent",
        }).catch(() => null);
        if (res) {
          effective = res.subject.subjectId;
          switchSubject(session, effective);
          switchedTo = { subjectId: res.subject.subjectId, name: res.subject.name, created: res.created };
        }
      }
    }

    const tagged = assignSubjectIds(upserts, effective);
    upsertsForSubject = tagged;
    const saved = await upsertFacts(userId, tagged);
    logger.debug("personalization persisted", {
      sessionId: session.id,
      lens: session.lens,
      subjectId: effective,
      attempted: tagged.length,
      saved: saved.length,
    });
    return saved;
  })().catch((err) => {
    logger.warn("personalization persist failed", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return [] as ProfileFact[];
  });

  const saved = await withTimeout(factsWork, PERSIST_TIMEOUT_MS, [], "persist");

  // Keep the subject's switcher preview (interests, relationship…) fresh, on a
  // budget that can never delay the form update the shopper is watching.
  if (session.activeSubjectId !== SELF_SUBJECT_ID && upsertsForSubject.length > 0) {
    await withTimeout(
      mirrorSubjectPreview(userId, session.activeSubjectId, lens, upsertsForSubject).catch(
        (err) => {
          logger.warn("subject preview update failed", {
            sessionId: session.id,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      ),
      SUBJECT_WRITE_TIMEOUT_MS,
      undefined,
      "subject-preview",
    );
  }

  return { facts: saved, switchedTo };
}

/** The recipient's relationship from this turn's gift facts, if stated. */
function recipientRelationship(upserts: FactUpsert[]): string | null {
  const u = upserts.find(
    (x) => x.lens === "gift" && x.category === "recipient" && x.key === "relationship",
  );
  return typeof u?.value === "string" && u.value.trim() ? u.value.trim() : null;
}

/**
 * Denormalize a person's headline facts onto their subject row, so the switcher
 * can show "Rajesh · dad · cricket, old Hindi music" without loading the full
 * profile. Reuses the recipient-record bridge purely as a data extractor.
 */
async function mirrorSubjectPreview(
  userId: string,
  subjectId: string,
  lens: ProfileLens,
  upserts: FactUpsert[],
): Promise<void> {
  const draft = personRecordFromUpserts(lens, upserts);
  if (!draft) return;
  await upsertSubject(userId, {
    subjectId,
    name: draft.label,
    relationship:
      typeof draft.data.relationship === "string" ? draft.data.relationship : null,
    createdBy: "agent",
    data: draft.data,
  });
}

// ---------------------------------------------------------------------------
// Reset support
// ---------------------------------------------------------------------------

/**
 * Drop remembered state from a live session after a "delete everything".
 *
 * Without this the shopper deletes their profile, then the next message
 * re-persists the same facts from the still-hydrated ledger. Turn-0 facts are
 * the hydrated ones; anything from turn >= 1 was said this session and stays.
 */
export function forgetHydratedFacts(session: AgentSession, lens: ExpertLensId): void {
  session.ledger.facts = session.ledger.facts.filter((f) => f.turn !== 0);
  session.hydratedLenses = session.hydratedLenses.filter((l) => l !== lens);
  // Budget/country are re-persisted from constraints, not facts — clear them too
  // or the deleted values reappear on the next turn (see forgetUserSessions).
  const c = session.ledger.constraints;
  c.budgetMaxMinor = null;
  c.budgetMinMinor = null;
  c.country = null;
  c.postalCode = null;
  c.deadline = null;
  c.exclusions = [];
}
