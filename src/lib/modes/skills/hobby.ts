import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** StartLens — beginner hobby starter-kit builder. Essentials → useful additions → optional upgrades. */
function heuristicKit(intent: BaseIntent): PlanComponentSpec[] {
  const hobby = intent.interests[0] ?? intent.occasion ?? intent.searchThemes[0] ?? "beginner";
  return [
    { key: "core", label: "Core tool", why: "The one essential item you can't start without.", essential: true, query: `beginner ${hobby} essential`, budgetWeight: 1.6, group: "Essentials" },
    { key: "essential-2", label: "Second essential", why: "Needed alongside the core tool to actually begin.", essential: true, query: `${hobby} starter kit`, budgetWeight: 1.2, group: "Essentials" },
    { key: "useful", label: "Useful addition", why: "Improves the experience but you can add it later.", essential: false, query: `${hobby} accessory`, budgetWeight: 0.9, group: "Useful additions" },
    { key: "upgrade", label: "Optional upgrade", why: "A nicer option to grow into once you're hooked.", essential: false, query: `${hobby} premium`, budgetWeight: 1, group: "Optional upgrades" },
  ];
}

const hobby = makePlanMode({
  meta: MODE_META.hobby,
  noun: "item",
  extractGuidance: `This is a beginner hobby kit request. Map the hobby + skill level + constraints (small apartment, quiet, etc.) → interests/occasion/softPreferences; the total budget → budget.`,
  blueprintGuidance: `Design a beginner starter kit grouped as "Essentials", "Useful additions", and "Optional upgrades" (use the group field). Only mark truly required items essential. Do NOT claim two products are compatible unless that's obvious from the product itself.`,
  heuristicComponents: heuristicKit,
});

export default hobby;
