import "server-only";
import { z } from "zod";
import { aiAvailable, structuredCompletion } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { MODE_META } from "./meta";
import { SHOPLENS_SYSTEM } from "./skills/_shared";
import { MODE_IDS, type ConversationTurn, type ShoppingModeId } from "./types";

/**
 * Routes a conversation to one of the 10 shopping lenses. LLM classifier with a
 * deterministic keyword fallback; the caller can override with an explicit
 * modeId (e.g. the user tapped a lens in the picker).
 */

const RouteSchema = z.object({
  modeId: z.enum(MODE_IDS),
  confidence: z.number().min(0).max(1),
});

export function heuristicRoute(text: string): { modeId: ShoppingModeId; confidence: number } {
  const lower = text.toLowerCase();
  let best: ShoppingModeId = "gift";
  let bestHits = 0;
  for (const id of MODE_IDS) {
    const hits = MODE_META[id].keywords.reduce(
      (n, k) => (lower.includes(k) ? n + 1 : n),
      0,
    );
    if (hits > bestHits) {
      best = id;
      bestHits = hits;
    }
  }
  const confidence = bestHits === 0 ? 0.25 : Math.min(1, 0.5 + bestHits * 0.2);
  return { modeId: best, confidence };
}

export async function routeMessage(
  conversation: ConversationTurn[],
): Promise<{ modeId: ShoppingModeId; confidence: number; aiMode: "ai" | "heuristic" }> {
  const text = conversation
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join("\n");
  const heur = heuristicRoute(text);
  if (!aiAvailable()) return { ...heur, aiMode: "heuristic" };

  const catalog = MODE_IDS.map(
    (id) => `- ${id} (${MODE_META[id].name}): ${MODE_META[id].routeExamples.join("; ")}`,
  ).join("\n");
  try {
    const route = await structuredCompletion(
      SHOPLENS_SYSTEM,
      `Classify this shopper's message into exactly one shopping lens.

Lenses:
${catalog}

Message:
${text}

Return JSON: { "modeId": one of [${MODE_IDS.join(", ")}], "confidence": 0.0-1.0 }.
Pick "gift" for buying-for-someone-else; "swap" when they already have a specific product and want an alternative; a plan lens (skincare/style/nutrition/room/travel/hobby/lifestage/occasion) when they want a multi-item plan/kit/routine/outfit/bundle.`,
      RouteSchema,
      { maxTokens: 60 },
    );
    return { modeId: route.modeId, confidence: route.confidence, aiMode: "ai" };
  } catch (err) {
    logger.warn("route classification via model failed; using heuristic", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...heur, aiMode: "heuristic" };
  }
}
