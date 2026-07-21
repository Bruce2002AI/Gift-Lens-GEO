import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { listSubjects, resolveOrCreateSubject } from "@/lib/personalization/subjects";
import { SubjectCreateSchema } from "@/lib/personalization/types";

export const runtime = "nodejs";

/**
 * Subjects: the people a shopper keeps profiles for.
 *
 * The user id comes from the session alone, so a body or query can never read
 * or write another shopper's people. `self` is virtual — it is returned by the
 * list but can never be created or deleted.
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
        { ok: false, error: "You must be signed in to manage profiles." },
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
    const subjects = await listSubjects(authd.userId);
    return NextResponse.json({ ok: true, subjects });
  } catch (err) {
    return errorResponse(err, "personalization.subjects.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "personalization.subjects.post", 40);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;

    const body = await parseBody(req, SubjectCreateSchema);
    if (!body.ok) return body.response;

    // A person the shopper adds by hand is `createdBy: "user"`.
    const result = await resolveOrCreateSubject(authd.userId, {
      name: body.data.name,
      relationship: body.data.relationship ?? null,
      createdBy: "user",
    });
    if (!result) {
      return NextResponse.json(
        { ok: false, error: "That profile could not be created." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: true, subject: result.subject, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    return errorResponse(err, "personalization.subjects.post");
  }
}
