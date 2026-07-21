import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { listRecords, upsertRecord } from "@/lib/personalization/repository";
import {
  RECORD_KINDS,
  RecordUpsertSchema,
  type RecordKind,
} from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * Structured records (recipients, wardrobe items, supplements…).
 *
 * The owning lens is derived from `kind` inside the repository, so a client
 * cannot file a supplement under the Gift lens to dodge a consent rule.
 */

function isRecordKind(v: string | null): v is RecordKind {
  return RECORD_KINDS.includes(v as RecordKind);
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

    // An unrecognised kind is rejected, not ignored — falling back to the
    // unfiltered list would return strictly more than the caller asked for.
    const kindParam = new URL(req.url).searchParams.get("kind");
    if (kindParam !== null && !isRecordKind(kindParam)) {
      return NextResponse.json(
        { ok: false, error: `Unknown record kind "${kindParam}".` },
        { status: 400 },
      );
    }

    const records = await listRecords(authd.userId, kindParam ?? undefined);
    return NextResponse.json({ ok: true, records });
  } catch (err) {
    return errorResponse(err, "personalization.records.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "personalization.records.post", 120);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const body = await parseBody(req, RecordUpsertSchema);
    if (!body.ok) return body.response;

    const record = await upsertRecord(authd.userId, body.data);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "That entry could not be saved." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "personalization.records.post");
  }
}
