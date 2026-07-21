import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { ledgerView } from "@/lib/agent/ledger";
import { routeLens, runExpertTurn } from "@/lib/agent/loop";
import { claimTurn, getOrCreateSession, hasSession, releaseTurn } from "@/lib/agent/store";
import { ExpertRequestSchema, isExpertLens, type ExpertEvent } from "@/lib/agent/types";
import {
  hydrateSessionMemory,
  persistSessionMemory,
  resolveActiveSubject,
  syncKnownSubjects,
} from "@/lib/personalization/agent-memory";
import { logger } from "@/lib/logger";

/**
 * The Expert Loop endpoint: POST → NDJSON stream of ExpertEvent lines.
 * The first event is always {type:"session"}; the last is {type:"done"}.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = ExpertRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request shape." }, { status: 400 });
  }
  const input = parsed.data;
  // A bare profile switch (sidebar) carries neither a message nor an op.
  if (!input.message && !input.op && !input.setSubject) {
    return Response.json({ ok: false, error: "Provide a message, an op, or a subject." }, { status: 400 });
  }
  // Data-URL images only, bounded (catalog visual similarity payload).
  if (input.imageDataUrl) {
    if (!input.imageDataUrl.startsWith("data:image/") || input.imageDataUrl.length > 4_000_000) {
      return Response.json({ ok: false, error: "Image must be a data URL under ~3MB." }, { status: 400 });
    }
  }

  const lens = isExpertLens(input.lens)
    ? input.lens
    : routeLens(input.message ?? "");
  // Personalization is per-shopper; anonymous visitors simply get no memory.
  // Failing auth must never block a turn, so this is best-effort.
  let userId: string | null = null;
  try {
    const authSession = await auth();
    userId = authSession?.user?.id ?? null;
  } catch (err) {
    logger.warn("expert auth lookup failed; continuing anonymously", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const sessionLost = Boolean(input.sessionId) && !hasSession(input.sessionId!);
  const session = getOrCreateSession(input.sessionId, lens, userId);
  // An explicit lens pick can retarget an existing session's persona.
  if (isExpertLens(input.lens)) session.lens = input.lens;

  // A request with only a subject switch does no shopping — just re-point the
  // profile and refresh the sidebar. Kept separate so it returns in one hop.
  const switchOnly = !input.message && !input.op;

  const guard = claimTurn(session.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ExpertEvent) => {
        if (guard.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          guard.aborted = true; // client went away — stop the loop at the next boundary
        }
      };
      emit({ type: "session", sessionId: session.id, lens: session.lens });
      if (sessionLost) {
        emit({
          type: "notice",
          tone: "info",
          text: "I lost our earlier session state (the server restarted), so I'm picking up fresh from this message — remind me of anything important.",
        });
      }
      try {
        // Decide WHO this turn is about, before hydration — an explicit sidebar
        // pick or the shopper's own words ("a gift for my dad Rajesh"). A new
        // name creates a profile here; a switch re-points the whole session.
        const resolution = await resolveActiveSubject(
          session,
          userId,
          input.message,
          input.setSubject,
        );
        if (resolution) {
          emit({
            type: "subjects",
            active: resolution.active.subjectId,
            list: resolution.list,
            announce: resolution.changed
              ? {
                  subjectId: resolution.active.subjectId,
                  name: resolution.active.name,
                  created: resolution.created,
                }
              : null,
            // A pre-turn switch means the board holds the previous person's picks.
            staleBoard: resolution.changed,
          });
        }

        // Load the active subject's remembered profile into the ledger BEFORE
        // the turn, so the prompt already contains it. Costs no extra model call.
        const signals = await hydrateSessionMemory(session, userId);
        if (signals.length > 0) emit({ type: "personalization", signals });
        // Resync the Portrait to the active subject (a switch cleared it).
        emit({ type: "ledger", view: ledgerView(session.ledger) });

        if (switchOnly) {
          emit({ type: "done", terminal: "present" });
          return;
        }

        await runExpertTurn(
          session,
          { message: input.message, op: input.op, imageDataUrl: input.imageDataUrl },
          emit,
          () => guard.aborted,
        );

        // Persist what was learned, under the active subject. Awaited (not
        // fire-and-forget) so the write cannot be killed by the request ending.
        const { facts: learned, switchedTo } = await persistSessionMemory(session, userId);

        // The turn's own words named a gift recipient the detector had missed —
        // the profile has moved to them. Tell the UI and reload their portrait.
        if (switchedTo) {
          const list = await syncKnownSubjects(session, userId);
          emit({
            type: "subjects",
            active: session.activeSubjectId,
            list,
            announce: { subjectId: switchedTo.subjectId, name: switchedTo.name, created: switchedTo.created },
            // The board just shown already belongs to this person — keep it.
            staleBoard: false,
          });
          const reSignals = await hydrateSessionMemory(session, userId);
          if (reSignals.length > 0) emit({ type: "personalization", signals: reSignals });
          emit({ type: "ledger", view: ledgerView(session.ledger) });
        }

        // Push learned facts to the always-visible form so it fills itself.
        if (learned.length > 0) emit({ type: "profile", facts: learned });
      } catch (err) {
        logger.error("expert turn crashed", {
          error: err instanceof Error ? err.message : String(err),
        });
        emit({ type: "error", message: "Something broke mid-turn — send that again and I'll pick it up." });
        emit({ type: "done", terminal: "error" });
      } finally {
        releaseTurn(session.id, guard);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      guard.aborted = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
