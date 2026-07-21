import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse } from "@/lib/api";
import { getSnapshot } from "@/lib/history/store";

export const runtime = "nodejs";

/** One conversation's full snapshot, loaded only when restoring. */

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "You must be signed in to use your search history." },
        { status: 401 },
      );
    }
    const { id } = await params;
    const snapshot = await getSnapshot(userId, id);
    if (snapshot === null) {
      return NextResponse.json(
        { ok: false, error: "That search is no longer available." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return errorResponse(err, "history.snapshot.get");
  }
}
