import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** ReadyLens — a complete shopping plan to get ready for an occasion. */
function heuristicOccasion(intent: BaseIntent): PlanComponentSpec[] {
  const occasion = intent.occasion ?? intent.interests[0] ?? "occasion";
  return [
    { key: "outfit", label: "Outfit", why: "The centerpiece of getting ready.", essential: true, query: `${occasion} outfit`, budgetWeight: 1.6, group: null },
    { key: "footwear", label: "Footwear", why: "Completes the look appropriately.", essential: true, query: `${occasion} shoes`, budgetWeight: 1.2, group: null },
    { key: "accessory", label: "Accessory", why: "A finishing detail for the occasion.", essential: false, query: `${occasion} accessory`, budgetWeight: 0.7, group: null },
    { key: "extra", label: "Occasion extra", why: "A practical or thoughtful item the occasion calls for (host gift, grooming, organizer).", essential: false, query: `${occasion} essentials`, budgetWeight: 0.9, group: null },
  ];
}

const occasion = makePlanMode({
  meta: MODE_META.occasion,
  noun: "item",
  extractGuidance: `This is an "get me ready for X" request spanning multiple categories (outfit, footwear, accessories, plus practical items like a host gift, grooming, or an organizer). Map the occasion + vibe → occasion/styleKeywords; preferences → softPreferences; things to avoid → exclusions; budget → budget.`,
  blueprintGuidance: `Design a complete occasion plan spanning the relevant categories for the stated event (e.g. dinner party → table setting, serving piece, lighting, host gift; interview → outfit, shoes, bag, organizer). Keep formality consistent with the occasion.`,
  heuristicComponents: heuristicOccasion,
});

export default occasion;
