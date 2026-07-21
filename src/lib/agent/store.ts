import "server-only";
import { SELF_SUBJECT_ID } from "@/lib/personalization/types";
import { newSession } from "./ledger";
import type { AgentSession, ExpertLensId } from "./types";

/**
 * In-memory session store (hackathon-grade: single process, TTL-swept).
 * Sessions hold third-party data (recipient portraits) — they expire and are
 * never persisted to disk.
 */

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SESSIONS = 300;

const sessions = new Map<string, AgentSession>();
/** In-flight turn guards: a new message aborts the previous loop at its next action boundary. */
const inflight = new Map<string, { aborted: boolean }>();

/** Last-activity timestamps — TTL is idle time, not age, so long consultations survive. */
const touched = new Map<string, number>();

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const lastActive = touched.get(id) ?? s.createdAtMs;
    if (now - lastActive > TTL_MS) {
      sessions.delete(id);
      touched.delete(id);
    }
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest == null) break;
    sessions.delete(oldest);
    touched.delete(oldest);
  }
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function getOrCreateSession(
  sessionId: string | null | undefined,
  lens: ExpertLensId,
  /** The signed-in shopper making this request, or null when anonymous. */
  userId: string | null = null,
): AgentSession {
  sweep();
  if (sessionId) {
    const existing = sessions.get(sessionId);
    // A session may hold a remembered profile, so it is only adopted by the
    // shopper it belongs to. The one exception is an anonymous session being
    // claimed when its own visitor signs in — allowed ONLY while it has never
    // been hydrated, so a session that already contains someone's profile can
    // never be re-bound to a different identity.
    const adoptable =
      existing != null &&
      (existing.userId === userId ||
        (existing.userId === null && existing.hydratedLenses.length === 0));
    if (existing && adoptable) {
      if (existing.userId === null) existing.userId = userId;
      // Refresh Map insertion order so overflow eviction is LRU, not FIFO —
      // otherwise the longest-running conversation is evicted first.
      sessions.delete(sessionId);
      sessions.set(sessionId, existing);
      touched.set(sessionId, Date.now());
      return existing;
    }
  }
  // Ids are always minted server-side. A client-supplied id that we don't know
  // is never adopted as a key — that would let a caller pick (or collide with)
  // another shopper's session, which holds third-party portrait data.
  const id = crypto.randomUUID();
  const session = newSession(id, lens);
  // Bind at creation. Without this a session minted for a signed-in shopper
  // stays `userId: null` and is indistinguishable from an anonymous one, so a
  // leaked session id could adopt their hydrated profile.
  session.userId = userId;
  sessions.set(id, session);
  touched.set(id, Date.now());
  return session;
}

/** Abort any in-flight turn for this session; returns a fresh guard for the new turn. */
export function claimTurn(sessionId: string): { aborted: boolean } {
  const previous = inflight.get(sessionId);
  if (previous) previous.aborted = true;
  const guard = { aborted: false };
  inflight.set(sessionId, guard);
  return guard;
}

export function releaseTurn(sessionId: string, guard: { aborted: boolean }): void {
  if (inflight.get(sessionId) === guard) inflight.delete(sessionId);
}

/**
 * Drop remembered (hydrated) profile facts from every live session belonging to
 * a shopper, so a "delete everything" in the Personalization Center takes
 * effect immediately.
 *
 * Without this, an already-open chat still holds the profile in its ledger and
 * the next turn re-persists it — the deleted data appears to come back.
 * Facts said during the conversation itself (turn >= 1) are kept: the shopper
 * is still talking about them, and they were never the stored profile.
 */
export function forgetUserSessions(userId: string): number {
  let cleared = 0;
  for (const session of sessions.values()) {
    if (session.userId !== userId) continue;
    session.ledger.facts = session.ledger.facts.filter((f) => f.turn !== 0);
    session.hydratedLenses = [];
    // Budget/country/deadline/exclusions live in constraints, NOT in facts, and
    // are re-persisted every turn by constraintsToUpserts. Without clearing them
    // the next message would silently resurrect the budget and country the
    // shopper just deleted — defeating the whole point of this reset.
    const c = session.ledger.constraints;
    c.budgetMaxMinor = null;
    c.budgetMinMinor = null;
    c.country = null;
    c.deadline = null;
    c.exclusions = [];
    // The person profiles are gone; drop the active pointer back to the owner
    // so the next turn can't persist under a subject that no longer exists.
    session.activeSubjectId = SELF_SUBJECT_ID;
    session.knownSubjects = [];
    cleared += 1;
  }
  return cleared;
}

export function _clearSessionsForTests(): void {
  sessions.clear();
  inflight.clear();
  touched.clear();
}
