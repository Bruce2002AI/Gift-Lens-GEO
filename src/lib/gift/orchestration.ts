import "server-only";
import { extractIntentAndPlan } from "@/lib/ai/concierge-intent";
import { GIFTLENS_SYSTEM } from "@/lib/ai/intent";
import type { ConversationTurn, IntentFormFields } from "@/lib/ai/intent";
import { planSearches } from "@/lib/ai/search-planner";
import type { GiftIntent, SearchPlan } from "@/lib/ai/schemas";
import { TraceCollector } from "@/lib/catalog/trace";
import type { SearchParams } from "@/lib/catalog/types";
import type { AiMode } from "@/lib/modes/types";
import {
  buyerContext,
  runPicksPipeline,
  searchParamsFor,
  type PicksPipelineResult,
} from "@/lib/modes/picks-pipeline";
import { giftToBaseIntent } from "./base-intent";
import type { ConciergeResponse } from "./types";

/**
 * Gift concierge = the "picks" pipeline, pinned to the gift mode. The heavy
 * lifting lives in the shared engine (src/lib/modes/picks-pipeline.ts); this
 * file adds gift-specific extraction, the clarification gate, and search
 * planning. buyerContext/searchParamsFor are re-exported for link-check.
 */

export { buyerContext, searchParamsFor };

export async function runGiftPipeline(
  intent: GiftIntent,
  trace: TraceCollector,
  opts: {
    like?: SearchParams["like"];
    prePlan?: { plan: SearchPlan; aiMode: AiMode };
  } = {},
): Promise<PicksPipelineResult> {
  const base = giftToBaseIntent(intent);
  const { plan, aiMode: planMode } = opts.prePlan ?? (await planSearches(intent));
  const broadenQuery = [
    intent.recipient.interests[0] ?? intent.searchThemes[0] ?? "gift",
    intent.occasion ?? "gift",
  ]
    .filter(Boolean)
    .join(" ");
  return runPicksPipeline({
    intent: base,
    plan: { strategies: plan.strategies, aiMode: planMode },
    trace,
    like: opts.like,
    persona: GIFTLENS_SYSTEM,
    noun: "gift",
    broadenQuery,
  });
}

export async function runConcierge(input: {
  conversation: ConversationTurn[];
  form?: IntentFormFields;
  clarificationCount?: number;
}): Promise<ConciergeResponse> {
  const trace = new TraceCollector();
  // One merged model call extracts the intent AND plans the three searches.
  const { intent, plan, aiMode } = await extractIntentAndPlan(input.conversation, input.form);
  trace.add({
    tool: "ai",
    label: `Extracted gift intent (${aiMode})`,
    detail: `country=${intent.destination.country} budget=${intent.budget.maxMajor ?? "?"} ${intent.budget.currency}`,
    durationMs: 0,
    source: "live",
    ok: true,
  });

  if (
    intent.clarificationNeeded &&
    intent.clarificationQuestion &&
    (input.clarificationCount ?? 0) < 2
  ) {
    return {
      ok: true,
      stage: "clarification",
      clarificationQuestion: intent.clarificationQuestion,
      intent,
      aiMode,
      source: "live",
      recommendations: [],
      trace: trace.list(),
    };
  }

  const result = await runGiftPipeline(intent, trace, { prePlan: { plan, aiMode } });
  return {
    ok: true,
    stage: "recommendations",
    intent,
    aiMode: result.aiMode === "heuristic" || aiMode === "heuristic" ? "heuristic" : "ai",
    source: result.source,
    recommendations: result.recommendations,
    limitation: result.limitation,
    trace: trace.list(),
  };
}
