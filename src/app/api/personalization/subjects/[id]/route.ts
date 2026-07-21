import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, errorResponse } from "@/lib/api";
import { deleteSubject } from "@/lib/personalization/subjects";
import { SELF_SUBJECT_ID } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * Delete one person profile and everything we know about them. `self` can never
 * be deleted (it is the account owner). The id comes from the path; the user id
 * from the session, so this only ever erases the caller's own person.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limited = guardRate(req, "personalization.subjects.delete", 40);
    if (limited) return limited;

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "You must be signed in to manage profiles." },
        { status: 401 },
      );
    }

    const { id } = await params;
    if (!id || id === SELF_SUBJECT_ID) {
      return NextResponse.json(
        { ok: false, error: "That profile cannot be deleted." },
        { status: 400 },
      );
    }

    const ok = await deleteSubject(userId, id);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "That profile could not be deleted." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "personalization.subjects.delete");
  }
}
