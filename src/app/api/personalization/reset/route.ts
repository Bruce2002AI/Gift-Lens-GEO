import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, errorResponse } from "@/lib/api";
import { deleteAllPersonalization } from "@/lib/personalization/repository";
import { forgetUserSessions } from "@/lib/agent/store";

export const runtime = "nodejs";

/**
 * "Delete everything" — the shopper's erase control.
 *
 * POST, never GET: a destructive action must not be reachable by a prefetch, a
 * link, or an <img src>. The user id comes from the session alone, so this can
 * only ever erase the caller's own facts, records and outcomes.
 */

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "personalization.reset.post", 10);
    if (limited) return limited;

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "You must be signed in to delete your data." },
        { status: 401 },
      );
    }

    const deleted = await deleteAllPersonalization(userId);
    // Live chat sessions still hold the profile in their ledger; without this
    // the next message would re-persist what was just deleted, making the data
    // appear to come back.
    const sessionsCleared = forgetUserSessions(userId);
    return NextResponse.json({ ok: true, deleted, sessionsCleared });
  } catch (err) {
    return errorResponse(err, "personalization.reset.post");
  }
}
