import { describe, expect, it } from "vitest";
import { coerceValueForField } from "@/lib/personalization/coerce";
import {
  mergeRecordData,
  personRecordFromUpserts,
} from "@/lib/personalization/records-bridge";
import { findField, type ProfileField } from "@/lib/personalization/schema";
import type { FactUpsert, FactValue } from "@/lib/personalization/types";

function field(lens: "gift" | "style" | "nutrition" | "skincare" | "shared", category: string, key: string): ProfileField {
  const f = findField(lens, category, key);
  if (!f) throw new Error(`missing test fixture field ${lens}.${category}.${key}`);
  return f;
}

describe("coerceValueForField", () => {
  /**
   * The one that actually bit: "5000 rupees" was stored as 5000 minor units
   * (₹50) instead of 500000, silently making every budget 100x too small.
   */
  it("converts model-written money from whole units to minor units", () => {
    const f = field("gift", "budget", "max_minor");
    expect(coerceValueForField(f, "5000")).toBe(500000);
    expect(coerceValueForField(f, "about 5,000 rupees")).toBe(500000);
  });

  it("does not scale non-money sliders", () => {
    const f = field("nutrition", "cooking", "time");
    expect(coerceValueForField(f, "20")).toBe(20);
    expect(coerceValueForField(f, "20 min")).toBe(20);
  });

  /**
   * Regression: "5k" / "2 lakh" parsed as 5 / 2 then clamped to the field floor
   * stored a ₹5,000 / ₹200,000 budget as ₹500.
   */
  it("applies spoken magnitude suffixes to money", () => {
    const f = field("gift", "budget", "max_minor");
    expect(coerceValueForField(f, "5k")).toBe(500000); // ₹5,000
    expect(coerceValueForField(f, "50k")).toBe(5000000); // ₹50,000
    expect(coerceValueForField(f, "2 lakh")).toBe(20000000); // ₹2,00,000
    expect(coerceValueForField(f, "1.5 lakh")).toBe(15000000);
  });

  it("does not mistake an intra-word 'k'/'m' for a magnitude", () => {
    // "5000" has no suffix; must stay 5000 major → 500000 minor.
    const f = field("gift", "budget", "max_minor");
    expect(coerceValueForField(f, "5000")).toBe(500000);
  });

  it("keeps a legitimate 'and' inside a single brand/dish tag", () => {
    const f = field("gift", "recipient", "brands");
    // No comma → the whole phrase is one value, not ["Marks","Spencer"].
    expect(coerceValueForField(f, "Marks and Spencer")).toEqual(["Marks and Spencer"]);
    // With a comma it IS a list, and "and" separates the last item.
    expect(coerceValueForField(f, "Nike, Adidas and Puma")).toEqual([
      "Nike",
      "Adidas",
      "Puma",
    ]);
  });

  it("keeps an unlisted multi-select answer instead of dropping it", () => {
    // "acne" is not a declared skincare goal, but a stated health fact must
    // never be silently discarded.
    const f = field("skincare", "goals", "primary");
    expect(coerceValueForField(f, "acne")).toEqual(["acne"]);
  });

  it("clamps a number to the field's declared range", () => {
    const f = field("nutrition", "cooking", "time"); // 5..120
    expect(coerceValueForField(f, "999")).toBe(120);
    expect(coerceValueForField(f, "1")).toBe(5);
  });

  it("splits a comma-separated prose list into real tags", () => {
    const f = field("gift", "recipient", "interests");
    expect(coerceValueForField(f, "pottery, hiking")).toEqual(["pottery", "hiking"]);
    // Bare "and" with NO comma stays one value — protects "Marks and Spencer".
    // The model emits real lists with commas (verified live), so this is safe.
    expect(coerceValueForField(f, "pottery and hiking")).toEqual(["pottery and hiking"]);
  });

  it("dedupes tags", () => {
    const f = field("gift", "recipient", "interests");
    expect(coerceValueForField(f, "tea, tea, coffee")).toEqual(["tea", "coffee"]);
  });

  it("maps multi-select prose onto declared options, keeping unlisted ones", () => {
    const f = field("style", "style", "preference");
    expect(coerceValueForField(f, "minimal, smart casual")).toEqual([
      "Minimal",
      "Smart casual",
    ]);
    // An unlisted value is KEPT (not dropped) — a stated preference must never
    // silently vanish; the form shows it beside the canonical chips.
    expect(coerceValueForField(f, "cottagecore")).toEqual(["cottagecore"]);
  });

  it("canonicalizes single-select casing and partial phrasing", () => {
    const skin = field("skincare", "skin", "type");
    expect(coerceValueForField(skin, "oily")).toBe("Oily");
    const routine = field("skincare", "routine", "length");
    expect(String(coerceValueForField(routine, "minimal"))).toMatch(/^Minimal/);
  });

  it("keeps an unlisted single-select answer rather than losing it", () => {
    const f = field("skincare", "skin", "type");
    expect(coerceValueForField(f, "dehydrated but oily")).toBe("dehydrated but oily");
  });

  it("parses switches", () => {
    const f = field("style", "consent", "photos");
    expect(coerceValueForField(f, "yes")).toBe(true);
    expect(coerceValueForField(f, "no")).toBe(false);
    expect(coerceValueForField(f, "maybe")).toBeNull();
  });

  it("normalizes a parseable date and preserves an unparseable one", () => {
    const f = field("gift", "occasion", "deadline");
    expect(coerceValueForField(f, "2026-03-14")).toBe("2026-03-14");
    expect(coerceValueForField(f, "sometime before the wedding")).toBe(
      "sometime before the wedding",
    );
  });

  it("returns null for empty input so junk is never stored", () => {
    const f = field("gift", "recipient", "interests");
    expect(coerceValueForField(f, "   ")).toBeNull();
  });
});

describe("person records from a conversation", () => {
  function upsert(category: string, key: string, value: FactValue): FactUpsert {
    return {
      lens: "gift",
      category,
      key,
      value,
      source: "explicit",
      confidence: 1,
      sensitivity: "standard",
      consentScope: "lens_only",
      quote: null,
    };
  }

  it("builds a record for the named person from what was learned", () => {
    const draft = personRecordFromUpserts("gift", [
      upsert("recipient", "name", "Priya"),
      upsert("recipient", "relationship", "Sibling"),
      upsert("recipient", "interests", ["pottery", "hiking"]),
      upsert("budget", "max_minor", 500000),
    ]);
    expect(draft).not.toBeNull();
    expect(draft?.label).toBe("Priya");
    expect(draft?.kind).toBe("recipient");
    expect(draft?.data.relationship).toBe("Sibling");
    expect(draft?.data.interests).toEqual(["pottery", "hiking"]);
    expect(draft?.data.budget_minor).toBe(500000);
    // People you shop for are personal, and never cross lenses.
    expect(draft?.sensitivity).toBe("personal");
    expect(draft?.consentScope).toBe("lens_only");
  });

  it("refuses to invent a person from a relationship alone", () => {
    // "Sibling" is not a name; filing under it would let a second sibling
    // silently overwrite the first.
    const draft = personRecordFromUpserts("gift", [
      upsert("recipient", "relationship", "Sibling"),
      upsert("recipient", "interests", ["pottery"]),
    ]);
    expect(draft).toBeNull();
  });

  it("does not create an empty card for a bare name", () => {
    expect(
      personRecordFromUpserts("gift", [upsert("recipient", "name", "Priya")]),
    ).toBeNull();
  });

  it("only applies to the gift lens", () => {
    expect(
      personRecordFromUpserts("nutrition", [upsert("recipient", "name", "Priya")]),
    ).toBeNull();
  });

  it("merges additively so a new detail never erases an old one", () => {
    const merged = mergeRecordData(
      { interests: ["pottery"], relationship: "Sibling" },
      { interests: ["hiking"], sizes: ["UK 8"] },
    );
    expect(merged.interests).toEqual(["pottery", "hiking"]);
    expect(merged.relationship).toBe("Sibling");
    expect(merged.sizes).toEqual(["UK 8"]);
  });

  it("lets a corrected scalar win", () => {
    const merged = mergeRecordData({ relationship: "Friend" }, { relationship: "Sibling" });
    expect(merged.relationship).toBe("Sibling");
  });

  it("promotes a scalar to a list when a second value arrives", () => {
    const merged = mergeRecordData({ interests: "pottery" }, { interests: ["hiking"] });
    expect(merged.interests).toEqual(["pottery", "hiking"]);
  });
});
