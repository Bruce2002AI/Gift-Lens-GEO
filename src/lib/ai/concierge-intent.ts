import "server-only";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";
import {
  GIFTLENS_SYSTEM,
  finalizeIntent,
  heuristicIntent,
  type ConversationTurn,
  type IntentFormFields,
} from "./intent";
import { heuristicPlan } from "./search-planner";
import {
  RawIntentSchema,
  SearchPlanSchema,
  SearchStrategySchema,
  type GiftIntent,
  type SearchPlan,
} from "./schemas";

/**
 * Combined intent-extraction + search-planning in a SINGLE model call.
 *
 * The concierge's first turn previously made two sequential LLM round-trips
 * (extract intent, then plan searches). Since the plan is a pure function of
 * the intent, one structured call returns both — halving first-response
 * latency so GiftLens feels like a friend who answers quickly, not a form.
 */

const IntentWithPlanSchema = RawIntentSchema.extend({
  searchStrategies: z.array(SearchStrategySchema).length(3),
});

const PROMPT = (conversation: ConversationTurn[], form?: IntentFormFields) => `A shopper is chatting with you about a gift. Understand what they need, then plan three catalog searches.

Conversation:
${conversation.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n")}

${form ? `Structured fields the shopper filled in (authoritative):\n${JSON.stringify(form)}` : ""}

Return JSON with this exact shape:
{
  "recipient": { "relationship": string|null, "ageBand": string|null, "interests": string[], "dislikes": string[], "personalityTraits": string[] },
  "occasion": string|null,
  "giftStyle": "practical"|"sentimental"|"playful"|"luxurious"|"unique"|"safe"|"mixed"|null,
  "budget": { "minMajor": number|null, "maxMajor": number|null, "currency": "ISO 4217 code" },
  "destination": { "country": "ISO 3166-1 alpha-2", "region": string|null, "city": string|null, "postalCode": string|null },
  "deadline": string|null,
  "physicality": "physical"|"digital"|"either",
  "hardConstraints": string[],
  "softPreferences": string[],
  "searchThemes": string[],
  "clarificationNeeded": boolean,
  "clarificationQuestion": string|null,
  "searchStrategies": [
    { "strategy": "literal",  "query": "...", "rationale": "..." },
    { "strategy": "adjacent", "query": "...", "rationale": "..." },
    { "strategy": "wildcard", "query": "...", "rationale": "..." }
  ]
}

Rules:
- Budgets are MAJOR units (4000 = ₹4,000). Use ISO country/currency codes; infer country from a city (Bengaluru → IN).
- clarificationNeeded=true ONLY if you genuinely can't search well yet (e.g. no interests AND no budget). Otherwise make a friendly assumption and set false. Max one warm, natural question.
- searchStrategies: "literal" = the obvious product; "adjacent" = a related experience/use-case; "wildcard" = a surprising but defensible angle. Each query is a 4-10 word retail phrase with no budget numbers. Respect dislikes/exclusions.`;

export async function extractIntentAndPlan(
  conversation: ConversationTurn[],
  form?: IntentFormFields,
): Promise<{ intent: GiftIntent; plan: SearchPlan; aiMode: AiMode }> {
  if (!aiAvailable()) {
    const intent = heuristicIntent(conversation, form);
    return { intent, plan: heuristicPlan(intent), aiMode: "heuristic" };
  }
  try {
    const raw = await structuredCompletion(
      GIFTLENS_SYSTEM,
      PROMPT(conversation, form),
      IntentWithPlanSchema,
      { maxTokens: 1800 },
    );
    const { searchStrategies, ...intentRaw } = raw;
    const intent = finalizeIntent(intentRaw, form);
    const plan = SearchPlanSchema.parse({ strategies: searchStrategies });
    return { intent, plan, aiMode: "ai" };
  } catch (err) {
    logger.warn("combined intent+plan failed; using heuristic", {
      error: err instanceof Error ? err.message : String(err),
    });
    const intent = heuristicIntent(conversation, form);
    return { intent, plan: heuristicPlan(intent), aiMode: "heuristic" };
  }
}
