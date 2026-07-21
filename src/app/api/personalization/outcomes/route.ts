import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { listOutcomes, recordOutcome } from "@/lib/personalization/repository";
import { OutcomeCreateSchema, isProfileLens } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * Outcome events — liked / rejected / purchased / returned…
 *
 * This is how the system learns without asking the model anything: behaviour is
 * recorded as data, then replayed at hydration time.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

/** Clamp an untrusted `?limit=` into 1..300; anything unparseable falls back. */
function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "You must be signed in to view your activity." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId };
}

export async function GET(req: Request) {
  try {
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const params = new URL(req.url).searchParams;
    // Reject an unrecognised lens rather than widening the result set.
    const lensParam = params.get("lens");
    if (lensParam !== null && !isProfileLens(lensParam)) {
      return NextResponse.json(
        { ok: false, error: `Unknown lens "${lensParam}".` },
        { status: 400 },
      );
    }

    const outcomes = await listOutcomes(
      authd.userId,
      lensParam ?? undefined,
      parseLimit(params.get("limit")),
    );
    return NextResponse.json({ ok: true, outcomes });
  } catch (err) {
    return errorResponse(err, "personalization.outcomes.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "personalization.outcomes.post", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const body = await parseBody(req, OutcomeCreateSchema);
    if (!body.ok) return body.response;

    const outcome = await recordOutcome(authd.userId, body.data);
    return NextResponse.json({ ok: true, outcome }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "personalization.outcomes.post");
  }
}
