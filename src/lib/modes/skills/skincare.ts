import "server-only";
import { MODE_META } from "../meta";
import type { BaseIntent, PlanComponentSpec } from "../types";
import { makePlanMode } from "./_shared";

/**
 * RoutineLens — educational skincare routine builder. Plan-first with a strict
 * safety policy: no diagnosis, no cure claims, product facts only from the
 * catalog, and a red-flag gate that defers to professionals.
 */

function heuristicRoutine(intent: BaseIntent): PlanComponentSpec[] {
  const fragranceFree = intent.exclusions.some((e) => /fragrance|perfume|scent/i.test(e));
  const q = (base: string) => (fragranceFree ? `fragrance-free ${base}` : base);
  return [
    {
      key: "am-cleanser",
      label: "Gentle cleanser",
      why: "A mild morning cleanse removes overnight buildup without stripping the skin.",
      essential: true,
      query: q("gentle facial cleanser sensitive skin"),
      budgetWeight: 1,
      group: "Morning",
    },
    {
      key: "am-moisturizer",
      label: "Moisturizer",
      why: "Supports the skin barrier and keeps skin hydrated through the day.",
      essential: true,
      query: q("hydrating facial moisturizer sensitive skin"),
      budgetWeight: 1.2,
      group: "Morning",
    },
    {
      key: "am-spf",
      label: "Sunscreen",
      why: "Daytime broad-spectrum protection is the highest-impact step.",
      essential: true,
      query: q("broad spectrum face sunscreen spf 50"),
      budgetWeight: 1,
      group: "Morning",
    },
    {
      key: "pm-moisturizer",
      label: "Night moisturizer",
      why: "A richer evening moisturizer helps overnight recovery.",
      essential: false,
      query: q("night cream moisturizer sensitive skin"),
      budgetWeight: 1,
      group: "Evening",
    },
  ];
}

const skincare = makePlanMode({
  meta: MODE_META.skincare,
  noun: "routine step",
  extractGuidance: `This is a skincare routine request. Map: self-described skin type + concerns → interests; ingredients/fragrance to avoid → exclusions (e.g. "fragrance" if they want fragrance-free); brand/vegan/cruelty-free/format preferences → softPreferences; morning/evening/complexity notes → softPreferences. Never infer allergies or medical conditions that were not stated.`,
  blueprintGuidance: `Propose a SIMPLE, preference-based routine as ordered steps grouped by "Morning" and "Evening" (use the group field). A minimal routine is cleanser + moisturizer + sunscreen (AM). Only add steps the person asked for. Keep it educational — do NOT include prescription/treatment products or claim any product treats a condition. Queries should reflect stated preferences (e.g. "fragrance-free").`,
  heuristicComponents: heuristicRoutine,
  safety: {
    disclaimer:
      "RoutineLens is an educational shopping helper — not medical advice. It can't diagnose skin conditions or replace a dermatologist. Patch-test new products, and see a professional for persistent, severe, or pregnancy-related concerns.",
    blockedClaimPatterns: [
      /\b(cure|cures|treat|treats|heal|heals|diagnos\w*|prescri\w*|clinically proven|eliminat\w* (acne|eczema|rosacea|dermatitis))\b/i,
      /\bguarantee\w*\b/i,
    ],
    gate: (intent) => {
      const text = [
        intent.occasion ?? "",
        ...intent.interests,
        ...intent.hardConstraints,
        ...intent.softPreferences,
        ...intent.exclusions,
      ]
        .join(" ")
        .toLowerCase();
      if (
        /\b(pregnan\w*|eczema|rosacea|acne|infection|allerg\w*|reaction|dermatitis|prescription|medical)\b/.test(
          text,
        )
      ) {
        return "This may need professional guidance — please check with a dermatologist or doctor before starting new products. I'll keep suggestions general and gentle.";
      }
      return null;
    },
  },
});

export default skincare;
