import type { FactSensitivity, ProfileLens } from "./types";

/**
 * The progressive-profiling question bank.
 *
 * Design note — why a bank instead of an onboarding form:
 * a shopper who is asked twelve questions before seeing a single product
 * leaves. So nothing here is ever rendered as a form. `nextQuestions` hands the
 * UI at most a handful of UNANSWERED questions at a time, and each one is asked
 * in the flow of a conversation, at the moment its answer would change the
 * recommendation. Profile depth accrues over sessions rather than being
 * extracted up front.
 *
 * Design note — why `why` is required:
 * every question is surfaced with a "Why we ask this" disclosure. Making the
 * field non-optional means a question physically cannot ship without a
 * plain-English justification the shopper can read before answering.
 *
 * Design note — categories and keys are NOT free text:
 * they line up with the keys the agent's ledger bridge reads and writes
 * (`budget.max_minor`, `budget.currency`, `recipient.*`, …), so an answer typed
 * here and a fact learned mid-conversation converge on the same row instead of
 * creating a duplicate the shopper then has to reconcile.
 */

export interface ProfileQuestion {
  /** Stable, globally unique id — safe to use as a React key or a seen-marker. */
  id: string;
  /** Which profile scope the answer is stored under. */
  lens: ProfileLens;
  /** Fact category, e.g. "budget", "recipient", "allergies". */
  category: string;
  /** Fact key within the category, e.g. "max_minor", "interests". */
  key: string;
  /** The question as the shopper reads it. */
  prompt: string;
  /** Plain-English reason, shown under "Why we ask this". Never optional. */
  why: string;
  kind: "chips" | "slider" | "choice";
  /** Required for "chips" and "choice". */
  options?: string[];
  /** Slider bounds. Monetary sliders are expressed in MINOR units (see below). */
  min?: number;
  max?: number;
  step?: number;
  /** Unit suffix shown beside a slider readout, e.g. "min", "people". */
  unit?: string;
  /** Defaults to "standard" when omitted. Health facts never cross lenses. */
  sensitivity?: FactSensitivity;
  /** Chips only: allow more than one answer (stored as string[]). */
  multi?: boolean;
}

/**
 * Money convention: any key ending in `_minor` is stored in MINOR currency
 * units (pence/paise/cents) because that is what `constraintsFromFacts` in
 * ledger-bridge.ts reads for `budgetMaxMinor`. Sliders therefore step in minor
 * units and the UI divides by 100 for the readout — the stored value stays
 * directly usable by the agent with no conversion at the boundary.
 */
export const MINOR_UNIT_SUFFIX = "_minor";

// ---------------------------------------------------------------------------
// Shared profile — asked LAST so lens-specific value always lands first
// ---------------------------------------------------------------------------

const SHARED_QUESTIONS: ProfileQuestion[] = [
  {
    id: "shared.budget.currency",
    lens: "shared",
    category: "budget",
    key: "currency",
    prompt: "Which currency do you shop in?",
    why: "Prices come back from several retailers. Knowing your currency means we compare like for like instead of showing you a number you have to convert in your head.",
    kind: "chips",
    options: ["INR", "GBP", "USD", "EUR", "AUD", "CAD", "SGD", "AED"],
  },
  {
    id: "shared.budget.max_minor",
    lens: "shared",
    category: "budget",
    key: "max_minor",
    prompt: "Roughly what's your usual ceiling for a purchase?",
    why: "This is the single biggest filter we apply. With it we can stop showing you things you'd never buy — and stop wasting your time scrolling past them. You can override it any time for a specific search.",
    kind: "slider",
    min: 500,
    max: 100000,
    step: 500,
  },
  {
    id: "shared.profile.decision_style",
    lens: "shared",
    category: "profile",
    key: "decision_style",
    prompt: "How do you like decisions presented?",
    why: "Some people want one confident answer, others want the trade-offs laid out. This changes how much we show you, not what we search.",
    kind: "chips",
    options: ["Show me the best one", "Give me options", "I like comparing"],
  },
];

// ---------------------------------------------------------------------------
// Gift
// ---------------------------------------------------------------------------

const GIFT_QUESTIONS: ProfileQuestion[] = [
  {
    id: "gift.recipient.relationship",
    lens: "gift",
    category: "recipient",
    key: "relationship",
    prompt: "Who is this for?",
    why: "Relationship sets the tone more than anything else. What reads as thoughtful for a partner reads as far too much for a colleague.",
    kind: "chips",
    options: [
      "Partner",
      "Parent",
      "Sibling",
      "Child",
      "Close friend",
      "Colleague",
      "In-law",
      "Teacher",
    ],
  },
  {
    id: "gift.occasion.type",
    lens: "gift",
    category: "occasion",
    key: "type",
    prompt: "What's the occasion?",
    why: "Occasion drives both the expected spend and the kind of gift that fits — a housewarming and an anniversary pull in completely different directions.",
    kind: "chips",
    options: [
      "Birthday",
      "Anniversary",
      "Wedding",
      "Housewarming",
      "Festival",
      "Graduation",
      "Thank you",
      "Just because",
    ],
  },
  {
    id: "gift.recipient.interests",
    lens: "gift",
    category: "recipient",
    key: "interests",
    prompt: "What are they into?",
    why: "Interests are what turn a generic present into one that looks like you were paying attention. Pick as many as apply.",
    kind: "chips",
    multi: true,
    options: [
      "Cooking",
      "Reading",
      "Fitness",
      "Travel",
      "Music",
      "Gaming",
      "Gardening",
      "Art & craft",
      "Tech",
      "Fashion",
      "Coffee & tea",
      "Home & decor",
    ],
  },
  {
    id: "gift.budget.max_minor",
    lens: "gift",
    category: "budget",
    key: "max_minor",
    prompt: "What's your ceiling for this gift?",
    why: "Gift budgets are usually different from what you'd spend on yourself, so we keep this one separate from your general ceiling.",
    kind: "slider",
    min: 500,
    max: 50000,
    step: 500,
  },
  {
    id: "gift.preference.gift_style",
    lens: "gift",
    category: "preference",
    key: "gift_style",
    prompt: "Which lands better with you — sentimental or practical?",
    why: "Two people with the same budget and the same recipient still want opposite things here. It's the difference between a personalised keepsake and something they'll use on Monday.",
    kind: "chips",
    options: ["Sentimental", "Practical", "A bit of both", "Playful"],
  },
  {
    id: "gift.preference.surprise_tolerance",
    lens: "gift",
    category: "preference",
    key: "surprise_tolerance",
    prompt: "How adventurous should our suggestions be?",
    why: "Low means we stick to safe, well-reviewed choices. High means we'll put forward the unusual option that might delight — or might miss.",
    kind: "slider",
    min: 0,
    max: 10,
    step: 1,
  },
];

// ---------------------------------------------------------------------------
// Skincare & supplements
// ---------------------------------------------------------------------------

const SKINCARE_QUESTIONS: ProfileQuestion[] = [
  {
    id: "skincare.goal.primary",
    lens: "skincare",
    category: "goal",
    key: "primary",
    prompt: "What are you mainly trying to improve?",
    why: "Almost every product claims to do everything. Knowing your actual goal lets us rank on the ingredient that addresses it and ignore the marketing around it.",
    kind: "chips",
    multi: true,
    sensitivity: "health",
    options: [
      "Hydration",
      "Breakouts",
      "Dark spots",
      "Fine lines",
      "Redness",
      "Texture",
      "Dullness",
      "Sun protection",
    ],
  },
  {
    id: "skincare.skin.feel",
    lens: "skincare",
    category: "skin",
    key: "feel",
    prompt: "How does your skin usually feel by mid-afternoon?",
    why: "This tells us more than a skin-type label does, and you don't need to have been told your type by anyone to answer it.",
    kind: "chips",
    sensitivity: "health",
    options: ["Tight and dry", "Shiny all over", "Oily T-zone only", "Comfortable", "Not sure"],
  },
  {
    id: "skincare.allergies.ingredients",
    lens: "skincare",
    category: "allergies",
    key: "ingredients",
    prompt: "Anything your skin reacts badly to?",
    why: "We use this only to rule products OUT. It is kept private to this lens and is never used to target you or shared with another part of your profile.",
    kind: "chips",
    multi: true,
    sensitivity: "health",
    options: [
      "Fragrance",
      "Alcohol",
      "Essential oils",
      "Retinoids",
      "Salicylic acid",
      "Benzoyl peroxide",
      "Nuts",
      "Lanolin",
      "Sulfates",
    ],
  },
  {
    id: "skincare.preference.format",
    lens: "skincare",
    category: "preference",
    key: "format",
    prompt: "Which formats do you actually enjoy using?",
    why: "The best formula in the world doesn't work if it sits unopened. If you hate the feel of an oil, we won't recommend one.",
    kind: "chips",
    multi: true,
    options: ["Serum", "Cream", "Lightweight gel", "Oil", "Capsule or tablet", "Powder", "Patch"],
  },
  {
    id: "skincare.preference.routine_length",
    lens: "skincare",
    category: "preference",
    key: "routine_length",
    prompt: "How long a routine will you realistically keep up?",
    why: "We'd rather suggest three products you'll use every day than eight you'll abandon in a fortnight.",
    kind: "choice",
    options: ["1–2 steps", "3–4 steps", "5+ steps"],
  },
];

// ---------------------------------------------------------------------------
// Fashion / style
// ---------------------------------------------------------------------------

const STYLE_QUESTIONS: ProfileQuestion[] = [
  {
    id: "style.fit.preference",
    lens: "style",
    category: "fit",
    key: "preference",
    prompt: "How do you like things to fit?",
    why: "Fit is the most common reason a garment gets returned. Getting it right up front saves you the trip to the post office.",
    kind: "chips",
    options: ["Fitted", "True to size", "Relaxed", "Oversized", "Tailored"],
  },
  {
    id: "style.palette.colours",
    lens: "style",
    category: "palette",
    key: "colours",
    prompt: "Which colours do you actually wear?",
    why: "Most wardrobes run on a handful of colours. We use yours so suggestions go with what you already own instead of stranding a piece in your cupboard.",
    kind: "chips",
    multi: true,
    options: [
      "Black",
      "White & cream",
      "Navy",
      "Grey",
      "Beige & tan",
      "Brown",
      "Olive",
      "Deep jewel tones",
      "Pastels",
      "Bright colours",
      "Prints",
    ],
  },
  {
    id: "style.occasion.types",
    lens: "style",
    category: "occasion",
    key: "types",
    prompt: "What are you dressing for, most weeks?",
    why: "A wardrobe that's 80% office and 20% weekend needs different suggestions from the reverse. This keeps us shopping for your real life.",
    kind: "chips",
    multi: true,
    options: ["Work", "Everyday", "Evening", "Formal events", "Travel", "Active", "Loungewear"],
  },
  {
    id: "style.fabrics.avoid",
    lens: "style",
    category: "fabrics",
    key: "avoid",
    prompt: "Any fabrics you'd rather avoid?",
    why: "Whether it's itch, care instructions, or ethics, we'd rather filter these out silently than keep showing you things you'll never buy.",
    kind: "chips",
    multi: true,
    options: ["Wool", "Polyester", "Linen", "Silk", "Leather", "Viscose", "Nylon", "Acrylic"],
  },
  {
    id: "style.preference.coverage",
    lens: "style",
    category: "preference",
    key: "coverage",
    prompt: "Any preference on coverage?",
    why: "Plenty of people have a firm line here for personal, cultural or religious reasons. Asking once means we never put you in the position of scrolling past things that don't work for you.",
    kind: "choice",
    sensitivity: "personal",
    options: ["No preference", "Prefer more coverage", "Sleeves and longer hems only"],
  },
];

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

const NUTRITION_QUESTIONS: ProfileQuestion[] = [
  {
    id: "nutrition.diet.pattern",
    lens: "nutrition",
    category: "diet",
    key: "pattern",
    prompt: "How do you eat?",
    why: "This is a hard filter, not a preference — there's no point suggesting a recipe you'd never make. Kept private to this lens.",
    kind: "chips",
    sensitivity: "health",
    options: [
      "Omnivore",
      "Vegetarian",
      "Vegan",
      "Pescatarian",
      "Eggetarian",
      "Halal",
      "Kosher",
      "Low carb",
    ],
  },
  {
    id: "nutrition.allergies.foods",
    lens: "nutrition",
    category: "allergies",
    key: "foods",
    prompt: "Any allergies or intolerances?",
    why: "Safety first: anything you list here is excluded outright, never merely down-ranked. It stays private to this lens and never informs any other part of your profile.",
    kind: "chips",
    multi: true,
    sensitivity: "health",
    options: [
      "Peanuts",
      "Tree nuts",
      "Dairy",
      "Eggs",
      "Gluten",
      "Soy",
      "Shellfish",
      "Fish",
      "Sesame",
      "Mustard",
    ],
  },
  {
    id: "nutrition.goal.primary",
    lens: "nutrition",
    category: "goal",
    key: "primary",
    prompt: "What are you working towards?",
    why: "The same ingredient list gets ranked very differently depending on whether you're after more energy, more protein, or simply less cooking.",
    kind: "chips",
    sensitivity: "health",
    options: [
      "More energy",
      "More protein",
      "Eat more veg",
      "Better digestion",
      "Balanced eating",
      "Less sugar",
      "Just easier meals",
    ],
  },
  {
    id: "nutrition.cooking.minutes_per_meal",
    lens: "nutrition",
    category: "cooking",
    key: "minutes_per_meal",
    prompt: "How long do you want to spend cooking on a weeknight?",
    why: "Time is the reason most meal plans get abandoned. We'd rather work inside your real window than hand you an aspirational one.",
    kind: "slider",
    min: 10,
    max: 90,
    step: 5,
    unit: "min",
  },
  {
    id: "nutrition.cooking.skill",
    lens: "nutrition",
    category: "cooking",
    key: "skill",
    prompt: "How confident are you in the kitchen?",
    why: "This changes the techniques we assume, not the ambition. A confident cook gets fewer hand-holding steps, not better food.",
    kind: "choice",
    options: ["Beginner", "Comfortable", "Confident"],
  },
  {
    id: "nutrition.household.size",
    lens: "nutrition",
    category: "household",
    key: "size",
    prompt: "How many people are you usually cooking for?",
    why: "Portions and pack sizes both scale off this, so it stops us suggesting a family bag of something for a household of one.",
    kind: "slider",
    min: 1,
    max: 8,
    step: 1,
    unit: "people",
    sensitivity: "personal",
  },
];

/**
 * The full bank. Lens-specific questions come first in declaration order and
 * shared questions last — `nextQuestions` relies on that ordering.
 */
export const QUESTION_BANK: ProfileQuestion[] = [
  ...GIFT_QUESTIONS,
  ...SKINCARE_QUESTIONS,
  ...STYLE_QUESTIONS,
  ...NUTRITION_QUESTIONS,
  ...SHARED_QUESTIONS,
];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * The identities a question can be matched against in `answeredKeys`.
 *
 * Callers hold answers in different shapes — a set of fact identities built
 * from stored facts (`category.key`), a set of question ids, or bare keys from
 * an ad-hoc form. Accepting all three means no caller has to reshape its data
 * just to ask what's still unanswered, and a false positive here is harmless:
 * the worst case is that we skip a question we could have asked.
 */
export function questionIdentities(q: ProfileQuestion): string[] {
  return [q.id, `${q.lens}.${q.category}.${q.key}`, `${q.category}.${q.key}`, q.key];
}

export function isAnswered(q: ProfileQuestion, answeredKeys: Set<string>): boolean {
  return questionIdentities(q).some((identity) => answeredKeys.has(identity));
}

/**
 * The next few things worth asking in this lens.
 *
 * Returns at most `limit` UNANSWERED questions, lens-specific ones first and
 * shared-profile ones last. That ordering is the whole point: a shopper who
 * answers two questions and then leaves should have spent both of them on the
 * lens they came for, not on a currency picker.
 *
 * Asking for the shared lens returns shared questions only.
 */
export function nextQuestions(
  lens: ProfileLens,
  answeredKeys: Set<string>,
  limit = 3,
): ProfileQuestion[] {
  if (limit <= 0) return [];

  const unanswered = QUESTION_BANK.filter(
    (q) => !isAnswered(q, answeredKeys) && (q.lens === lens || q.lens === "shared"),
  );

  // Stable partition: lens-specific value before generic profile plumbing.
  const lensSpecific = unanswered.filter((q) => q.lens === lens);
  const shared = lens === "shared" ? [] : unanswered.filter((q) => q.lens === "shared");

  return [...lensSpecific, ...shared].slice(0, limit);
}
