import type { FactSensitivity, ProfileLens } from "./types";

/**
 * The declarative profile schema — ONE definition that drives three things:
 *
 *  1. the always-visible Living Profile form the shopper can edit at any time,
 *  2. the compact field catalog handed to the model, so `update_ledger` writes
 *     land on real form fields instead of free-form slugs, and
 *  3. completion, grouping, "why we ask", privacy defaults and validation.
 *
 * Keeping it declarative is what makes the form fill itself: the agent and the
 * UI are reading the same list, so anything the agent learns has a field to
 * appear in, and anything the shopper types is a fact the agent can read back.
 */

export type FieldControl =
  | "chips" // single-select from options
  | "multichips" // multi-select from options
  | "slider" // numeric range
  | "choice" // segmented, 2-4 short options
  | "text" // short free text
  | "tags" // free-form multi-value
  | "toggle" // yes/no
  | "date"; // ISO date

export interface ProfileField {
  /** Stable unique id, also the React key. */
  id: string;
  lens: ProfileLens;
  category: string;
  key: string;
  label: string;
  /** Plain-English answer to "Why we ask this". Never optional. */
  why: string;
  control: FieldControl;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Defaults to "standard". Health fields are lens-locked and hidden by default. */
  sensitivity?: FactSensitivity;
  /** UI section heading. */
  group: string;
  /**
   * Extra ledger keys that should resolve to this field. The model writes
   * natural slugs ("recipient.loves"), which must land on the right control.
   */
  aliases?: readonly string[];
  /** Money fields are stored in MINOR units so the agent can use them directly. */
  minorUnits?: boolean;
}

// ---------------------------------------------------------------------------
// Shared profile
// ---------------------------------------------------------------------------

const SHARED: ProfileField[] = [
  {
    id: "shared.profile.country",
    lens: "shared",
    category: "profile",
    key: "country",
    label: "Ships to",
    why: "We only show products that can actually reach you, and prices in your market.",
    control: "text",
    placeholder: "IN, GB, US…",
    group: "Locale",
    aliases: ["profile.location", "profile.market", "shipping.country"],
  },
  {
    id: "shared.profile.language",
    lens: "shared",
    category: "profile",
    key: "language",
    label: "Language",
    why: "The language we write recommendations in.",
    control: "text",
    placeholder: "English",
    group: "Locale",
    aliases: ["profile.locale"],
  },
  {
    id: "shared.profile.timezone",
    lens: "shared",
    category: "profile",
    key: "timezone",
    label: "Time zone",
    why: "Used for delivery deadlines and reminders, so 'by Friday' means your Friday.",
    control: "text",
    placeholder: "Asia/Kolkata",
    group: "Locale",
    aliases: ["profile.tz"],
  },
  {
    id: "shared.budget.currency",
    lens: "shared",
    category: "budget",
    key: "currency",
    label: "Currency",
    why: "Every price and budget is shown and filtered in this currency.",
    control: "chips",
    options: ["INR", "USD", "GBP", "EUR", "AUD", "CAD"],
    group: "Budget",
  },
  {
    id: "shared.budget.max_minor",
    lens: "shared",
    category: "budget",
    key: "max_minor",
    label: "Typical budget ceiling",
    why: "A hard filter — nothing above this is ever suggested unless you ask.",
    control: "slider",
    min: 50000,
    // Up to ₹5,00,000 so lakh-scale budgets ("2 lakh") aren't clamped.
    max: 50000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
    aliases: ["budget.max", "budget.ceiling", "budget.limit"],
  },
  {
    id: "shared.budget.min_minor",
    lens: "shared",
    category: "budget",
    key: "min_minor",
    label: "Budget floor",
    why: "Stops us suggesting things that feel too cheap for the occasion.",
    control: "slider",
    min: 0,
    max: 5000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
    aliases: ["budget.min"],
  },
  {
    id: "shared.preferences.brands",
    lens: "shared",
    category: "preferences",
    key: "brands",
    label: "Brands you like",
    why: "We lean toward these when something comparable exists.",
    control: "tags",
    placeholder: "Add a brand",
    group: "Taste",
    aliases: ["preferences.preferred_brands", "brands.liked", "preferences.favourite_brands"],
  },
  {
    id: "shared.preferences.avoid_brands",
    lens: "shared",
    category: "preferences",
    key: "avoid_brands",
    label: "Brands to avoid",
    why: "A hard exclusion — these never appear.",
    control: "tags",
    placeholder: "Add a brand",
    group: "Taste",
    aliases: ["brands.disliked", "preferences.banned_brands"],
  },
  {
    id: "shared.preferences.decision_style",
    lens: "shared",
    category: "preferences",
    key: "decision_style",
    label: "How you like to decide",
    why: "Changes how many options we show and how much we compare for you.",
    control: "choice",
    options: ["Just tell me the best one", "Give me a few options", "I like comparing everything"],
    group: "Taste",
    aliases: ["preferences.decision", "profile.decision_style"],
  },
  {
    id: "shared.delivery.speed",
    lens: "shared",
    category: "delivery",
    key: "speed",
    label: "Delivery preference",
    why: "We weigh shipping time against price the way you'd want.",
    control: "choice",
    options: ["Fastest", "Balanced", "Cheapest"],
    group: "Delivery",
    aliases: ["delivery.preference", "shipping.speed"],
  },
  {
    id: "shared.household.size",
    lens: "shared",
    category: "household",
    key: "size",
    label: "People in your household",
    why: "Sizes quantities and portions — and matters for gifts and groceries alike.",
    control: "slider",
    min: 1,
    max: 12,
    step: 1,
    unit: "people",
    sensitivity: "personal",
    group: "Household",
    aliases: ["household.people", "household.count"],
  },
  {
    id: "shared.dates.important",
    lens: "shared",
    category: "dates",
    key: "important",
    label: "Dates that matter",
    why: "Birthdays and anniversaries, so we can warn you about delivery deadlines.",
    control: "tags",
    placeholder: "Mum's birthday — 12 Mar",
    sensitivity: "personal",
    group: "Household",
    aliases: ["important_dates.list", "dates.birthdays", "dates.anniversaries"],
  },
  {
    id: "shared.notifications.channel",
    lens: "shared",
    category: "notifications",
    key: "channel",
    label: "How to reach you",
    why: "Only used for things you ask us to follow up on.",
    control: "choice",
    options: ["Email", "None"],
    group: "Notifications",
    aliases: ["notifications.preference"],
  },
];

// ---------------------------------------------------------------------------
// Gift lens
// ---------------------------------------------------------------------------

const GIFT: ProfileField[] = [
  {
    id: "gift.recipient.name",
    lens: "gift",
    category: "recipient",
    key: "name",
    label: "Who this is for",
    why: "Naming them lets us keep a profile per person, so shopping for your sister never gets mixed up with shopping for your manager.",
    control: "text",
    placeholder: "Priya",
    sensitivity: "personal",
    group: "Who",
    aliases: ["recipient.who", "recipient.person", "recipient.for"],
  },
  {
    id: "gift.recipient.relationship",
    lens: "gift",
    category: "recipient",
    key: "relationship",
    label: "Who you shop for most",
    why: "Relationship sets the tone — a gift for a partner reads differently to one for a colleague.",
    control: "chips",
    options: ["Partner", "Parent", "Sibling", "Child", "Friend", "Colleague", "Client"],
    group: "Who",
    aliases: ["recipient.relation", "recipient.who"],
  },
  {
    id: "gift.recipient.interests",
    lens: "gift",
    category: "recipient",
    key: "interests",
    label: "Their interests",
    why: "The single strongest signal for a gift that lands.",
    control: "tags",
    placeholder: "cycling, filter coffee…",
    group: "Who",
    aliases: ["recipient.loves", "recipient.likes", "recipient.hobbies", "recipient.passions"],
  },
  {
    id: "gift.recipient.dislikes",
    lens: "gift",
    category: "recipient",
    key: "dislikes",
    label: "Things they dislike",
    why: "A hard exclusion — we never suggest these.",
    control: "tags",
    placeholder: "scented candles…",
    group: "Who",
    aliases: ["recipient.hates", "recipient.avoid"],
  },
  {
    id: "gift.recipient.sizes",
    lens: "gift",
    category: "recipient",
    key: "sizes",
    label: "Their sizes",
    why: "Only shown when a gift is wearable, so you don't have to guess.",
    control: "tags",
    placeholder: "M, UK 9…",
    sensitivity: "personal",
    group: "Who",
    aliases: ["recipient.size", "recipient.clothing_size"],
  },
  {
    id: "gift.recipient.colors",
    lens: "gift",
    category: "recipient",
    key: "colors",
    label: "Colours they wear",
    why: "Keeps anything visual in a palette they'd actually pick.",
    control: "tags",
    placeholder: "navy, olive…",
    group: "Who",
    aliases: ["recipient.colours", "recipient.favourite_colors"],
  },
  {
    id: "gift.recipient.brands",
    lens: "gift",
    category: "recipient",
    key: "brands",
    label: "Brands they love",
    why: "We lean toward these when something comparable exists.",
    control: "tags",
    placeholder: "Add a brand",
    group: "Who",
    aliases: ["recipient.favourite_brands"],
  },
  {
    id: "gift.occasion.type",
    lens: "gift",
    category: "occasion",
    key: "type",
    label: "Occasion",
    why: "Sets both the tone and how much people usually spend.",
    control: "chips",
    options: ["Birthday", "Anniversary", "Wedding", "Housewarming", "Thank you", "Festival", "Just because"],
    group: "Occasion",
    aliases: ["occasion.name", "occasion.event"],
  },
  {
    id: "gift.occasion.deadline",
    lens: "gift",
    category: "occasion",
    key: "deadline",
    label: "Needs to arrive by",
    why: "We reason about shipping time — but never promise a delivery date.",
    control: "date",
    group: "Occasion",
    aliases: ["occasion.date", "delivery.deadline"],
  },
  {
    id: "gift.style.sentimental",
    lens: "gift",
    category: "style",
    key: "sentimental",
    label: "Sentimental vs practical",
    why: "Decides whether we lead with something meaningful or something they'll use daily.",
    control: "slider",
    min: 0,
    max: 10,
    step: 1,
    group: "Gift style",
    aliases: ["style.sentiment", "gift.style"],
  },
  {
    id: "gift.style.surprise",
    lens: "gift",
    category: "style",
    key: "surprise",
    label: "Surprise tolerance",
    why: "High means we can suggest something unexpected; low keeps us to safe bets.",
    control: "slider",
    min: 0,
    max: 10,
    step: 1,
    group: "Gift style",
    aliases: ["style.risk", "gift.surprise_tolerance"],
  },
  {
    id: "gift.budget.max_minor",
    lens: "gift",
    category: "budget",
    key: "max_minor",
    label: "Gift budget",
    why: "A hard ceiling for gifts specifically, separate from your general budget.",
    control: "slider",
    min: 50000,
    // Up to ₹5,00,000 so lakh-scale gift budgets aren't clamped.
    max: 50000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
  },
  {
    id: "gift.history.past",
    lens: "gift",
    category: "history",
    key: "past",
    label: "Gifts you've already given",
    why: "So we never suggest a repeat.",
    control: "tags",
    placeholder: "pour-over kit, 2025",
    group: "History",
    aliases: ["history.past_gifts", "gifts.given"],
  },
  {
    id: "gift.history.feedback",
    lens: "gift",
    category: "history",
    key: "feedback",
    label: "What landed well",
    why: "Their reaction teaches us more than any preference list.",
    control: "tags",
    placeholder: "loved the grinder",
    group: "History",
    aliases: ["history.recipient_feedback", "gifts.feedback"],
  },
];

// ---------------------------------------------------------------------------
// Skincare & Supplements lens (health-sensitive by default)
// ---------------------------------------------------------------------------

const SKINCARE: ProfileField[] = [
  {
    id: "skincare.goals.primary",
    lens: "skincare",
    category: "goals",
    key: "primary",
    label: "What you want to work on",
    why: "Focuses the routine. Educational guidance only — not medical advice.",
    control: "multichips",
    options: ["Brightening", "Hydration", "Texture", "Barrier repair", "Oil control", "Fine lines", "Energy", "Sleep", "Immunity", "Digestion"],
    sensitivity: "health",
    group: "Goals",
    aliases: ["goals.list", "skin.goal", "goal.primary"],
  },
  {
    id: "skincare.skin.type",
    lens: "skincare",
    category: "skin",
    key: "type",
    label: "How your skin behaves",
    why: "Decides textures and actives that suit you.",
    control: "chips",
    options: ["Dry", "Oily", "Combination", "Normal", "Sensitive"],
    sensitivity: "health",
    group: "Your skin",
    aliases: ["skin.feel", "skin.condition"],
  },
  {
    id: "skincare.allergies.list",
    lens: "skincare",
    category: "allergies",
    key: "list",
    label: "Ingredients you react to",
    why: "A hard exclusion. Kept private to this lens and never shared across lenses.",
    control: "tags",
    placeholder: "fragrance, essential oils…",
    sensitivity: "health",
    group: "Safety",
    aliases: ["allergies.ingredients", "sensitivities.list", "allergy.list"],
  },
  {
    id: "skincare.medicines.current",
    lens: "skincare",
    category: "medicines",
    key: "current",
    label: "Medicines you're taking",
    why: "Optional. Only so we can flag well-known interactions and suggest asking a professional. We never advise on medication.",
    control: "tags",
    placeholder: "optional",
    sensitivity: "health",
    group: "Safety",
    aliases: ["medications.current", "medicine.list"],
  },
  {
    id: "skincare.constraints.notes",
    lens: "skincare",
    category: "constraints",
    key: "notes",
    label: "Anything we should be careful about",
    why: "Voluntary context — e.g. pregnancy, a condition you manage. Kept lens-only.",
    control: "text",
    placeholder: "optional",
    sensitivity: "health",
    group: "Safety",
    aliases: ["health.constraints", "constraints.health"],
  },
  {
    id: "skincare.form.preference",
    lens: "skincare",
    category: "form",
    key: "preference",
    label: "Preferred format",
    why: "Some people won't take capsules; some hate thick creams.",
    control: "multichips",
    options: ["Serum", "Cream", "Gel", "Capsule", "Powder", "Gummy", "Liquid"],
    group: "Preferences",
    aliases: ["form.factor", "product.form"],
  },
  {
    id: "skincare.routine.length",
    lens: "skincare",
    category: "routine",
    key: "length",
    label: "Routine length you'll actually keep",
    why: "The best routine is the one you'll finish. We won't over-prescribe.",
    control: "choice",
    options: ["Minimal (2-3 steps)", "Moderate (4-5)", "Full ritual"],
    group: "Preferences",
    aliases: ["routine.steps", "routine.size"],
  },
  {
    id: "skincare.timing.preference",
    lens: "skincare",
    category: "timing",
    key: "preference",
    label: "When you'd take things",
    why: "Timing changes what we suggest — some actives are evening-only.",
    control: "multichips",
    options: ["Morning", "With meals", "Evening", "Before bed"],
    group: "Preferences",
    aliases: ["timing.window", "schedule.timing"],
  },
  {
    id: "skincare.testing.preference",
    lens: "skincare",
    category: "testing",
    key: "preference",
    label: "Third-party testing",
    why: "Whether to prioritise independently tested products.",
    control: "choice",
    options: ["Prefer tested", "No preference"],
    group: "Preferences",
    aliases: ["testing.third_party"],
  },
  {
    id: "skincare.adherence.level",
    lens: "skincare",
    category: "adherence",
    key: "level",
    label: "How consistent you are",
    why: "Honest input here stops us designing something you'll abandon.",
    control: "choice",
    options: ["Very consistent", "Most days", "Hit and miss"],
    sensitivity: "health",
    group: "Reality check",
    aliases: ["adherence.consistency"],
  },
  {
    id: "skincare.side_effects.notes",
    lens: "skincare",
    category: "side_effects",
    key: "notes",
    label: "Reactions you've had",
    why: "So we avoid repeating something that didn't agree with you.",
    control: "tags",
    placeholder: "retinol stung",
    sensitivity: "health",
    group: "Reality check",
    aliases: ["side_effects.list", "reactions.list"],
  },
  {
    id: "skincare.professional.advice",
    lens: "skincare",
    category: "professional",
    key: "advice",
    label: "Advice from a professional",
    why: "If a dermatologist or doctor told you something, it outranks anything we suggest.",
    control: "text",
    placeholder: "optional",
    sensitivity: "health",
    group: "Reality check",
    aliases: ["professional.recommendations", "doctor.advice"],
  },
  {
    id: "skincare.budget.max_minor",
    lens: "skincare",
    category: "budget",
    key: "max_minor",
    label: "Routine budget",
    why: "A ceiling for the whole routine, not per product.",
    control: "slider",
    min: 50000,
    max: 5000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
  },
];

// ---------------------------------------------------------------------------
// Nutrition lens
// ---------------------------------------------------------------------------

const NUTRITION: ProfileField[] = [
  {
    id: "nutrition.diet.pattern",
    lens: "nutrition",
    category: "diet",
    key: "pattern",
    label: "How you eat",
    why: "The base filter for every food suggestion.",
    control: "chips",
    options: ["No restriction", "Vegetarian", "Vegan", "Eggetarian", "Pescatarian", "Halal", "Kosher", "Jain"],
    sensitivity: "health",
    group: "Diet",
    aliases: ["diet.type", "diet.style", "dietary.pattern"],
  },
  {
    id: "nutrition.allergies.list",
    lens: "nutrition",
    category: "allergies",
    key: "list",
    label: "Allergies & intolerances",
    why: "A hard exclusion. Kept private to this lens and never shared across lenses.",
    control: "tags",
    placeholder: "peanuts, lactose…",
    sensitivity: "health",
    group: "Diet",
    aliases: ["allergies.food", "intolerances.list"],
  },
  {
    id: "nutrition.culture.restrictions",
    lens: "nutrition",
    category: "culture",
    key: "restrictions",
    label: "Cultural or religious restrictions",
    why: "Respected as a hard rule, not a preference.",
    control: "tags",
    placeholder: "no beef, no onion/garlic…",
    sensitivity: "personal",
    group: "Diet",
    aliases: ["culture.rules", "religion.restrictions"],
  },
  {
    id: "nutrition.goals.primary",
    lens: "nutrition",
    category: "goals",
    key: "primary",
    label: "What you're aiming for",
    why: "Shapes portions and macros. Educational guidance only — not medical advice.",
    control: "multichips",
    options: ["More protein", "More energy", "Weight loss", "Muscle gain", "Better digestion", "Balanced eating", "Budget cooking"],
    sensitivity: "health",
    group: "Goals",
    aliases: ["goal.list", "nutrition.goal"],
  },
  {
    id: "nutrition.foods.liked",
    lens: "nutrition",
    category: "foods",
    key: "liked",
    label: "Foods you love",
    why: "A plan built on food you like is one you'll actually eat.",
    control: "tags",
    placeholder: "paneer, oats…",
    group: "Taste",
    aliases: ["foods.likes", "likes.food"],
  },
  {
    id: "nutrition.foods.disliked",
    lens: "nutrition",
    category: "foods",
    key: "disliked",
    label: "Foods you won't eat",
    why: "A hard exclusion — these never appear in a plan.",
    control: "tags",
    placeholder: "mushrooms…",
    group: "Taste",
    aliases: ["foods.dislikes", "dislikes.food"],
  },
  {
    id: "nutrition.cuisines.preferred",
    lens: "nutrition",
    category: "cuisines",
    key: "preferred",
    label: "Cuisines you cook",
    why: "Keeps ingredients familiar and shopping realistic.",
    control: "multichips",
    options: ["North Indian", "South Indian", "Chinese", "Italian", "Mediterranean", "Japanese", "Mexican", "Thai"],
    group: "Taste",
    aliases: ["cuisine.list", "cuisines.liked"],
  },
  {
    id: "nutrition.cooking.time",
    lens: "nutrition",
    category: "cooking",
    key: "time",
    label: "Time you'll spend cooking",
    why: "The most common reason a plan fails. We keep recipes inside this.",
    control: "slider",
    min: 5,
    max: 120,
    step: 5,
    unit: "min",
    group: "Kitchen",
    aliases: ["cooking.minutes", "time.cooking"],
  },
  {
    id: "nutrition.cooking.skill",
    lens: "nutrition",
    category: "cooking",
    key: "skill",
    label: "Comfort in the kitchen",
    why: "Sets recipe complexity.",
    control: "choice",
    options: ["Beginner", "Comfortable", "Confident"],
    group: "Kitchen",
    aliases: ["cooking.level", "skill.cooking"],
  },
  {
    id: "nutrition.equipment.available",
    lens: "nutrition",
    category: "equipment",
    key: "available",
    label: "Equipment you have",
    why: "No point suggesting an air-fryer recipe if you don't own one.",
    control: "multichips",
    options: ["Stovetop", "Oven", "Microwave", "Air fryer", "Pressure cooker", "Blender", "Rice cooker"],
    group: "Kitchen",
    aliases: ["equipment.list", "kitchen.equipment"],
  },
  {
    id: "nutrition.schedule.meals",
    lens: "nutrition",
    category: "schedule",
    key: "meals",
    label: "Meals you plan",
    why: "We only build the meals you actually want planned.",
    control: "multichips",
    options: ["Breakfast", "Lunch", "Dinner", "Snacks"],
    group: "Kitchen",
    aliases: ["schedule.pattern", "meals.planned"],
  },
  {
    id: "nutrition.budget.grocery_minor",
    lens: "nutrition",
    category: "budget",
    key: "grocery_minor",
    label: "Grocery budget",
    why: "A ceiling for the shop, so plans stay affordable.",
    control: "slider",
    min: 50000,
    max: 5000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
    aliases: ["budget.grocery"],
  },
  {
    id: "nutrition.stores.preferred",
    lens: "nutrition",
    category: "stores",
    key: "preferred",
    label: "Where you shop",
    why: "We prioritise what you can actually buy nearby.",
    control: "tags",
    placeholder: "Add a store",
    group: "Budget",
    aliases: ["stores.list", "shops.preferred"],
  },
  {
    id: "nutrition.eating_out.frequency",
    lens: "nutrition",
    category: "eating_out",
    key: "frequency",
    label: "Eating out",
    why: "So a plan doesn't assume you cook every meal.",
    control: "choice",
    options: ["Rarely", "Weekly", "Several times a week"],
    group: "Reality check",
    aliases: ["eating_out.rate", "dining.frequency"],
  },
];

// ---------------------------------------------------------------------------
// Fashion lens
// ---------------------------------------------------------------------------

const STYLE: ProfileField[] = [
  {
    id: "style.sizes.top",
    lens: "style",
    category: "sizes",
    key: "top",
    label: "Top size",
    why: "So we only show things that fit.",
    control: "text",
    placeholder: "M / 40",
    sensitivity: "personal",
    group: "Fit",
    aliases: ["sizes.shirt", "size.top", "measurements.top"],
  },
  {
    id: "style.sizes.bottom",
    lens: "style",
    category: "sizes",
    key: "bottom",
    label: "Bottom size",
    why: "So we only show things that fit.",
    control: "text",
    placeholder: "32 / 34",
    sensitivity: "personal",
    group: "Fit",
    aliases: ["sizes.waist", "size.bottom", "measurements.waist"],
  },
  {
    id: "style.sizes.shoe",
    lens: "style",
    category: "sizes",
    key: "shoe",
    label: "Shoe size",
    why: "So we only show things that fit.",
    control: "text",
    placeholder: "UK 9",
    sensitivity: "personal",
    group: "Fit",
    aliases: ["sizes.footwear", "size.shoe"],
  },
  {
    id: "style.sizes.brand_notes",
    lens: "style",
    category: "sizes",
    key: "brand_notes",
    label: "Brand-specific sizing",
    why: "Sizes drift between brands — your notes beat any chart.",
    control: "tags",
    placeholder: "Uniqlo runs small",
    sensitivity: "personal",
    group: "Fit",
    aliases: ["sizes.brands", "sizing.brand"],
  },
  {
    id: "style.fit.preference",
    lens: "style",
    category: "fit",
    key: "preference",
    label: "Fit you like",
    why: "The difference between a shirt you wear and one you don't.",
    control: "chips",
    options: ["Slim", "Regular", "Relaxed", "Oversized"],
    group: "Fit",
    aliases: ["fit.style", "fit.type"],
  },
  {
    id: "style.style.preference",
    lens: "style",
    category: "style",
    key: "preference",
    label: "Your style",
    why: "Anchors every suggestion to a look you already own.",
    control: "multichips",
    options: ["Minimal", "Classic", "Streetwear", "Smart casual", "Formal", "Sporty", "Bohemian"],
    group: "Taste",
    aliases: ["style.aesthetic", "style.vibe"],
  },
  {
    id: "style.colors.preferred",
    lens: "style",
    category: "colors",
    key: "preferred",
    label: "Colours you wear",
    why: "Keeps outfits inside a palette that already works for you.",
    control: "tags",
    placeholder: "navy, olive…",
    group: "Taste",
    aliases: ["colors.liked", "colours.preferred", "palette.colors"],
  },
  {
    id: "style.colors.avoid",
    lens: "style",
    category: "colors",
    key: "avoid",
    label: "Colours to avoid",
    why: "A hard exclusion.",
    control: "tags",
    placeholder: "neon…",
    group: "Taste",
    aliases: ["colors.disliked"],
  },
  {
    id: "style.fabrics.avoid",
    lens: "style",
    category: "fabrics",
    key: "avoid",
    label: "Fabrics to avoid",
    why: "Comfort and allergies both live here — treated as a hard rule.",
    control: "tags",
    placeholder: "wool, polyester…",
    group: "Taste",
    aliases: ["fabrics.disliked", "materials.avoid"],
  },
  {
    id: "style.modesty.preference",
    lens: "style",
    category: "modesty",
    key: "preference",
    label: "Coverage preference",
    why: "Respected as a rule, not a suggestion.",
    control: "chips",
    options: ["No preference", "Modest", "Full coverage"],
    sensitivity: "personal",
    group: "Taste",
    aliases: ["modesty.level", "coverage.preference"],
  },
  {
    id: "style.occasions.common",
    lens: "style",
    category: "occasions",
    key: "common",
    label: "What you dress for",
    why: "We build outfits for your actual week, not a catalogue's.",
    control: "multichips",
    options: ["Work", "Casual", "Date night", "Wedding", "Travel", "Gym"],
    group: "Life",
    aliases: ["occasions.list", "occasion.common"],
  },
  {
    id: "style.climate.local",
    lens: "style",
    category: "climate",
    key: "local",
    label: "Your climate",
    why: "A linen shirt is a different recommendation in Delhi than in Edinburgh.",
    control: "chips",
    options: ["Hot & humid", "Hot & dry", "Temperate", "Cold", "Four seasons"],
    group: "Life",
    aliases: ["climate.type", "weather.local"],
  },
  {
    id: "style.budget.max_minor",
    lens: "style",
    category: "budget",
    key: "max_minor",
    label: "Per-item budget",
    why: "A hard ceiling per garment, not per outfit.",
    control: "slider",
    min: 50000,
    max: 5000000,
    step: 50000,
    minorUnits: true,
    group: "Budget",
  },
  {
    id: "style.returns.reasons",
    lens: "style",
    category: "returns",
    key: "reasons",
    label: "Why you've returned things",
    why: "The most useful signal you can give us — it tells us what to stop suggesting.",
    control: "tags",
    placeholder: "sleeves too short",
    group: "Learning",
    aliases: ["returns.list", "return.reasons"],
  },
  {
    id: "style.feedback.outfits",
    lens: "style",
    category: "feedback",
    key: "outfits",
    label: "Outfit feedback",
    why: "What worked and what didn't, in your words.",
    control: "tags",
    placeholder: "the linen combo worked",
    group: "Learning",
    aliases: ["feedback.list", "outfit.feedback"],
  },
  {
    id: "style.consent.photos",
    lens: "style",
    category: "consent",
    key: "photos",
    label: "Use my uploaded photos",
    why: "Off by default. When on, we can read outfit photos you upload to judge fit and colour.",
    control: "toggle",
    sensitivity: "personal",
    group: "Privacy",
    aliases: ["consent.photo", "photo.consent"],
  },
];

export const PROFILE_FIELDS: readonly ProfileField[] = [
  ...SHARED,
  ...GIFT,
  ...SKINCARE,
  ...NUTRITION,
  ...STYLE,
];

// ---------------------------------------------------------------------------
// Structured records — the list-shaped things a single key/value can't hold
// ---------------------------------------------------------------------------

/** One editable attribute on a record (a recipient, a wardrobe item…). */
export interface RecordFieldDef {
  key: string;
  label: string;
  control: FieldControl;
  options?: readonly string[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface RecordKindDef {
  kind: string;
  /** Singular noun used in buttons: "Add recipient". */
  noun: string;
  pluralNoun: string;
  /** What this list is for, shown as the empty state. */
  blurb: string;
  labelPlaceholder: string;
  sensitivity?: FactSensitivity;
  fields: readonly RecordFieldDef[];
}

export const RECORD_SCHEMAS: Record<string, RecordKindDef> = {
  recipient: {
    kind: "recipient",
    noun: "person",
    pluralNoun: "People you shop for",
    blurb:
      "Keep a profile per person so a gift for your sister never gets confused with one for your manager.",
    labelPlaceholder: "Mum, Arjun, my manager…",
    sensitivity: "personal",
    fields: [
      {
        key: "relationship",
        label: "Relationship",
        control: "chips",
        options: ["Partner", "Parent", "Sibling", "Child", "Friend", "Colleague", "Client"],
      },
      { key: "interests", label: "Interests", control: "tags", placeholder: "cycling, coffee…" },
      { key: "dislikes", label: "Dislikes", control: "tags", placeholder: "scented candles…" },
      { key: "sizes", label: "Sizes", control: "tags", placeholder: "M, UK 9…" },
      { key: "colors", label: "Colours", control: "tags", placeholder: "navy, olive…" },
      { key: "brands", label: "Brands they love", control: "tags", placeholder: "Add a brand" },
      { key: "important_date", label: "Key date", control: "date" },
      {
        key: "budget_minor",
        label: "Usual budget",
        control: "slider",
        min: 50000,
        max: 5000000,
        step: 50000,
      },
      { key: "past_gifts", label: "Already given", control: "tags", placeholder: "pour-over kit" },
      { key: "notes", label: "Notes", control: "text", placeholder: "anything else" },
    ],
  },
  wardrobe_item: {
    kind: "wardrobe_item",
    noun: "item",
    pluralNoun: "Your wardrobe",
    blurb:
      "Tell us what you already own and we build around it — outfits instead of isolated products.",
    labelPlaceholder: "Navy linen shirt",
    fields: [
      {
        key: "category",
        label: "Category",
        control: "chips",
        options: ["Top", "Bottom", "Outerwear", "Shoes", "Accessory", "Dress"],
      },
      { key: "color", label: "Colour", control: "text", placeholder: "navy" },
      { key: "fabric", label: "Fabric", control: "text", placeholder: "linen" },
      { key: "brand", label: "Brand", control: "text", placeholder: "optional" },
      { key: "size", label: "Size", control: "text", placeholder: "M" },
      {
        key: "fit",
        label: "How it fits",
        control: "chips",
        options: ["Too small", "Just right", "Too big"],
      },
      {
        key: "wear_frequency",
        label: "How often you wear it",
        control: "chips",
        options: ["Weekly", "Monthly", "Rarely"],
      },
    ],
  },
  supplement: {
    kind: "supplement",
    noun: "supplement",
    pluralNoun: "Your current stack",
    blurb:
      "What you already take, so we never suggest a duplicate or something that stacks badly. Kept private to this lens.",
    labelPlaceholder: "Vitamin D3",
    sensitivity: "health",
    fields: [
      { key: "ingredient", label: "Key ingredient", control: "text", placeholder: "cholecalciferol" },
      { key: "dose", label: "Dose", control: "text", placeholder: "1000 IU" },
      {
        key: "form",
        label: "Form",
        control: "chips",
        options: ["Capsule", "Tablet", "Powder", "Gummy", "Liquid"],
      },
      {
        key: "timing",
        label: "When",
        control: "chips",
        options: ["Morning", "With meals", "Evening", "Before bed"],
      },
      {
        key: "adherence",
        label: "How consistently",
        control: "chips",
        options: ["Daily", "Most days", "Occasionally"],
      },
      { key: "side_effects", label: "Any reactions", control: "text", placeholder: "optional" },
    ],
  },
  pantry_item: {
    kind: "pantry_item",
    noun: "item",
    pluralNoun: "Your pantry",
    blurb: "What's already in the kitchen, so plans use it up instead of ignoring it.",
    labelPlaceholder: "Rolled oats",
    fields: [
      {
        key: "category",
        label: "Category",
        control: "chips",
        options: ["Grain", "Protein", "Vegetable", "Dairy", "Spice", "Oil", "Snack"],
      },
      { key: "quantity", label: "How much", control: "text", placeholder: "1 kg" },
      { key: "expires", label: "Use by", control: "date" },
    ],
  },
  household: {
    kind: "household",
    noun: "person",
    pluralNoun: "Who you cook for",
    blurb: "Everyone you feed, so portions and restrictions cover the whole table.",
    labelPlaceholder: "Partner, toddler…",
    sensitivity: "personal",
    fields: [
      {
        key: "age_group",
        label: "Age group",
        control: "chips",
        options: ["Infant", "Child", "Teen", "Adult", "Senior"],
      },
      { key: "restrictions", label: "Restrictions", control: "tags", placeholder: "no nuts…" },
      { key: "dislikes", label: "Won't eat", control: "tags", placeholder: "mushrooms…" },
    ],
  },
  meal_preference: {
    kind: "meal_preference",
    noun: "meal",
    pluralNoun: "Meals you rate",
    blurb: "Dishes that worked (or didn't) — the fastest way for plans to get better.",
    labelPlaceholder: "Rajma chawal",
    fields: [
      {
        key: "verdict",
        label: "Verdict",
        control: "chips",
        options: ["Loved it", "Fine", "Not again"],
      },
      {
        key: "meal_slot",
        label: "Meal",
        control: "chips",
        options: ["Breakfast", "Lunch", "Dinner", "Snack"],
      },
      { key: "notes", label: "Notes", control: "text", placeholder: "too spicy" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const BY_IDENTITY = new Map<string, ProfileField>();
const BY_ALIAS = new Map<string, ProfileField>();

function identity(lens: ProfileLens, category: string, key: string): string {
  return `${lens}.${category}.${key}`;
}

for (const f of PROFILE_FIELDS) {
  BY_IDENTITY.set(identity(f.lens, f.category, f.key), f);
  // Bare "category.key" also resolves, scoped per lens below.
  BY_ALIAS.set(`${f.lens}::${f.category}.${f.key}`, f);
  for (const a of f.aliases ?? []) BY_ALIAS.set(`${f.lens}::${a}`, f);
}

export function fieldsForLens(lens: ProfileLens): ProfileField[] {
  return PROFILE_FIELDS.filter((f) => f.lens === lens);
}

/** Fields grouped by their `group` heading, preserving declaration order. */
export function groupedFieldsForLens(
  lens: ProfileLens,
): Array<{ group: string; fields: ProfileField[] }> {
  const out: Array<{ group: string; fields: ProfileField[] }> = [];
  for (const f of fieldsForLens(lens)) {
    const last = out[out.length - 1];
    if (last && last.group === f.group) last.fields.push(f);
    else out.push({ group: f.group, fields: [f] });
  }
  return out;
}

export function findField(
  lens: ProfileLens,
  category: string,
  key: string,
): ProfileField | null {
  return BY_IDENTITY.get(identity(lens, category, key)) ?? null;
}

/**
 * Resolve a ledger key the model wrote ("recipient.loves") onto a real form
 * field, so an agent-learned fact appears in the right control rather than as
 * an orphan row.
 *
 * Exact identity first, then declared aliases, then a normalized match on the
 * key alone. Returns null when nothing matches — the fact is still stored, it
 * just renders in the "Other things we've learned" section.
 */
export function resolveFieldForKey(
  lens: ProfileLens,
  ledgerKey: string,
): ProfileField | null {
  const cleaned = ledgerKey.trim().toLowerCase();
  const direct = BY_ALIAS.get(`${lens}::${cleaned}`);
  if (direct) return direct;

  // Try the shared scope too — budget/country live there.
  const shared = BY_ALIAS.get(`shared::${cleaned}`);
  if (shared) return shared;

  // Last resort: match on the trailing key segment within this lens.
  const tail = cleaned.includes(".") ? cleaned.slice(cleaned.indexOf(".") + 1) : cleaned;
  for (const f of fieldsForLens(lens)) {
    if (f.key === tail) return f;
  }
  return null;
}

/**
 * The compact catalog handed to the model.
 *
 * Deliberately terse, and it SHRINKS as the profile fills: already-known
 * fields are omitted, so the list doubles as "what you still don't know about
 * this shopper". A complete profile costs the prompt almost nothing, which is
 * what keeps this cheap enough to send every turn.
 *
 * Its purpose is that `update_ledger` writes land on real form fields the
 * shopper can see and correct, instead of inventing a new slug each time.
 */
export function fieldCatalogForPrompt(
  lens: ProfileLens,
  /** `category.key` identities already stored for this shopper. */
  filled: ReadonlySet<string> = new Set(),
  limit = 18,
): string {
  const lines: string[] = [];
  const candidates = [...fieldsForLens(lens), ...fieldsForLens("shared")].filter(
    (f) => !filled.has(`${f.category}.${f.key}`),
  );
  for (const f of candidates.slice(0, limit)) {
    const opts =
      f.control === "chips" || f.control === "multichips" || f.control === "choice"
        ? ` (${(f.options ?? []).slice(0, 8).join("|")})`
        : f.control === "slider"
          ? // Money is asked for in WHOLE units because that is how people say
            // it ("5000 rupees"); coerceValueForField converts to minor units.
            ` (number${f.unit ? ` in ${f.unit}` : f.minorUnits ? ", whole currency units e.g. 5000" : ""})`
          : f.control === "tags"
            ? " (comma-separated)"
            : "";
    lines.push(`${f.category}.${f.key} — ${f.label}${opts}`);
  }
  return lines.join("\n");
}

/** Percentage of a lens's fields that have a stored value. */
export function completionForLens(
  lens: ProfileLens,
  filled: ReadonlySet<string>,
): { filled: number; total: number; percent: number } {
  const fields = fieldsForLens(lens);
  const done = fields.filter((f) => filled.has(`${f.category}.${f.key}`)).length;
  return {
    filled: done,
    total: fields.length,
    percent: fields.length === 0 ? 0 : Math.round((done / fields.length) * 100),
  };
}
