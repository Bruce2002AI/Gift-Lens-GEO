import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { runConcierge, runGiftPipeline } from "@/lib/gift/orchestration";
import { extractIntentAndPlan } from "@/lib/ai/concierge-intent";
import { TraceCollector } from "@/lib/catalog/trace";

export const runtime = "nodejs";
export const maxDuration = 90;

const ImageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(16),
});

const BodySchema = z.object({
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
  form: z
    .object({
      budgetMin: z.number().nonnegative().nullable().optional(),
      budgetMax: z.number().nonnegative().nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      country: z.string().length(2).nullable().optional(),
      occasion: z.string().max(80).nullable().optional(),
      relationship: z.string().max(80).nullable().optional(),
    })
    .optional(),
  clarificationCount: z.number().int().min(0).max(5).optional(),
  image: ImageSchema.nullable().optional(),
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const limited = guardRate(req, "concierge", 10);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  const { conversation, form, clarificationCount, image } = body.data;

  // Image validation: type is schema-enforced; check decoded size here.
  // The image is used for this request only — never persisted, never logged.
  if (image) {
    const approxBytes = (image.base64.length * 3) / 4;
    if (approxBytes > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Image too large — maximum size is 5 MB." },
        { status: 413 },
      );
    }
  }

  try {
    if (!image) {
      const result = await runConcierge({ conversation, form, clarificationCount });
      return NextResponse.json(result);
    }

    // Multimodal path: text communicates gift intent, image communicates style.
    const trace = new TraceCollector();
    const { intent, plan, aiMode } = await extractIntentAndPlan(conversation, form);
    const dataUrl = `data:${image.mediaType};base64,${image.base64}`;
    const result = await runGiftPipeline(intent, trace, {
      like: { imageDataUrl: dataUrl },
      prePlan: { plan, aiMode },
    });
    return NextResponse.json({
      ok: true,
      stage: "recommendations",
      intent,
      aiMode: result.aiMode === "heuristic" || aiMode === "heuristic" ? "heuristic" : "ai",
      source: result.source,
      recommendations: result.recommendations,
      limitation: result.limitation,
      trace: trace.list(),
    });
  } catch (err) {
    return errorResponse(err, "gift/concierge");
  }
}
