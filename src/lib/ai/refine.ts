import "server-only";
import { majorToMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";
import { GIFTLENS_SYSTEM } from "./intent";
import {
  GiftIntentSchema,
  RefinementSchema,
  type GiftIntent,
  type Refinement,
} from "./schemas";

/**
 * Interpret refinement actions (chips or free text) as GiftIntent patches.
 * Known chips map deterministically; free text goes to Claude when available.
 */

const CHIP_PATCHES: Record<string, Refinement> = {
  "more personal": {
    updatedIntentPatch: {
      giftStyle: "sentimental",
      addSoftPreferences: ["personal", "meaningful"],
    },
    note: "Leaning more personal and meaningful.",
  },
  "more unique": {
    updatedIntentPatch: {
      giftStyle: "unique",
      addSoftPreferences: ["unusual", "distinctive"],
    },
    note: "Searching for more distinctive options.",
  },
  "more practical": {
    updatedIntentPatch: {
      giftStyle: "practical",
      addSoftPreferences: ["useful", "everyday"],
    },
    note: "Prioritizing practical, everyday usefulness.",
  },
  "more sentimental": {
    updatedIntentPatch: {
      giftStyle: "sentimental",
      addSoftPreferences: ["sentimental"],
    },
    note: "Prioritizing sentiment over utility.",
  },
  "safer choice": {
    updatedIntentPatch: {
      giftStyle: "safe",
      addSoftPreferences: ["broadly appealing", "low-risk"],
    },
    note: "Choosing broadly appealing, low-risk options.",
  },
  "lower budget": {
    updatedIntentPatch: {},
    note: "__lower_budget__",
  },
  "premium option": {
    updatedIntentPatch: {
      giftStyle: "luxurious",
      addSoftPreferences: ["premium"],
    },
    note: "__raise_budget__",
  },
  "arrives sooner": {
    updatedIntentPatch: {
      addSoftPreferences: ["fast shipping"],
    },
    note: "The Catalog confirms shipping eligibility but not delivery timing, so GiftLens prioritizes available, ready-to-ship products without promising a delivery date.",
  },
  "same vibe": {
    updatedIntentPatch: {},
    note: "Keeping the same style and searching for close alternatives.",
  },
  "different category": {
    updatedIntentPatch: { addSoftPreferences: ["different product category"] },
    note: "Exploring different product categories.",
  },
};

export function applyPatch(intent: GiftIntent, refinement: Refinement): GiftIntent {
  const p = refinement.updatedIntentPatch;
  let budgetMax = p.budgetMaxMajor !== undefined ? p.budgetMaxMajor : intent.budget.maxMajor;
  let budgetMin = p.budgetMinMajor !== undefined ? p.budgetMinMajor : intent.budget.minMajor;
  if (refinement.note === "__lower_budget__") {
    budgetMax = intent.budget.maxMajor != null ? Math.round(intent.budget.maxMajor * 0.7) : null;
  }
  if (refinement.note === "__raise_budget__") {
    budgetMax = intent.budget.maxMajor != null ? Math.round(intent.budget.maxMajor * 1.5) : null;
    budgetMin = null;
  }
  const currency = intent.budget.currency;
  const next: GiftIntent = {
    ...intent,
    giftStyle: p.giftStyle !== undefined ? p.giftStyle : intent.giftStyle,
    recipient: {
      ...intent.recipient,
      interests: dedupe([
        ...intent.recipient.interests,
        ...(p.addInterests ?? []),
      ]),
      dislikes: dedupe([...intent.recipient.dislikes, ...(p.addDislikes ?? [])]),
    },
    hardConstraints: dedupe([
      ...intent.hardConstraints,
      ...(p.addHardConstraints ?? []),
    ]),
    softPreferences: dedupe([
      ...intent.softPreferences,
      ...(p.addSoftPreferences ?? []),
    ]),
    searchThemes: p.searchThemes && p.searchThemes.length > 0
      ? p.searchThemes
      : intent.searchThemes,
    budget: {
      minMajor: budgetMin,
      maxMajor: budgetMax,
      minMinor: majorToMinor(budgetMin, currency),
      maxMinor: majorToMinor(budgetMax, currency),
      currency,
    },
  };
  return GiftIntentSchema.parse(next);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function publicNote(refinement: Refinement, intent: GiftIntent): string {
  if (refinement.note === "__lower_budget__") {
    return intent.budget.maxMajor != null
      ? `Lowered the budget cap to about ${Math.round(intent.budget.maxMajor * 0.7)} ${intent.budget.currency}.`
      : "Prioritizing lower-priced options.";
  }
  if (refinement.note === "__raise_budget__") {
    return "Exploring premium options with a roomier budget.";
  }
  return refinement.note;
}

const REFINE_PROMPT = (intent: GiftIntent, message: string) => `The shopper wants to refine their gift search.

Current intent:
${JSON.stringify(intent, null, 2)}

Shopper's refinement request: "${message}"

Return JSON:
{
  "updatedIntentPatch": {
    "giftStyle": optional new style or null,
    "budgetMaxMajor": optional new max budget in MAJOR units,
    "budgetMinMajor": optional new min budget in MAJOR units,
    "addInterests": optional string[],
    "addDislikes": optional string[],
    "addHardConstraints": optional string[],
    "addSoftPreferences": optional string[],
    "searchThemes": optional replacement string[] of 3-6 search themes
  },
  "note": "one sentence telling the shopper how you adjusted the search"
}

Only patch fields the request actually changes. Never promise delivery dates.`;

export async function interpretRefinement(
  intent: GiftIntent,
  message: string,
): Promise<{ intent: GiftIntent; note: string; aiMode: AiMode }> {
  const chip = CHIP_PATCHES[message.trim().toLowerCase()];
  if (chip) {
    const updated = applyPatch(intent, chip);
    return { intent: updated, note: publicNote(chip, intent), aiMode: "heuristic" };
  }
  if (!aiAvailable()) {
    // Free-text without Claude: treat the message as an added soft preference/theme.
    const fallback: Refinement = {
      updatedIntentPatch: {
        addSoftPreferences: [message.trim()],
        searchThemes: dedupe([...intent.searchThemes, message.trim()]).slice(-6),
      },
      note: `Added "${message.trim()}" to the search focus.`,
    };
    return {
      intent: applyPatch(intent, fallback),
      note: fallback.note,
      aiMode: "heuristic",
    };
  }
  try {
    const refinement = await structuredCompletion(
      GIFTLENS_SYSTEM,
      REFINE_PROMPT(intent, message),
      RefinementSchema,
      { maxTokens: 800 },
    );
    return {
      intent: applyPatch(intent, refinement),
      note: refinement.note,
      aiMode: "ai",
    };
  } catch (err) {
    logger.warn("refinement via Claude failed; using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    const fallback: Refinement = {
      updatedIntentPatch: { addSoftPreferences: [message.trim()] },
      note: `Added "${message.trim()}" to the search focus.`,
    };
    return {
      intent: applyPatch(intent, fallback),
      note: fallback.note,
      aiMode: "heuristic",
    };
  }
}
