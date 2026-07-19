import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, guardRate, parseBody } from "@/lib/api";
import { runAgent } from "@/lib/modes/engine";
import { MODE_IDS } from "@/lib/modes/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const BlueprintSchema = z.object({
  components: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        why: z.string(),
        essential: z.boolean(),
        query: z.string().min(1),
        budgetWeight: z.number(),
        group: z.string().nullable(),
      }),
    )
    .min(1)
    .max(8),
  note: z.string().nullable(),
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
      occasion: z.string().max(120).nullable().optional(),
      relationship: z.string().max(120).nullable().optional(),
    })
    .optional(),
  modeId: z.enum(MODE_IDS).optional(),
  clarificationCount: z.number().int().min(0).max(5).optional(),
  approved: z.boolean().optional(),
  blueprint: BlueprintSchema.optional(),
  likeProductId: z.string().max(300).nullable().optional(),
});

export async function POST(req: Request) {
  const limited = guardRate(req, "agent", 12);
  if (limited) return limited;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;

  const { conversation, form, modeId, clarificationCount, approved, blueprint, likeProductId } =
    body.data;

  try {
    const result = await runAgent({
      conversation,
      form,
      modeId,
      clarificationCount,
      approved,
      blueprint,
      like: likeProductId ? { productId: likeProductId } : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "agent");
  }
}
