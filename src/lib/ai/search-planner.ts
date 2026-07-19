import "server-only";
import { logger } from "@/lib/logger";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";
import { GIFTLENS_SYSTEM } from "./intent";
import { SearchPlanSchema, type GiftIntent, type SearchPlan } from "./schemas";

/**
 * Turns a GiftIntent into exactly three search strategies:
 * literal, adjacent, wildcard.
 */

export function heuristicPlan(intent: GiftIntent): SearchPlan {
  const interest = intent.recipient.interests[0] ?? intent.searchThemes[0] ?? "gift";
  const secondInterest =
    intent.recipient.interests[1] ?? intent.searchThemes[1] ?? "";
  const occasion = intent.occasion ?? "gift";
  const style = intent.giftStyle && intent.giftStyle !== "mixed" ? intent.giftStyle : "";
  const styleWord =
    intent.softPreferences.find((p) => /minimal|scandinavian|design/i.test(p)) ??
    style;

  return SearchPlanSchema.parse({
    strategies: [
      {
        strategy: "literal",
        query: [styleWord, interest, occasion, "gift"]
          .filter(Boolean)
          .join(" ")
          .trim(),
        rationale: "Directly represents the stated need.",
      },
      {
        strategy: "adjacent",
        query: [
          "compact",
          interest,
          secondInterest || "accessories",
          `for a ${intent.recipient.relationship ?? "loved one"}`,
        ]
          .filter(Boolean)
          .join(" "),
        rationale: "Related experience or use case rather than the obvious product.",
      },
      {
        strategy: "wildcard",
        query: [
          "unique",
          styleWord || "thoughtful",
          secondInterest || occasion,
          "object",
          interest && `for a ${interest} enthusiast`,
        ]
          .filter(Boolean)
          .join(" "),
        rationale: "Surprising but defensible gift angle.",
      },
    ],
  });
}

const PLAN_PROMPT = (intent: GiftIntent) => `Design exactly three Shopify catalog search strategies for this gift intent:

${JSON.stringify(intent, null, 2)}

Return JSON:
{
  "strategies": [
    { "strategy": "literal",  "query": "...", "rationale": "..." },
    { "strategy": "adjacent", "query": "...", "rationale": "..." },
    { "strategy": "wildcard", "query": "...", "rationale": "..." }
  ]
}

Guidance:
- "literal" directly represents the shopper's stated need (e.g. "minimalist pour-over coffee housewarming gift").
- "adjacent" targets a related experience or use case, not the most obvious product (e.g. "compact coffee ritual accessories for a design lover").
- "wildcard" seeks a surprising but defensible gift (e.g. "small Scandinavian kitchen object for a coffee enthusiast").
- Queries are retail search phrases, 4-10 words, no budget numbers (budget is applied as a hard filter separately).
- Respect dislikes and exclusions by not steering queries toward them.`;

export async function planSearches(
  intent: GiftIntent,
): Promise<{ plan: SearchPlan; aiMode: AiMode }> {
  if (!aiAvailable()) {
    return { plan: heuristicPlan(intent), aiMode: "heuristic" };
  }
  try {
    const plan = await structuredCompletion(
      GIFTLENS_SYSTEM,
      PLAN_PROMPT(intent),
      SearchPlanSchema,
      { maxTokens: 800 },
    );
    return { plan, aiMode: "ai" };
  } catch (err) {
    logger.warn("search planning via Claude failed; using heuristic plan", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { plan: heuristicPlan(intent), aiMode: "heuristic" };
  }
}
