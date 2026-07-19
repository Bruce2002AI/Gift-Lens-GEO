import { z } from "zod";
import { NextResponse } from "next/server";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { runGeoAudit } from "@/lib/geo/orchestration";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({
  productUrl: z.string().min(4).max(2000),
  country: z.string().length(2),
  currency: z.string().length(3),
  audience: z.string().max(120).nullable().optional(),
  occasion: z.string().max(120).nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  positioning: z.string().max(300).nullable().optional(),
  customPrompts: z.array(z.string().min(4).max(200)).max(12).nullable().optional(),
});

export async function POST(req: Request) {
  // The audit fans out ~12 catalog calls — keep the limit tight.
  const limited = guardRate(req, "geo-audit", 6);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  try {
    const result = await runGeoAudit({
      productUrl: body.data.productUrl,
      country: body.data.country.toUpperCase(),
      currency: body.data.currency.toUpperCase(),
      audience: body.data.audience ?? null,
      occasion: body.data.occasion ?? null,
      budgetMax: body.data.budgetMax ?? null,
      positioning: body.data.positioning ?? null,
      customPrompts: body.data.customPrompts ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "geo/audit");
  }
}
