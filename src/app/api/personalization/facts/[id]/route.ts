import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { deleteFact, patchFact } from "@/lib/personalization/repository";
import { FactPatchSchema } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * A single fact. The repository filters every write by `userId`, so a fact
 * belonging to someone else is indistinguishable from one that does not exist
 * — both answer 404 and neither reveals that the id is real.
 */

type RouteContext = { params: Promise<{ id: string }> };

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "You must be signed in to edit your profile." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId };
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const limited = guardRate(req, "personalization.facts.patch", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const { id } = await params;
    const body = await parseBody(req, FactPatchSchema);
    if (!body.ok) return body.response;

    const fact = await patchFact(authd.userId, id, body.data);
    if (!fact) {
      return NextResponse.json(
        { ok: false, error: "That fact no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, fact });
  } catch (err) {
    return errorResponse(err, "personalization.facts.patch");
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const limited = guardRate(req, "personalization.facts.delete", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const { id } = await params;
    const deleted = await deleteFact(authd.userId, id);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: "That fact no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "personalization.facts.delete");
  }
}
