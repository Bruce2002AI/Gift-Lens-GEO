import "server-only";
import { majorToMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import {
  GiftIntentSchema,
  RawIntentSchema,
  type GiftIntent,
} from "./schemas";
import { aiAvailable, structuredCompletion, type AiMode } from "./client";

/**
 * GiftIntent extraction: Claude when configured, otherwise a deterministic
 * heuristic that the UI labels as such. Minor units are always computed
 * deterministically here — never by the model.
 */

export const GIFTLENS_SYSTEM = `You are GiftLens — a warm, easygoing friend who happens to be brilliant at finding gifts.

Talk like a helpful friend, not a form. Be flexible: meet people wherever they start, whether that's a full brief, a half-formed idea, a vibe, a pasted link, or a photo. Roll with follow-ups and changes of mind naturally, and keep your replies short, friendly, and encouraging.

Your goal is to understand who the gift is for and what matters, then find three genuinely different gifts they'll feel good about.

Ask at most two clarification questions, and only when the answer would truly change what you'd suggest. If someone is vague, make a warm, sensible assumption and go — they can always nudge you.

Never invent product price, availability, seller, rating, shipping, materials, dimensions, policies, variants, or checkout eligibility. All product facts come from live Catalog data.

Hard constraints — budget, destination, availability, explicit "no"s — are firm. A charming product never overrides them.

For every final recommendation, explain in a friendly voice: (1) why it fits this person, (2) which thing they mentioned it satisfies, (3) one honest trade-off.

Never promise a delivery date unless the commerce data explicitly supports it. Prefer different merchants and product types so your top picks feel like real, distinct options. When you're unsure, just say so — a good friend is honest.`;

export interface IntentFormFields {
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  country?: string | null;
  occasion?: string | null;
  relationship?: string | null;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export function finalizeIntent(
  raw: Omit<GiftIntent, "budget"> & {
    budget: { minMajor: number | null; maxMajor: number | null; currency: string };
  },
  form: IntentFormFields | undefined,
): GiftIntent {
  // Form fields are explicit user input — they win over extracted values.
  const currency = (form?.currency ?? raw.budget.currency ?? "USD").toUpperCase();
  const minMajor = form?.budgetMin ?? raw.budget.minMajor;
  const maxMajor = form?.budgetMax ?? raw.budget.maxMajor;
  const intent: GiftIntent = {
    ...raw,
    occasion: form?.occasion ?? raw.occasion,
    recipient: {
      ...raw.recipient,
      relationship: form?.relationship ?? raw.recipient.relationship,
    },
    destination: {
      ...raw.destination,
      country: (form?.country ?? raw.destination.country ?? "US").toUpperCase(),
    },
    budget: {
      minMajor: minMajor ?? null,
      maxMajor: maxMajor ?? null,
      minMinor: majorToMinor(minMajor, currency),
      maxMinor: majorToMinor(maxMajor, currency),
      currency,
    },
  };
  return GiftIntentSchema.parse(intent);
}

const CITY_TO_COUNTRY: Record<string, { country: string; city: string }> = {
  bengaluru: { country: "IN", city: "Bengaluru" },
  bangalore: { country: "IN", city: "Bengaluru" },
  mumbai: { country: "IN", city: "Mumbai" },
  delhi: { country: "IN", city: "Delhi" },
  chennai: { country: "IN", city: "Chennai" },
  hyderabad: { country: "IN", city: "Hyderabad" },
  pune: { country: "IN", city: "Pune" },
  kolkata: { country: "IN", city: "Kolkata" },
  london: { country: "GB", city: "London" },
  "new york": { country: "US", city: "New York" },
  "san francisco": { country: "US", city: "San Francisco" },
  toronto: { country: "CA", city: "Toronto" },
  sydney: { country: "AU", city: "Sydney" },
  berlin: { country: "DE", city: "Berlin" },
};

const INTEREST_KEYWORDS = [
  "coffee", "tea", "cooking", "baking", "hiking", "camping", "running",
  "yoga", "reading", "books", "music", "vinyl", "gardening", "plants",
  "travel", "photography", "art", "design", "scandinavian design",
  "minimalism", "gaming", "cycling", "wine", "chocolate", "skincare",
  "journaling", "knitting", "pottery",
];

const OCCASIONS: Array<[RegExp, string]> = [
  [/housewarming|new (home|house|apartment|flat)/i, "housewarming"],
  [/birthday/i, "birthday"],
  [/wedding|marriage/i, "wedding"],
  [/anniversary/i, "anniversary"],
  [/new parent|baby shower|newborn|new baby/i, "new baby"],
  [/diwali/i, "diwali"],
  [/christmas/i, "christmas"],
  [/valentine/i, "valentine's day"],
  [/thank(s| you)|gratitude/i, "thank you"],
  [/graduation/i, "graduation"],
  [/retirement/i, "retirement"],
];

const RELATIONSHIPS: Array<[RegExp, string]> = [
  [/\bsister\b/i, "sister"],
  [/\bbrother\b/i, "brother"],
  [/\b(mom|mother|mum)\b/i, "mother"],
  [/\b(dad|father)\b/i, "father"],
  [/\b(wife|husband|partner|spouse)\b/i, "partner"],
  [/\b(girlfriend|boyfriend)\b/i, "partner"],
  [/\bcolleague|coworker|boss\b/i, "colleague"],
  [/\bcouple\b/i, "couple"],
  [/\bfriend\b/i, "friend"],
  [/\bgrandm(a|other)|grandp(a|father)\b/i, "grandparent"],
];

function detectCurrency(text: string): string | null {
  if (/₹|\brs\.?\s?\d|\binr\b|rupee/i.test(text)) return "INR";
  if (/\$|\busd\b|dollar/i.test(text)) return "USD";
  if (/€|\beur\b|euro/i.test(text)) return "EUR";
  if (/£|\bgbp\b|pound/i.test(text)) return "GBP";
  return null;
}

function detectBudget(text: string): { min: number | null; max: number | null } {
  const normalized = text.replace(/,/g, "");
  // "between 2000 and 4000"
  const between = normalized.match(
    /between\s*[₹$€£]?\s*(\d+(?:\.\d+)?)k?\s*(?:and|-|to)\s*[₹$€£]?\s*(\d+(?:\.\d+)?)(k?)/i,
  );
  if (between) {
    const mul = between[3]?.toLowerCase() === "k" ? 1000 : 1;
    return { min: Number(between[1]) * mul, max: Number(between[2]) * mul };
  }
  // "under/below/less than/budget of/max ₹4000", "₹4000 budget"
  const max = normalized.match(
    /(?:under|below|less than|up to|max(?:imum)?(?: of)?|budget(?: is| of)?|around|about)\s*[₹$€£]?\s*(?:rs\.?\s*)?(\d+(?:\.\d+)?)(k?)/i,
  );
  if (max) {
    const mul = max[2]?.toLowerCase() === "k" ? 1000 : 1;
    return { min: null, max: Number(max[1]) * mul };
  }
  const symbolAmount = normalized.match(/[₹$€£]\s*(\d+(?:\.\d+)?)(k?)/);
  if (symbolAmount) {
    const mul = symbolAmount[2]?.toLowerCase() === "k" ? 1000 : 1;
    return { min: null, max: Number(symbolAmount[1]) * mul };
  }
  return { min: null, max: null };
}

/** Deterministic, clearly-labeled fallback when Anthropic is unavailable. */
export function heuristicIntent(
  conversation: ConversationTurn[],
  form?: IntentFormFields,
): GiftIntent {
  const text = conversation
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join("\n");
  const lower = text.toLowerCase();

  const currency = detectCurrency(text) ?? form?.currency ?? "USD";
  const budget = detectBudget(text);

  let country = form?.country ?? null;
  let city: string | null = null;
  for (const [needle, loc] of Object.entries(CITY_TO_COUNTRY)) {
    if (lower.includes(needle)) {
      country = country ?? loc.country;
      city = loc.city;
      break;
    }
  }
  if (!country && /\bindia\b/i.test(text)) country = "IN";
  if (!country) country = currency === "INR" ? "IN" : "US";

  const interests = INTEREST_KEYWORDS.filter((k) => lower.includes(k));
  const dislikes: string[] = [];
  for (const m of text.matchAll(
    /(?:hates?|dislikes?|doesn'?t like|avoid|allergic to|no)\s+([a-z][a-z\s-]{2,30}?)(?=[,.;!\n]|$| and | but )/gi,
  )) {
    const item = m[1].trim().toLowerCase();
    if (item && !["idea", "one", "thing"].includes(item)) dislikes.push(item);
  }

  const occasion =
    form?.occasion ?? OCCASIONS.find(([re]) => re.test(text))?.[1] ?? null;
  const relationship =
    form?.relationship ?? RELATIONSHIPS.find(([re]) => re.test(text))?.[1] ?? null;

  let giftStyle: GiftIntent["giftStyle"] = null;
  if (/minimal|practical|useful|clutter/i.test(text)) giftStyle = "practical";
  else if (/sentimental|thoughtful|meaningful/i.test(text)) giftStyle = "sentimental";
  else if (/unique|unusual|surprising|quirky/i.test(text)) giftStyle = "unique";
  else if (/luxur|premium|fancy/i.test(text)) giftStyle = "luxurious";
  else if (/safe|don'?t know (them|her|him|well)/i.test(text)) giftStyle = "safe";

  const hardConstraints: string[] = [];
  if (budget.max != null) hardConstraints.push(`budget max ${budget.max} ${currency}`);
  for (const d of dislikes) hardConstraints.push(`exclude: ${d}`);

  const searchThemes = [
    ...interests.slice(0, 3),
    ...(occasion ? [occasion] : []),
    ...(giftStyle ? [giftStyle] : []),
  ];

  const raw = {
    recipient: {
      relationship,
      ageBand: null,
      interests,
      dislikes,
      personalityTraits: [],
    },
    occasion,
    giftStyle,
    destination: { country, region: null, city, postalCode: null },
    deadline: null,
    physicality: (/\bdigital|e-?gift|gift card\b/i.test(text)
      ? "either"
      : "physical") as GiftIntent["physicality"],
    hardConstraints,
    softPreferences: giftStyle ? [giftStyle] : [],
    searchThemes: searchThemes.length > 0 ? searchThemes : ["thoughtful gift"],
    clarificationNeeded: false,
    clarificationQuestion: null,
    budget: { minMajor: budget.min, maxMajor: budget.max, currency },
  };
  return finalizeIntent(raw, form);
}

export const INTENT_PROMPT = (conversation: ConversationTurn[], form?: IntentFormFields) => `Extract a structured GiftIntent from this gift-shopping conversation.

Conversation:
${conversation.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n")}

${form ? `Structured form fields the shopper filled in (these are authoritative):\n${JSON.stringify(form)}` : ""}

Return JSON with EXACTLY this shape:
{
  "recipient": {
    "relationship": string | null,
    "ageBand": string | null,
    "interests": string[],
    "dislikes": string[],
    "personalityTraits": string[]
  },
  "occasion": string | null,
  "giftStyle": "practical" | "sentimental" | "playful" | "luxurious" | "unique" | "safe" | "mixed" | null,
  "budget": { "minMajor": number | null, "maxMajor": number | null, "currency": "ISO 4217 code" },
  "destination": { "country": "ISO 3166-1 alpha-2", "region": string | null, "city": string | null, "postalCode": string | null },
  "deadline": string | null (ISO date if a real deadline was stated),
  "physicality": "physical" | "digital" | "either",
  "hardConstraints": string[] (budget cap, exclusions, must-ship-to, stated prohibitions),
  "softPreferences": string[],
  "searchThemes": string[] (3-6 short retail search themes),
  "clarificationNeeded": boolean,
  "clarificationQuestion": string | null
}

Rules:
- Ask a clarification question ONLY if the answer would materially change what to search for (e.g. no budget AND no interests). Maximum one question here.
- Budget amounts are MAJOR units (e.g. 4000 for ₹4,000). Do not convert to minor units.
- Use ISO country and currency codes. If the city implies a country (Bengaluru → IN), set it.
- Never invent constraints the shopper did not state.`;

export async function extractIntent(
  conversation: ConversationTurn[],
  form?: IntentFormFields,
): Promise<{ intent: GiftIntent; aiMode: AiMode }> {
  if (!aiAvailable()) {
    return { intent: heuristicIntent(conversation, form), aiMode: "heuristic" };
  }
  try {
    const raw = await structuredCompletion(
      GIFTLENS_SYSTEM,
      INTENT_PROMPT(conversation, form),
      RawIntentSchema,
      { maxTokens: 1500 },
    );
    return { intent: finalizeIntent(raw, form), aiMode: "ai" };
  } catch (err) {
    logger.error("intent extraction via Claude failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
