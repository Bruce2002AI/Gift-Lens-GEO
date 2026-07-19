import "server-only";
import { aiAvailable, structuredCompletion, type AiMode } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import type { AgentFormFields, ConversationTurn, ShoppingMode } from "./types";

/**
 * Generic intent extraction: run the mode's extraction prompt against its raw
 * schema, then finalize (minor units, form overrides). Falls back to the mode's
 * deterministic heuristic when no model is available or the call fails.
 */
export async function extractModeIntent(
  mode: ShoppingMode,
  conversation: ConversationTurn[],
  form?: AgentFormFields,
): Promise<{ intent: unknown; aiMode: AiMode }> {
  if (!aiAvailable()) {
    return { intent: mode.heuristicIntent(conversation, form), aiMode: "heuristic" };
  }
  try {
    const raw = await structuredCompletion(
      mode.persona,
      mode.extractPrompt(conversation, form),
      mode.rawSchema,
      { maxTokens: 1400 },
    );
    return { intent: mode.finalizeIntent(raw, form), aiMode: "ai" };
  } catch (err) {
    logger.warn("mode intent extraction failed; using heuristic", {
      mode: mode.meta.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { intent: mode.heuristicIntent(conversation, form), aiMode: "heuristic" };
  }
}
