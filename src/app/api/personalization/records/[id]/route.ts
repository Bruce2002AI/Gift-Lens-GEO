import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { deleteRecord, upsertRecord } from "@/lib/personalization/repository";
import { RecordUpsertSchema } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * A single structured record. Ownership is enforced by the repository's
 * `userId` filter, so a miss is reported as 404 either way.
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
    const limited = guardRate(req, "personalization.records.patch", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const { id } = await params;
    const body = await parseBody(req, RecordUpsertSchema);
    if (!body.ok) return body.response;

    const record = await upsertRecord(authd.userId, body.data, id);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "That entry no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, record });
  } catch (err) {
    return errorResponse(err, "personalization.records.patch");
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const limited = guardRate(req, "personalization.records.delete", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const { id } = await params;
    const deleted = await deleteRecord(authd.userId, id);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: "That entry no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "personalization.records.delete");
  }
}
