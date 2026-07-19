import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** FuelLens — goal-based grocery basket. Educational, not a diet/medical planner. */
function heuristicBasket(intent: BaseIntent): PlanComponentSpec[] {
  const text = intent.interests
    .concat(intent.softPreferences, intent.searchThemes, [intent.occasion ?? ""])
    .join(" ")
    .toLowerCase();
  const veg = /veg|plant/.test(text);
  const proteinQ = veg ? "high protein vegetarian food" : "high protein food";
  const components: PlanComponentSpec[] = [
    { key: "breakfast", label: "Breakfast protein", why: "An easy protein source to start the day.", essential: true, query: `${proteinQ} breakfast`, budgetWeight: 1, group: null },
    { key: "main", label: "Main-meal protein", why: "The centerpiece protein for main meals.", essential: true, query: proteinQ, budgetWeight: 1.4, group: null },
    { key: "snack", label: "Convenient snack", why: "A grab-and-go option for busy days.", essential: false, query: `${proteinQ} snack bar`, budgetWeight: 0.8, group: null },
    { key: "pantry", label: "Pantry staple", why: "A versatile staple to build meals around.", essential: false, query: veg ? "pantry staple grains legumes" : "pantry staple grains", budgetWeight: 0.9, group: null },
  ];
  // Supplements are strictly opt-in — only include when explicitly requested.
  if (/supplement|protein powder|whey|creatine|shake/.test(text)) {
    components.push({
      key: "supplement",
      label: "Optional protein powder",
      why: "You asked about supplements — food-first is still the default; this is optional.",
      essential: false,
      query: veg ? "plant protein powder" : "protein powder",
      budgetWeight: 0.9,
      group: "Optional (opt-in)",
    });
  }
  return components;
}

const nutrition = makePlanMode({
  meta: MODE_META.nutrition,
  noun: "basket item",
  extractGuidance: `This is a goal-based grocery basket. Map dietary pattern (vegetarian/vegan) + preferred foods + goal → interests/softPreferences; allergies and foods to avoid → exclusions; a stated protein/calorie target, meal count, cooking time, budget → softPreferences/budget. Do NOT invent nutrition numbers.`,
  blueprintGuidance: `Propose a general shopping basket by category (e.g. breakfast protein, main-meal protein, convenient snack, pantry staple). Treat supplements as OPTIONAL and clearly opt-in — food-first is the default; only include a supplement component if the shopper asked. Do not create calorie/protein targets or claim health outcomes.`,
  heuristicComponents: heuristicBasket,
  safety: {
    disclaimer:
      "FuelLens is an educational shopping helper, not a dietitian or medical advice. It organizes a general food basket around your stated goal and preferences — it doesn't diagnose deficiencies, set calorie targets, or promise health outcomes. Supplements are optional. Seek professional guidance for medical conditions, pregnancy, or eating-disorder concerns.",
    blockedClaimPatterns: [
      /\b(cure|cures|treat|treats|diagnos\w*|prescri\w*|clinically proven|guarantee\w*)\b/i,
      /\b(lose|gain) \d+\s?(kg|kgs|kilos|pounds|lbs)\b/i,
    ],
    requireOptIn: ["supplement", "protein powder"],
    gate: (intent: BaseIntent) => {
      const text = [
        intent.occasion ?? "",
        ...intent.interests,
        ...intent.softPreferences,
        ...intent.hardConstraints,
        ...intent.exclusions,
      ]
        .join(" ")
        .toLowerCase();
      if (/\b(eating disorder|anorexi\w*|bulimi\w*|diabet\w*|pregnan\w*|medical|medication)\b/.test(text)) {
        return "This is best guided by a professional — please check with a doctor or registered dietitian. I'll keep this to a general, food-first basket.";
      }
      return null;
    },
  },
});

export default nutrition;
