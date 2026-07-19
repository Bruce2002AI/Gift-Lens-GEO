import "server-only";
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
): AgentSession {
  sweep();
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) {
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

export function _clearSessionsForTests(): void {
  sessions.clear();
  inflight.clear();
  touched.clear();
}
