import "server-only";
import {
  GIFTLENS_SYSTEM,
  INTENT_PROMPT,
  finalizeIntent,
  heuristicIntent,
  type IntentFormFields,
} from "@/lib/ai/intent";
import { heuristicPlan } from "@/lib/ai/search-planner";
import { GiftIntentSchema, RawIntentSchema, type GiftIntent } from "@/lib/ai/schemas";
import { giftToBaseIntent } from "@/lib/gift/base-intent";
import { MODE_META } from "../meta";
import type { AgentFormFields, ShoppingMode } from "../types";

/**
 * GiftLens — the flagship "picks" mode. Reuses the existing, hand-tuned gift
 * extraction, planning, and projection so the unified agent's gift lens is
 * identical to the dedicated concierge.
 */
const gift: ShoppingMode = {
  meta: MODE_META.gift,
  intentSchema: GiftIntentSchema,
  rawSchema: RawIntentSchema,
  persona: GIFTLENS_SYSTEM,
  noun: "gift",
  extractPrompt: (conversation, form) =>
    INTENT_PROMPT(conversation, form as IntentFormFields | undefined),
  finalizeIntent: (raw, form) =>
    finalizeIntent(
      raw as Parameters<typeof finalizeIntent>[0],
      form as IntentFormFields | undefined,
    ),
  heuristicIntent: (conversation, form) =>
    heuristicIntent(conversation, form as IntentFormFields | undefined),
  toBaseIntent: (intent) => giftToBaseIntent(intent as GiftIntent),
  clarifyMax: 2,
  planStrategies: (intent) => heuristicPlan(intent as GiftIntent),
};

export default gift;

// Re-export for the router/UI without importing server code.
export type { AgentFormFields };
