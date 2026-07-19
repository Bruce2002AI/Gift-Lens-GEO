import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { GiftIntentSchema } from "@/lib/ai/schemas";
import { interpretRefinement } from "@/lib/ai/refine";
import { TraceCollector } from "@/lib/catalog/trace";
import { runGiftPipeline } from "@/lib/gift/orchestration";

export const runtime = "nodejs";
export const maxDuration = 90;

const BodySchema = z.object({
  intent: GiftIntentSchema,
  message: z.string().min(1).max(500),
  /** Optional similarity seed ("same vibe" / "show similar alternatives"). */
  likeProductId: z.string().max(300).nullable().optional(),
});

export async function POST(req: Request) {
  const limited = guardRate(req, "refine", 15);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  try {
    const { intent: updated, note, aiMode } = await interpretRefinement(
      body.data.intent,
      body.data.message,
    );
    const trace = new TraceCollector();
    const result = await runGiftPipeline(updated, trace, {
      like: body.data.likeProductId
        ? { productId: body.data.likeProductId }
        : undefined,
    });
    return NextResponse.json({
      ok: true,
      stage: "recommendations",
      assistantMessage: note,
      intent: updated,
      aiMode: result.aiMode === "heuristic" || aiMode === "heuristic" ? "heuristic" : "ai",
      source: result.source,
      recommendations: result.recommendations,
      limitation: result.limitation,
      trace: trace.list(),
    });
  } catch (err) {
    return errorResponse(err, "gift/refine");
  }
}
