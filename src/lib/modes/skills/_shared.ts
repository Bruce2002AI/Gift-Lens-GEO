import "server-only";
import { z } from "zod";
import { aiAvailable, structuredCompletion } from "@/lib/ai/client";
import { majorToMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import type {
  AgentFormFields,
  AiMode,
  BaseIntent,
  Blueprint,
  ConversationTurn,
  ModeMeta,
  PlanComponentSpec,
  SafetyPolicy,
  ShoppingMode,
  StrategyPlan,
} from "../types";

/**
 * Shared skill machinery. Most modes are built from a metadata descriptor + a
 * blueprint prompt (plan modes) or strategy hints (picks modes) via the
 * factories below, so a new lens is data, not a new pipeline. GiftLens and
 * RoutineLens (skincare) are hand-tuned references; the rest use these.
 */

export const SHOPLENS_SYSTEM = `You are ShopLens — one warm, flexible AI shopping agent with many "lenses". You meet people wherever they start, keep replies short and friendly, and turn a plain-language need into a concrete, buyable plan. You NEVER invent product facts (price, availability, materials, ingredients, dimensions, policies) — those come only from the live catalog. Hard constraints (budget, destination, availability, explicit exclusions) are firm. When unsure, say so.`;

// ---- Shared intent schemas -------------------------------------------------

const BudgetRawSchema = z.object({
  minMajor: z.number().nullable(),
  maxMajor: z.number().nullable(),
  currency: z.string().min(3).max(3),
});

const DestinationSchema = z.object({
  country: z.string().min(2).max(2),
  region: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
});

/** What the extraction model returns for a generic shopping intent. */
export const SharedRawSchema = z.looseObject({
  occasion: z.string().nullable(),
  interests: z.array(z.string()),
  exclusions: z.array(z.string()),
  softPreferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  searchThemes: z.array(z.string()),
  styleKeywords: z.array(z.string()),
  budget: BudgetRawSchema,
  destination: DestinationSchema,
  physicality: z.enum(["physical", "digital", "either"]),
  deadline: z.string().nullable(),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});
export type SharedRaw = z.infer<typeof SharedRawSchema>;

const BudgetFinalSchema = BudgetRawSchema.extend({
  minMinor: z.number().int().nullable(),
  maxMinor: z.number().int().nullable(),
});

/** The finalized generic intent — structurally a BaseIntent. */
export const SharedIntentSchema = z.object({
  occasion: z.string().nullable(),
  interests: z.array(z.string()),
  exclusions: z.array(z.string()),
  softPreferences: z.array(z.string()),
  hardConstraints: z.array(z.string()),
  searchThemes: z.array(z.string()),
  styleKeywords: z.array(z.string()),
  budget: BudgetFinalSchema,
  destination: DestinationSchema,
  physicality: z.enum(["physical", "digital", "either"]),
  deadline: z.string().nullable(),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export const BlueprintSchema = z.object({
  components: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        why: z.string(),
        essential: z.boolean(),
        query: z.string().min(2),
        budgetWeight: z.number().positive(),
        group: z.string().nullable(),
      }),
    )
    .min(1)
    .max(8),
  note: z.string().nullable(),
});

// ---- Helpers ---------------------------------------------------------------

export function finalizeSharedIntent(raw: SharedRaw, form?: AgentFormFields): BaseIntent {
  const currency = (form?.currency ?? raw.budget.currency ?? "INR").toUpperCase();
  const maxMajor = form?.budgetMax ?? raw.budget.maxMajor;
  const minMajor = form?.budgetMin ?? raw.budget.minMajor;
  return {
    budget: {
      minMajor,
      maxMajor,
      minMinor: majorToMinor(minMajor, currency),
      maxMinor: majorToMinor(maxMajor, currency),
      currency,
    },
    destination: {
      country: (form?.country ?? raw.destination.country ?? "IN").toUpperCase(),
      region: raw.destination.region,
      city: raw.destination.city,
      postalCode: raw.destination.postalCode,
    },
    physicality: raw.physicality,
    deadline: raw.deadline,
    hardConstraints: raw.hardConstraints,
    exclusions: raw.exclusions,
    softPreferences: raw.softPreferences,
    searchThemes: raw.searchThemes,
    interests: raw.interests,
    occasion: form?.occasion ?? raw.occasion,
    styleKeywords: raw.styleKeywords,
    clarificationNeeded: raw.clarificationNeeded,
    clarificationQuestion: raw.clarificationQuestion,
  };
}

/** Best-effort deterministic intent when no model is available. */
export function heuristicSharedIntent(
  conversation: ConversationTurn[],
  form?: AgentFormFields,
): BaseIntent {
  const text = conversation
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join(" ");
  const lower = text.toLowerCase();

  // Currency + budget.
  let currency = form?.currency?.toUpperCase() ?? "INR";
  if (!form?.currency) {
    if (/[$]|usd|dollar/.test(lower)) currency = "USD";
    else if (/€|eur/.test(lower)) currency = "EUR";
    else if (/£|gbp|pound/.test(lower)) currency = "GBP";
    else if (/₹|rs\.?|inr|rupee/.test(lower)) currency = "INR";
  }
  let maxMajor = form?.budgetMax ?? null;
  if (maxMajor == null) {
    const m = lower.match(/(?:under|below|budget|upto|up to|around|~|<)?\s*(?:₹|rs\.?|inr|\$|usd|€|£)?\s*([\d][\d,]{2,})/);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 50) maxMajor = n;
    }
  }
  const country = (form?.country ?? "IN").toUpperCase();

  // Light exclusion parsing ("no X", "without X", "avoid X").
  const exclusions: string[] = [];
  for (const m of lower.matchAll(/\b(?:no|without|avoid|not?)\s+([a-z][a-z\s-]{2,24}?)(?=[,.;!\n]|$| and | but | that )/g)) {
    const term = m[1].trim();
    if (term && !["idea", "one", "thing", "problem"].includes(term)) exclusions.push(term);
  }

  return {
    budget: {
      minMajor: form?.budgetMin ?? null,
      maxMajor,
      minMinor: majorToMinor(form?.budgetMin ?? null, currency),
      maxMinor: majorToMinor(maxMajor, currency),
      currency,
    },
    destination: { country, region: null, city: null, postalCode: null },
    physicality: "either",
    deadline: null,
    hardConstraints: [],
    exclusions,
    softPreferences: [],
    searchThemes: [],
    interests: [],
    occasion: form?.occasion ?? null,
    styleKeywords: [],
    clarificationNeeded: false,
    clarificationQuestion: null,
  };
}

function conversationText(conversation: ConversationTurn[]): string {
  return conversation.map((t) => `${t.role}: ${t.content}`).join("\n");
}

function extractionPrompt(
  guidance: string,
  conversation: ConversationTurn[],
  form?: AgentFormFields,
): string {
  return `Extract a structured shopping intent from this conversation.

${guidance}

Conversation:
${conversationText(conversation)}

Optional form fields (authoritative when present): ${JSON.stringify(form ?? {})}

Return JSON with EXACTLY these fields:
{
  "occasion": string|null (the goal/occasion in a few words),
  "interests": string[] (things the shopper cares about),
  "exclusions": string[] (things to avoid — dislikes, disliked ingredients/brands),
  "softPreferences": string[] (nice-to-have vibe/style words),
  "hardConstraints": string[] (firm requirements: "exclude: X", "must ship to Y"),
  "searchThemes": string[] (keywords to search),
  "styleKeywords": string[] (aesthetic/style tokens),
  "budget": { "minMajor": number|null, "maxMajor": number|null, "currency": "ISO-4217 3-letter, default INR" },
  "destination": { "country": "2-letter, default IN", "region": null, "city": string|null, "postalCode": null },
  "physicality": "physical"|"digital"|"either",
  "deadline": string|null,
  "clarificationNeeded": boolean (true only if a missing answer would materially change the plan),
  "clarificationQuestion": string|null (at most one, high-value question)
}

Do not invent product facts. Currency amounts are in MAJOR units (e.g. rupees, not paise).`;
}

// ---- Factories -------------------------------------------------------------

export interface PlanModeConfig {
  meta: ModeMeta;
  /** Extra guidance for the extraction model. */
  extractGuidance: string;
  /** Guidance for the blueprint model: which components to propose. */
  blueprintGuidance: string;
  /** Deterministic blueprint fallback. */
  heuristicComponents: (intent: BaseIntent) => PlanComponentSpec[];
  noun: string;
  persona?: string;
  safety?: SafetyPolicy;
  extraConstraints?: (product: import("@/lib/catalog/types").NormalizedProduct, intent: BaseIntent) => string[];
  clarifyMax?: number;
}

export function makePlanMode(config: PlanModeConfig): ShoppingMode {
  const persona = config.persona ?? SHOPLENS_SYSTEM;
  return {
    meta: config.meta,
    intentSchema: SharedIntentSchema,
    rawSchema: SharedRawSchema,
    persona,
    noun: config.noun,
    extractPrompt: (conversation, form) =>
      extractionPrompt(config.extractGuidance, conversation, form),
    finalizeIntent: (raw, form) => finalizeSharedIntent(raw as SharedRaw, form),
    heuristicIntent: (conversation, form) => heuristicSharedIntent(conversation, form),
    toBaseIntent: (intent) => intent as BaseIntent,
    clarifyMax: config.clarifyMax ?? 2,
    extraConstraints: config.extraConstraints
      ? (product, intent) => config.extraConstraints!(product, intent as BaseIntent)
      : undefined,
    safety: config.safety,
    buildBlueprint: async (intentRaw) => {
      const intent = intentRaw as BaseIntent;
      const heuristic = (): { blueprint: Blueprint; aiMode: AiMode } => ({
        blueprint: { components: config.heuristicComponents(intent), note: null },
        aiMode: "heuristic",
      });
      if (!aiAvailable()) return heuristic();
      try {
        const blueprint = await structuredCompletion(
          persona,
          `Design a shopping plan for this intent. Break it into ordered, buyable components.

${config.blueprintGuidance}

Intent:
${JSON.stringify(intent, null, 2)}

Return JSON:
{
  "components": [
    { "key": "short-id", "label": "Human label", "why": "why this belongs in the plan", "essential": true|false, "query": "catalog search phrase (4-8 words, no price numbers)", "budgetWeight": number (relative share), "group": string|null }
  ],
  "note": string|null
}

Rules: 3-7 components. Do not invent product facts; queries are retail search phrases. Respect exclusions and budget (budget is applied as a filter separately).`,
          BlueprintSchema,
          { maxTokens: 900 },
        );
        return { blueprint, aiMode: "ai" };
      } catch (err) {
        logger.warn("blueprint via model failed; using heuristic", {
          mode: config.meta.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return heuristic();
      }
    },
  };
}

export interface PicksModeConfig {
  meta: ModeMeta;
  extractGuidance: string;
  strategies: (intent: BaseIntent) => StrategyPlan;
  noun: string;
  persona?: string;
  extraConstraints?: (product: import("@/lib/catalog/types").NormalizedProduct, intent: BaseIntent) => string[];
  clarifyMax?: number;
}

export function makePicksMode(config: PicksModeConfig): ShoppingMode {
  const persona = config.persona ?? SHOPLENS_SYSTEM;
  return {
    meta: config.meta,
    intentSchema: SharedIntentSchema,
    rawSchema: SharedRawSchema,
    persona,
    noun: config.noun,
    extractPrompt: (conversation, form) =>
      extractionPrompt(config.extractGuidance, conversation, form),
    finalizeIntent: (raw, form) => finalizeSharedIntent(raw as SharedRaw, form),
    heuristicIntent: (conversation, form) => heuristicSharedIntent(conversation, form),
    toBaseIntent: (intent) => intent as BaseIntent,
    clarifyMax: config.clarifyMax ?? 2,
    extraConstraints: config.extraConstraints
      ? (product, intent) => config.extraConstraints!(product, intent as BaseIntent)
      : undefined,
    planStrategies: (intent) => config.strategies(intent as BaseIntent),
  };
}

/** Generic literal/adjacent/wildcard strategies from a base intent. */
export function genericStrategies(intent: BaseIntent, fallbackNoun: string): StrategyPlan {
  const theme =
    intent.searchThemes[0] ?? intent.interests[0] ?? intent.occasion ?? fallbackNoun;
  const style = intent.styleKeywords[0] ?? intent.softPreferences[0] ?? "";
  return {
    strategies: [
      {
        strategy: "literal",
        query: [style, theme, fallbackNoun].filter(Boolean).join(" ").trim(),
        rationale: "Directly represents the stated need.",
      },
      {
        strategy: "adjacent",
        query: [theme, intent.interests[1] ?? "accessories"].filter(Boolean).join(" "),
        rationale: "A related option rather than the obvious one.",
      },
      {
        strategy: "wildcard",
        query: ["unique", style || "thoughtful", theme].filter(Boolean).join(" "),
        rationale: "A surprising but defensible angle.",
      },
    ],
  };
}
