import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** NewChapter — life-transition shopping plan, phased by priority. */
function heuristicPhases(intent: BaseIntent): PlanComponentSpec[] {
  const context = intent.occasion ?? intent.interests[0] ?? "first apartment";
  return [
    { key: "sleep", label: "Sleep essentials", why: "Somewhere comfortable to sleep from night one.", essential: true, query: `${context} bedding essentials`, budgetWeight: 1.6, group: "Must have now" },
    { key: "kitchen", label: "Kitchen basics", why: "The minimum to prepare simple meals.", essential: true, query: `${context} kitchen starter set`, budgetWeight: 1.4, group: "Must have now" },
    { key: "cleaning", label: "Cleaning + storage", why: "Keeps the new space livable.", essential: false, query: `${context} cleaning storage set`, budgetWeight: 0.9, group: "First month" },
    { key: "comfort", label: "Comfort + lighting", why: "Makes the space feel like home.", essential: false, query: `${context} lamp comfort`, budgetWeight: 1, group: "First month" },
    { key: "extras", label: "Nice-to-haves", why: "Can wait until you've settled in.", essential: false, query: `${context} decor extras`, budgetWeight: 0.8, group: "Can wait" },
  ];
}

const lifestage = makePlanMode({
  meta: MODE_META.lifestage,
  noun: "essential",
  extractGuidance: `This is a life-transition setup (first apartment, dorm, new job, new home office, etc.). Map the scenario + space constraints → occasion/interests/softPreferences; things they already have or don't need → exclusions; total budget → budget.`,
  blueprintGuidance: `Design a phased plan grouped as "Must have now", "First month", and "Can wait" (use the group field) so the person can buy by priority instead of all at once. Allocate more budget to the must-haves.`,
  heuristicComponents: heuristicPhases,
});

export default lifestage;
