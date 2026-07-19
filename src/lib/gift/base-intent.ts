import type { GiftIntent } from "@/lib/ai/schemas";
import type { BaseIntent } from "@/lib/modes/types";

/**
 * Project a rich GiftIntent onto the shared BaseIntent the engine
 * (constraints / ranking / reranker / explanations) operates on. Pure, so it is
 * safe to import from tests and non-server modules.
 */
export function giftToBaseIntent(intent: GiftIntent): BaseIntent {
  return {
    budget: intent.budget,
    destination: intent.destination,
    physicality: intent.physicality,
    deadline: intent.deadline,
    hardConstraints: intent.hardConstraints,
    exclusions: intent.recipient.dislikes,
    softPreferences: intent.softPreferences,
    searchThemes: intent.searchThemes,
    interests: intent.recipient.interests,
    occasion: intent.occasion,
    styleKeywords:
      intent.giftStyle && intent.giftStyle !== "mixed" ? [intent.giftStyle] : [],
    clarificationNeeded: intent.clarificationNeeded,
    clarificationQuestion: intent.clarificationQuestion,
  };
}
