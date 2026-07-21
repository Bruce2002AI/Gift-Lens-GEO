import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { factsForLens, listFacts, upsertFact } from "@/lib/personalization/repository";
import { FactUpsertSchema, isProfileLens, SELF_SUBJECT_ID } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * Facts collection.
 *
 * The signed-in session is the ONLY source of the user id — a body or query
 * param can never select whose profile is read or written.
 */

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "You must be signed in to view your profile." },
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

    // `?lens=` asks "what may this lens actually see", which is the consent
    // filter — not a plain equality filter on the stored lens. Omitting it
    // returns everything the shopper owns (what the Personalization Center
    // manages). An UNRECOGNISED lens is rejected rather than ignored: silently
    // falling back to the unfiltered list would return strictly more than the
    // caller asked for, which is the wrong direction to fail in.
    const params = new URL(req.url).searchParams;
    const lensParam = params.get("lens");
    if (lensParam !== null && !isProfileLens(lensParam)) {
      return NextResponse.json(
        { ok: false, error: `Unknown lens "${lensParam}".` },
        { status: 400 },
      );
    }
    // `?subjectId=` scopes to one person's profile; omitted → the account owner.
    const subjectParam = params.get("subjectId");
    const subjectId =
      subjectParam && subjectParam.length <= 64 ? subjectParam : SELF_SUBJECT_ID;

    const facts = lensParam
      ? await factsForLens(authd.userId, lensParam, subjectId)
      : await listFacts(authd.userId, subjectId);

    return NextResponse.json({ ok: true, facts });
  } catch (err) {
    return errorResponse(err, "personalization.facts.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "personalization.facts.post", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const body = await parseBody(req, FactUpsertSchema);
    if (!body.ok) return body.response;

    const fact = await upsertFact(authd.userId, body.data);
    if (!fact) {
      return NextResponse.json(
        { ok: false, error: "That fact could not be saved." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, fact }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "personalization.facts.post");
  }
}
