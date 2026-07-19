import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** StyleLens — outfit builder. Plan-first: an OutfitBlueprint of coordinated pieces. */
function heuristicOutfit(intent: BaseIntent): PlanComponentSpec[] {
  const style = intent.styleKeywords[0] ?? intent.softPreferences[0] ?? "smart casual";
  return [
    { key: "top", label: "Top", why: "The anchor of the look.", essential: true, query: `${style} shirt top`, budgetWeight: 1.2, group: null },
    { key: "bottom", label: "Bottom", why: "Balances the silhouette.", essential: true, query: `${style} trousers chinos`, budgetWeight: 1.3, group: null },
    { key: "footwear", label: "Footwear", why: "Sets the formality of the outfit.", essential: true, query: `${style} shoes sneakers`, budgetWeight: 1.6, group: null },
    { key: "outer", label: "Outer layer", why: "Adds depth and adapts to weather.", essential: false, query: `${style} overshirt jacket`, budgetWeight: 1.4, group: null },
    { key: "accessory", label: "Accessory", why: "A finishing detail that ties it together.", essential: false, query: `${style} belt watch accessory`, budgetWeight: 0.5, group: null },
  ];
}

const style = makePlanMode({
  meta: MODE_META.style,
  noun: "outfit piece",
  extractGuidance: `This is an outfit request. Map occasion/impression → occasion; personal style + inspiration words + colors → styleKeywords; preferred fit, sizes, modesty, climate, materials, brands → softPreferences; colors to avoid + disliked items → exclusions; an existing anchor item they own → interests.`,
  blueprintGuidance: `Design an OutfitBlueprint of coordinated components (top, bottom, footwear, an optional outer layer, and an optional accessory). Keep formality and palette consistent with the stated direction. Never claim a style is objectively flattering — describe how it matches the chosen direction instead.`,
  heuristicComponents: heuristicOutfit,
});

export default style;
