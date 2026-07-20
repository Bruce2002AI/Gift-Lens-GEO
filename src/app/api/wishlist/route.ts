import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { guardRate, parseBody, errorResponse } from "@/lib/api";
import { addWishlist, listWishlist, removeWishlist } from "@/lib/wishlist/store";

export const runtime = "nodejs";

const ratingSchema = z
  .object({
    value: z.number().nullable(),
    scaleMax: z.number().nullable(),
    count: z.number().nullable(),
  })
  .nullable();

const itemSchema = z.object({
  productId: z.string().min(1).max(256),
  source: z.enum(["live", "mock"]),
  title: z.string().max(512),
  imageUrl: z.string().max(2048).nullable(),
  url: z.string().max(2048).nullable(),
  priceMinor: z.number().nullable(),
  priceMaxMinor: z.number().nullable(),
  currency: z.string().max(8).nullable(),
  brand: z.string().max(256).nullable(),
  rating: ratingSchema,
  available: z.boolean().nullable(),
});

const removeSchema = z.object({
  productId: z.string().min(1).max(256),
  source: z.enum(["live", "mock"]),
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
        { ok: false, error: "You must be signed in to use your wishlist." },
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
    const items = await listWishlist(authd.userId);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return errorResponse(err, "wishlist.get");
  }
}

export async function POST(req: Request) {
  try {
    const limited = guardRate(req, "wishlist.post", 60);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const body = await parseBody(req, itemSchema);
    if (!body.ok) return body.response;
    const item = await addWishlist(authd.userId, body.data);
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return errorResponse(err, "wishlist.post");
  }
}

export async function DELETE(req: Request) {
  try {
    const limited = guardRate(req, "wishlist.delete", 60);
    if (limited) return limited;
    const authd = await requireUserId();
    if (!authd.ok) return authd.response;
    const body = await parseBody(req, removeSchema);
    if (!body.ok) return body.response;
    await removeWishlist(authd.userId, body.data.productId, body.data.source);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "wishlist.delete");
  }
}
