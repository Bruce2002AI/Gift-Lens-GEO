import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/** SpaceLens — room stylist. Plan-first room blueprint. Never claims an item fits a space. */
function heuristicRoom(intent: BaseIntent): PlanComponentSpec[] {
  const mood = intent.styleKeywords[0] ?? intent.softPreferences[0] ?? "warm minimalist";
  return [
    { key: "lighting", label: "Main lighting", why: "Lighting sets the mood of the room more than any other piece.", essential: true, query: `${mood} table lamp`, budgetWeight: 1.3, group: null },
    { key: "textile", label: "Bedding or textile", why: "Soft textiles add warmth and texture.", essential: true, query: `${mood} throw blanket cushion`, budgetWeight: 1.4, group: null },
    { key: "storage", label: "Storage", why: "Keeps the space calm and uncluttered.", essential: false, query: `${mood} storage basket shelf`, budgetWeight: 1.2, group: null },
    { key: "wall", label: "Wall accent", why: "Draws the eye and anchors the palette.", essential: false, query: `${mood} wall art print`, budgetWeight: 0.9, group: null },
    { key: "accent", label: "Decorative accent", why: "A small finishing object that adds character.", essential: false, query: `${mood} decorative object vase`, budgetWeight: 0.8, group: null },
  ];
}

const room = makePlanMode({
  meta: MODE_META.room,
  noun: "piece",
  extractGuidance: `This is a room refresh. Map the desired mood/aesthetic + room type → styleKeywords/occasion; palette and material preferences → softPreferences; things to avoid → exclusions; the total budget → budget.`,
  blueprintGuidance: `Design a room blueprint of coordinated pieces (main lighting, a textile, storage, a wall accent, a decorative accent). Keep the palette and aesthetic coherent. NEVER claim an item physically fits the space — you don't have validated dimensions; describe style fit only.`,
  heuristicComponents: heuristicRoom,
});

export default room;
