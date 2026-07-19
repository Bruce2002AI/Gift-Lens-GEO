import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { GiftIntentSchema } from "@/lib/ai/schemas";
import { TraceCollector } from "@/lib/catalog/trace";
import { checkProductLink } from "@/lib/gift/link-check";
import { validateProductUrl } from "@/lib/geo/orchestration";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  url: z.string().min(4).max(2000),
  intent: GiftIntentSchema.nullable().optional(),
});

/** Default intent when the shopper pastes a link without chatting first. */
const NEUTRAL_INTENT = GiftIntentSchema.parse({
  recipient: {
    relationship: null,
    ageBand: null,
    interests: [],
    dislikes: [],
    personalityTraits: [],
  },
  occasion: null,
  giftStyle: null,
  budget: { minMajor: null, maxMajor: null, minMinor: null, maxMinor: null, currency: "USD" },
  destination: { country: "US", region: null, city: null, postalCode: null },
  deadline: null,
  physicality: "either",
  hardConstraints: [],
  softPreferences: [],
  searchThemes: [],
  clarificationNeeded: false,
  clarificationQuestion: null,
});

export async function POST(req: Request) {
  const limited = guardRate(req, "gift-link", 10);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  const identifier = validateProductUrl(body.data.url);
  if (!identifier) {
    return NextResponse.json(
      { ok: false, error: "Paste a valid http(s) Shopify product URL." },
      { status: 400 },
    );
  }

  try {
    const trace = new TraceCollector();
    const result = await checkProductLink(
      identifier,
      body.data.intent ?? NEUTRAL_INTENT,
      trace,
    );
    return NextResponse.json({ ...result, trace: trace.list() });
  } catch (err) {
    return errorResponse(err, "gift/link");
  }
}
