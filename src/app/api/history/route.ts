import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import {
  clearHistory,
  deleteHistory,
  listHistory,
  renameHistory,
  upsertHistory,
} from "@/lib/history/store";

export const runtime = "nodejs";

/** Index-row fields (no snapshot). Kept in sync with HistoryEntry. */
const entrySchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(200),
  subtitle: z.string().max(200),
  lens: z.string().max(64).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turnCount: z.number().int().nonnegative(),
  productCount: z.number().int().nonnegative(),
  thumbnailUrl: z.string().max(2048).nullable(),
});

/** Upsert carries the index row + the opaque snapshot blob. */
const upsertSchema = z.object({
  entry: entrySchema,
  // Snapshot is opaque to the server; parseBody already caps total body size.
  snapshot: z.unknown(),
});

const renameSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
});

/** DELETE removes one entry (id given) or clears all (no id). */
const deleteSchema = z.object({
  id: z.string().min(1).max(128).optional(),
});

/** Resolve the signed-in user id, or a 401 response. */
async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "You must be signed in to use your search history." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId };
}

export async function GET() {
  try {
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const entries = await listHistory(authd.userId);
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return errorResponse(err, "history.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "history.post", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const body = await parseBody(req, upsertSchema);
    if (!body.ok) return body.response;
    const entry = await upsertHistory(authd.userId, body.data.entry, body.data.snapshot);
    return NextResponse.json({ ok: true, entry });
  } catch (err) {
    return errorResponse(err, "history.post");
  }
}

export async function PATCH(req: Request) {
  try {
    const limited = guardRate(req, "history.patch", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const body = await parseBody(req, renameSchema);
    if (!body.ok) return body.response;
    await renameHistory(authd.userId, body.data.id, body.data.title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "history.patch");
  }
}

export async function DELETE(req: Request) {
  try {
    const limited = guardRate(req, "history.delete", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const body = await parseBody(req, deleteSchema);
    if (!body.ok) return body.response;
    if (body.data.id) {
      await deleteHistory(authd.userId, body.data.id);
    } else {
      await clearHistory(authd.userId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "history.delete");
  }
}
