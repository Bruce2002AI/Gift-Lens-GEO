import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { lookupCatalog } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";

export const runtime = "nodejs";

const BodySchema = z.object({
  ids: z.array(z.string().min(1).max(2000)).min(1).max(50),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
});

export async function POST(req: Request) {
  const limited = guardRate(req, "catalog-lookup", 30);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  try {
    const trace = new TraceCollector();
    const result = await lookupCatalog(
      body.data.ids,
      body.data.country
        ? { country: body.data.country, currency: body.data.currency ?? null }
        : null,
      trace,
    );
    return NextResponse.json({
      ok: true,
      products: result.products,
      notFound: result.notFound,
      source: result.source,
      messages: result.messages,
      trace: trace.list(),
    });
  } catch (err) {
    return errorResponse(err, "catalog/lookup");
  }
}
