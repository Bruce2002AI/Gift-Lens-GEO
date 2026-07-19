import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { searchCatalog } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";

export const runtime = "nodejs";

const BodySchema = z.object({
  query: z.string().min(1).max(400).optional(),
  likeProductId: z.string().max(300).nullable().optional(),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  priceMaxMinor: z.number().int().nonnegative().nullable().optional(),
  priceMinMinor: z.number().int().nonnegative().nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  const limited = guardRate(req, "catalog-search", 30);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;
  const d = body.data;
  if (!d.query && !d.likeProductId) {
    return NextResponse.json(
      { ok: false, error: "Provide a query or a likeProductId." },
      { status: 400 },
    );
  }

  try {
    const trace = new TraceCollector();
    const result = await searchCatalog(
      {
        query: d.query,
        like: d.likeProductId ? { productId: d.likeProductId } : null,
        context: d.country
          ? { country: d.country, currency: d.currency ?? null }
          : null,
        filters: {
          available: true,
          shipsTo: d.country,
          priceMinMinor: d.priceMinMinor ?? null,
          priceMaxMinor: d.priceMaxMinor ?? null,
        },
        limit: d.limit ?? 20,
      },
      trace,
    );
    return NextResponse.json({
      ok: true,
      products: result.products,
      source: result.source,
      messages: result.messages,
      trace: trace.list(),
    });
  } catch (err) {
    return errorResponse(err, "catalog/search");
  }
}
