import { NextRequest } from "next/server";
import { ledgerView } from "@/lib/agent/ledger";
import { routeLens, runExpertTurn } from "@/lib/agent/loop";
import { claimTurn, getOrCreateSession, hasSession, releaseTurn } from "@/lib/agent/store";
import { ExpertRequestSchema, isExpertLens, type ExpertEvent } from "@/lib/agent/types";
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
  if (!input.message && !input.op) {
    return Response.json({ ok: false, error: "Provide a message or an op." }, { status: 400 });
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
  const sessionLost = Boolean(input.sessionId) && !hasSession(input.sessionId!);
  const session = getOrCreateSession(input.sessionId, lens);
  // An explicit lens pick can retarget an existing session's persona.
  if (isExpertLens(input.lens)) session.lens = input.lens;

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
        // Resync the Portrait: the client's stale view must not survive a reset.
        emit({ type: "ledger", view: ledgerView(session.ledger) });
      }
      try {
        await runExpertTurn(
          session,
          { message: input.message, op: input.op, imageDataUrl: input.imageDataUrl },
          emit,
          () => guard.aborted,
        );
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
