import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** TripLens — packing kit builder. Plan-first packing blueprint for a specific trip. */
function heuristicKit(intent: BaseIntent): PlanComponentSpec[] {
  const activity = intent.interests[0] ?? intent.occasion ?? "travel";
  return [
    { key: "layer", label: "Weather layer", why: "A base layer sized to the trip's climate.", essential: true, query: `${activity} base layer thermal`, budgetWeight: 1, group: null },
    { key: "outer", label: "Outer layer", why: "Protection from wind and rain.", essential: true, query: `${activity} waterproof jacket`, budgetWeight: 1.5, group: null },
    { key: "footwear", label: "Footwear", why: "Comfortable, activity-appropriate shoes.", essential: true, query: `${activity} walking shoes`, budgetWeight: 1.4, group: null },
    { key: "daybag", label: "Day bag", why: "Carries essentials for day trips.", essential: false, query: "compact daypack travel", budgetWeight: 0.9, group: null },
    { key: "adapter", label: "Travel adapter", why: "Keeps devices charged abroad.", essential: false, query: "universal travel adapter", budgetWeight: 0.4, group: null },
    { key: "toiletries", label: "Toiletries", why: "Travel-size essentials for the trip.", essential: false, query: "travel toiletry kit", budgetWeight: 0.5, group: null },
  ];
}

const travel = makePlanMode({
  meta: MODE_META.travel,
  noun: "item",
  extractGuidance: `This is a trip packing request. Map destination + season + activities → occasion/interests/styleKeywords; an item they already own to build around → interests; things they don't need → exclusions; the budget → budget. Capture the country if stated.`,
  blueprintGuidance: `Design a compact packing kit as components (weather layer, outer layer, footwear, day bag, adapter, toiletries) matched to the destination's climate and the stated activities. Prefer versatile, compact items.`,
  heuristicComponents: heuristicKit,
});

export default travel;
