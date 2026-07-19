import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { getProduct } from "@/lib/catalog/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { selectionWasRelaxed } from "@/lib/catalog/variant-select";

export const runtime = "nodejs";

const BodySchema = z.object({
  productId: z.string().min(1).max(300),
  selected: z.record(z.string(), z.string()).nullable().optional(),
  preferenceOrder: z.array(z.string()).max(10).nullable().optional(),
  context: z
    .object({
      country: z.string().length(2),
      currency: z.string().length(3).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(req: Request) {
  const limited = guardRate(req, "gift-product", 30);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  try {
    const trace = new TraceCollector();
    const result = await getProduct(
      {
        productId: body.data.productId,
        selected: body.data.selected ?? null,
        preferenceOrder: body.data.preferenceOrder ?? null,
        context: body.data.context
          ? {
              country: body.data.context.country,
              currency: body.data.context.currency ?? null,
            }
          : null,
      },
      trace,
    );
    const relaxedOptions = selectionWasRelaxed(
      result.selectedVariant,
      body.data.selected ?? null,
    );
    return NextResponse.json({
      ok: true,
      product: result.product,
      selectedVariant: result.selectedVariant,
      relaxedOptions,
      source: result.source,
      messages: result.messages,
      trace: trace.list(),
    });
  } catch (err) {
    return errorResponse(err, "gift/product");
  }
}
