import type { CareFlag } from "./types";

/**
 * The deterministic half of the safety layer: care-flag keyword nets (unioned
 * with LLM extraction — recall never drops below these), topic-keyed
 * blocked-claim patterns, and the outbound lint. Boundaries on outputs, not
 * scripts on flow (docs/AI-EXPERIENCE-REDESIGN.md §7).
 */

// ---------------------------------------------------------------------------
// Care flags — sticky, add-only, with per-flag scope fences
// ---------------------------------------------------------------------------

export interface CareFlagDef {
  kind: string;
  label: string;
  pattern: RegExp;
  /** Terms denylisted from cards + searches while the flag is active. */
  scopeFence: string[];
  /** Canonical referral sentence appended if the model drops the care language. */
  canonical: string;
}

export const CARE_FLAG_DEFS: CareFlagDef[] = [
  {
    kind: "pregnancy",
    label: "pregnancy",
    pattern: /\b(pregnan\w*|breastfeed\w*|nursing mother|trying to conceive)\b/i,
    scopeFence: ["retinol", "retinoid", "tretinoin", "retinal", "salicylic", "hydroquinone"],
    canonical:
      "Since pregnancy is in the picture, please run any skincare actives or supplements past your doctor or midwife first — I'm keeping suggestions to the gentle lane.",
  },
  {
    kind: "severe-skin",
    label: "severe or painful skin symptoms",
    pattern: /\b(cystic|painful (acne|bumps|skin)|bleeding|infection|infected|spreading rash|severe (acne|eczema|rosacea))\b/i,
    scopeFence: [],
    canonical:
      "Painful or severe skin symptoms deserve a dermatologist's eyes — that's a professional's call, not a shopping decision. I can help with the gentle, non-medicated side meanwhile.",
  },
  {
    kind: "skin-condition",
    label: "diagnosed skin condition / prescription",
    pattern: /\b(eczema|rosacea|psoriasis|dermatitis|isotretinoin|accutane|tretinoin prescription|prescription (cream|active))\b/i,
    scopeFence: [],
    canonical:
      "With a diagnosed condition or prescription in play, please check changes with the professional treating you — I'll stay educational and gentle here.",
  },
  {
    kind: "medical",
    label: "medical condition / medication",
    pattern: /\b(diabet\w*|thyroid|medication|medications|blood pressure|cholesterol|anemia|anaemia|kidney|liver disease)\b/i,
    scopeFence: [],
    canonical:
      "Because a medical condition or medication is involved, a doctor or pharmacist should sanity-check anything here — especially before combining products with what you take.",
  },
  {
    kind: "labs",
    label: "lab report / blood work",
    pattern: /\b(blood test|blood work|lab report|lab results|ferritin|hemoglobin|haemoglobin|hba1c|lipid panel|vitamin d level|b12 level)\b/i,
    scopeFence: [],
    canonical:
      "A lab report needs your doctor, not a shopping assistant — tell me what they flagged in their words, and I'll work from that.",
  },
  {
    kind: "eating-disorder",
    label: "disordered-eating signals",
    pattern: /\b(anorexi\w*|bulimi\w*|purge|purging|laxative\w*|fat.?burner|starv\w*|barely eat\w*|punish\w* (myself|eating)|compensat\w* (for )?eating)\b/i,
    scopeFence: ["fat burner", "appetite suppressant", "laxative", "detox tea", "weight loss pill"],
    canonical:
      "Some of what you've described is territory where a doctor or registered dietitian genuinely helps more than any product — please talk to one. I'll keep this to gentle, food-first basics.",
  },
  {
    kind: "minor",
    label: "possibly a minor",
    pattern: /\b(i'?m (1[0-7]|a teen\w*)|my (13|14|15|16|17).?year.?old|for my teen\w*)\b/i,
    scopeFence: ["retinol", "retinoid", "fat burner", "pre-workout", "appetite suppressant"],
    canonical:
      "For younger skin and growing bodies, gentle basics win and a parent plus a professional should be in the loop for anything stronger.",
  },
];

/** A match preceded by a negation ("no medications", "not pregnant") is a denial, not a flag. */
const NEGATION_LOOKBACK = /(?:\b(?:no|not|without|never|none|don'?t|doesn'?t|aren'?t|haven'?t|isn'?t)\b|\bnot?\s+(?:taking|on|have|having|had))\s+(?:\w+\s+){0,3}$/i;

function negated(text: string, matchIndex: number): boolean {
  return NEGATION_LOOKBACK.test(text.slice(Math.max(0, matchIndex - 40), matchIndex));
}

/**
 * Deterministic keyword-net detection. Always unioned with any LLM-added flags.
 * Scans EVERY occurrence: a negated first mention ("I don't think it's serious,
 * but I am pregnant") must not suppress a later affirming one.
 */
export function detectCareFlags(text: string, turn: number): CareFlag[] {
  const flags: CareFlag[] = [];
  for (const def of CARE_FLAG_DEFS) {
    const global = new RegExp(def.pattern.source, def.pattern.flags.includes("g") ? def.pattern.flags : def.pattern.flags + "g");
    for (const m of text.matchAll(global)) {
      if (m.index != null && negated(text, m.index)) continue;
      flags.push({
        kind: def.kind,
        label: def.label,
        matchedText: m[0],
        turn,
        scopeFence: def.scopeFence,
        lastCaredTurn: null,
      });
      break; // one flag per kind
    }
  }
  return flags;
}

export function careFlagDef(kind: string): CareFlagDef | undefined {
  return CARE_FLAG_DEFS.find((d) => d.kind === kind);
}

// ---------------------------------------------------------------------------
// Topic-keyed blocked-claim patterns (fire on detected TOPIC, not active lens)
// ---------------------------------------------------------------------------

const SKINCARE_TOPIC = /\b(skin|acne|serum|moisturi[sz]er|cleanser|spf|sunscreen|retinol|eczema|rosacea|dermat\w*|complexion|breakout)\b/i;
const NUTRITION_TOPIC = /\b(supplement|protein|vitamin|diet|nutrition|creatine|calorie|meal|dietary|whey|omega)\b/i;

const MEDICAL_CLAIMS = [
  /\b(cure|cures|cured|treat|treats|treated|heal|heals|diagnos\w*|prescri\w*|clinically proven)\b/i,
  /\beliminat\w*\s+(acne|eczema|rosacea|dermatitis|wrinkles)\b/i,
  /\b(lose|gain)\s+\d+\s?(kg|kgs|kilos|pounds|lbs)\b/i,
];

/** Always-on claim classes, independent of topic. */
const UNIVERSAL_CLAIMS = [
  /\bguarantee\w*\b/i,
  /\b(arrives?|delivered|will arrive|delivery)\s+(by|on|before|within)\b/i,
  /\branked\s+(#?\d+|first|top)\b/i,
  /\b(flatter\w* your (figure|body|shape)|slimming effect|hide\w* your)\b/i,
];

/**
 * Drug/supplement interaction assertions may only be voiced as deferral, never
 * as fact — being wrong in either direction is harmful.
 */
const INTERACTION_ASSERTION = /\b(interacts? with|interferes? with|blocks? the absorption|dangerous (with|when combined))\b/i;
const INTERACTION_DEFERRAL = /\b(pharmacist|doctor|ask|check with|worth asking)\b/i;

export interface LintResult {
  text: string;
  dropped: string[];
}

/**
 * Outbound lint over any user-visible free text. Splits into sentences, drops
 * violating ones (topic-keyed), returns what survived. Never inserts filler —
 * callers decide what an empty result means.
 */
export function lintOutbound(text: string): LintResult {
  // Topic is keyed on the WHOLE text, not per sentence: "My acne is brutal.
  // This will cure it for good." must not escape because the second sentence
  // has no topic keyword of its own (anaphora).
  const medicalContext = SKINCARE_TOPIC.test(text) || NUTRITION_TOPIC.test(text);
  const dropped: string[] = [];
  const isViolation = (s: string): boolean => {
    const bad =
      UNIVERSAL_CLAIMS.some((p) => p.test(s)) ||
      (medicalContext && MEDICAL_CLAIMS.some((p) => p.test(s))) ||
      (INTERACTION_ASSERTION.test(s) && !INTERACTION_DEFERRAL.test(s));
    if (bad) dropped.push(s);
    return bad;
  };
  // Preserve line structure so Markdown (bullets, headings, paragraph breaks in
  // the game-plan opener and presentation messages) survives the lint, while
  // still checking each sentence — and each unpunctuated bullet line — on its
  // own. Lines rejoin with "\n"; sentences within a line rejoin with " ".
  const keptLines = text.split(/\n/).map((line) => {
    if (line.trim() === "") return "";
    return line
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !isViolation(s))
      .join(" ")
      .trim();
  });
  const cleaned = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, dropped };
}

// ---------------------------------------------------------------------------
// Interpretation-stratum lexeme lint — product facts can't smuggle past claims
// ---------------------------------------------------------------------------

/**
 * Interpretation ("why for you") may reference the person freely, but asserting
 * a product attribute belongs in the evidence-quoted claims stratum. We flag
 * assertion *constructions*, not bare nouns, to avoid killing "she loves ceramics".
 */
const INTERPRETATION_FACT_PATTERNS = [
  /\b(made (of|from)|crafted from|contains|infused with|composed of|100%\s+\w+|formulated with)\b/i,
  /\b(it'?s|this is)\s+(pure|genuine|real)\s+(leather|wool|merino|silk|cotton|linen|suede|ceramic|steel|titanium|gold|silver)\b/i,
  // Prices and discounts are product facts — they belong in evidence-quoted claims.
  /(?:₹|\$|€|£|\brs\.?\s?)\s?\d[\d,]*(?:\.\d+)?/i,
  /\b\d+\s?%\s?(off|discount|cheaper)\b/i,
  // Warranty / durability / performance assertions.
  /\b(warrant(?:y|ies)|guaranteed for|lifetime (?:warranty|guarantee))\b/i,
  /\b(waterproof|water.?resistant|shockproof|scratch.?proof|dishwasher.?safe|machine.?washable)\b/i,
  /\b(battery|charge)\s+(?:life\s+)?(?:lasts?|holds?|runs?)\b/i,
  // Ratings and measured specs.
  /\b(rated|rating of)\s+\d(?:\.\d)?\b/i,
  /\b\d(?:\.\d)?\s?\/\s?5\b/,
  /\b\d+\s?(ml|l|g|kg|mg|mcg|cm|mm|inch(?:es)?|oz|lbs?)\b/i,
];

export function interpretationViolations(sentence: string): boolean {
  return INTERPRETATION_FACT_PATTERNS.some((p) => p.test(sentence));
}

// ---------------------------------------------------------------------------
// Certainty lint on inferred facts — inference must not be phrased as fact
// ---------------------------------------------------------------------------

const CERTAINTY_ADVERBS = /\b(definitely|certainly|absolutely|without a doubt|obviously|100%)\s*/gi;

export function hedgeInferredValue(value: string): string {
  return value.replace(CERTAINTY_ADVERBS, "").trim();
}

// ---------------------------------------------------------------------------
// Supplement / opt-in category detection (consent gate)
// ---------------------------------------------------------------------------

const SUPPLEMENT_NETS = [
  /\b(supplement|protein powder|whey|casein|creatine|pre.?workout|bcaa|multivitamins?|fish oil|collagen powder|capsules?|softgels?)\b/i,
  /\b(methylcobalamin|cyanocobalamin|b\s?-?12|b\s?-?complex|biotin|ashwagandha|melatonin|glucosamine|spirulina)\b/i,
  /\b(vitamin|mineral|iron|zinc|magnesium|calcium|omega.?3)\s+\S*\s*(tablets?|capsules?|supplements?|softgels?|gummies)\b/i,
  /\(\s*\d+\s?(mcg|mg|iu)\s*\)/i, // dosed products, e.g. "(1500mcg) Tablets"
];

export function isSupplementCategory(text: string): boolean {
  return SUPPLEMENT_NETS.some((p) => p.test(text));
}

/**
 * Deterministic consent sniff over a USER sentence: an affirmative supplement
 * opt-in in their own words ("yes, show me supplement options"), with negations
 * rejected ("no supplements please"). Returns the consenting sentence or null.
 */
export function sniffSupplementConsent(message: string): string | null {
  const SUPP = "(?:supplements?|protein powders?|creatine|multivitamins?|vitamins?)";
  // The affirmation must GOVERN the supplement term — a directed request, not
  // mere co-occurrence. "Yes, my friend takes supplements" is not consent.
  const DIRECTED = new RegExp(
    `\\b(?:yes[,!.\\s]+|yeah[,!.\\s]+|sure[,!.\\s]+|ok(?:ay)?[,!.\\s]+|go ahead[,!.\\s]+)?` +
      `(?:show me|include|add|suggest|recommend|i'?d like|i would like|i want|i'?m open to|open to|let'?s try|give me)\\s+` +
      `(?:some |a |an |the |any |me )?(?:\\w+\\s+){0,2}${SUPP}`,
    "i",
  );
  const THIRD_PARTY = /\b(my|his|her|their)\s+(friend|wife|husband|partner|mother|father|mom|dad|sister|brother|colleague|doctor)\b/i;
  const NEGATES = /\b(no|not|without|skip|avoid|don'?t|do not|rather not|none|never|instead of)\b/i;
  for (const raw of message.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.trim();
    if (!s) continue;
    if (NEGATES.test(s) || THIRD_PARTY.test(s)) continue;
    if (DIRECTED.test(s)) return s;
  }
  return null;
}

/** Educational framing lines — template-owned chrome the model cannot omit. */
export const EDUCATIONAL_FRAMING: Record<string, string> = {
  skincare:
    "Educational guidance, not medical advice — patch-test new products, and see a dermatologist for persistent, severe, or pregnancy-related concerns.",
  nutrition:
    "Educational guidance, not medical or dietetic advice — no diagnoses, no outcome promises; your doctor gets the final word, especially alongside medication.",
};
