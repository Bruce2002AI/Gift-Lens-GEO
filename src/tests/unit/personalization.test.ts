import { describe, expect, it } from "vitest";
import {
  factIsLive,
  factVisibleToLens,
  formatFactValue,
  needsConfirmation,
  type ProfileFact,
} from "@/lib/personalization/types";
import {
  classifySensitivity,
  constraintsFromFacts,
  constraintsToUpserts,
  factsToLedgerFacts,
  humanizeKey,
  hydrateLedger,
  joinLedgerKey,
  ledgerFactsToUpserts,
  personalizationSignals,
  splitLedgerKey,
} from "@/lib/personalization/ledger-bridge";
import {
  PROFILE_FIELDS,
  completionForLens,
  fieldCatalogForPrompt,
  fieldsForLens,
  resolveFieldForKey,
} from "@/lib/personalization/schema";
import type { LedgerConstraints, SessionLedger } from "@/lib/agent/types";

function fact(overrides: Partial<ProfileFact> = {}): ProfileFact {
  return {
    id: "f1",
    userId: "u1",
    subjectId: "self",
    lens: "gift",
    category: "recipient",
    key: "loves",
    value: "coffee",
    source: "explicit",
    confidence: 1,
    sensitivity: "standard",
    consentScope: "lens_only",
    quote: null,
    lastConfirmedAt: null,
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function emptyConstraints(): LedgerConstraints {
  return {
    budgetMaxMinor: null,
    budgetMinMinor: null,
    currency: "INR",
    country: null,
    postalCode: null,
    deadline: null,
    exclusions: [],
  };
}

function emptyLedger(): SessionLedger {
  return {
    facts: [],
    constraints: emptyConstraints(),
    careFlags: [],
    consents: [],
    askedQuestions: [],
    searchQueries: [],
  };
}

describe("consent + visibility rules", () => {
  it("a fact always informs its own lens", () => {
    expect(factVisibleToLens(fact({ lens: "gift" }), "gift")).toBe(true);
  });

  it("shared facts inform every lens", () => {
    expect(factVisibleToLens(fact({ lens: "shared" }), "nutrition")).toBe(true);
    expect(factVisibleToLens(fact({ lens: "shared" }), "style")).toBe(true);
  });

  it("does NOT leak one lens's facts into another by default", () => {
    expect(factVisibleToLens(fact({ lens: "gift" }), "nutrition")).toBe(false);
  });

  it("crosses lenses only after an explicit opt-in", () => {
    const opted = fact({ lens: "gift", consentScope: "approved_cross_lens" });
    expect(factVisibleToLens(opted, "style")).toBe(true);
  });

  it("NEVER lets health data cross lenses, even when opted in", () => {
    const health = fact({
      lens: "skincare",
      sensitivity: "health",
      consentScope: "approved_cross_lens",
    });
    expect(factVisibleToLens(health, "skincare")).toBe(true);
    expect(factVisibleToLens(health, "nutrition")).toBe(false);
    expect(factVisibleToLens(health, "gift")).toBe(false);
  });

  it("keeps shared health data out of other lenses unless opted in", () => {
    const lensOnly = fact({ lens: "shared", sensitivity: "health" });
    expect(factVisibleToLens(lensOnly, "gift")).toBe(false);

    const opted = fact({
      lens: "shared",
      sensitivity: "health",
      consentScope: "approved_cross_lens",
    });
    expect(factVisibleToLens(opted, "gift")).toBe(true);
  });
});

describe("fact lifecycle", () => {
  it("treats expired facts as absent", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    expect(factIsLive(fact({ expiresAt: "2026-05-01T00:00:00.000Z" }), now)).toBe(false);
    expect(factIsLive(fact({ expiresAt: "2026-07-01T00:00:00.000Z" }), now)).toBe(true);
    expect(factIsLive(fact({ expiresAt: null }), now)).toBe(true);
  });

  it("asks for confirmation on inferred/low-confidence facts only", () => {
    expect(needsConfirmation(fact({ source: "inferred" }))).toBe(true);
    expect(needsConfirmation(fact({ source: "behavioral" }))).toBe(true);
    expect(needsConfirmation(fact({ source: "explicit", confidence: 0.5 }))).toBe(true);
    expect(needsConfirmation(fact({ source: "explicit", confidence: 1 }))).toBe(false);
    // Once confirmed, we stop asking.
    expect(
      needsConfirmation(
        fact({ source: "inferred", lastConfirmedAt: "2026-01-02T00:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("formats values without leaking JSON syntax", () => {
    expect(formatFactValue(["a", "b"])).toBe("a, b");
    expect(formatFactValue(true)).toBe("Yes");
    expect(formatFactValue(42)).toBe("42");
  });
});

describe("sensitivity classification", () => {
  it("flags medical vocabulary as health regardless of lens", () => {
    expect(classifySensitivity("allergies", "list", "gift")).toBe("health");
    expect(classifySensitivity("medication", "current", "style")).toBe("health");
    expect(classifySensitivity("supplement", "stack", "nutrition")).toBe("health");
  });

  it("treats skin/diet/body context in health lenses as health", () => {
    expect(classifySensitivity("skin", "type", "skincare")).toBe("health");
    expect(classifySensitivity("diet", "pattern", "nutrition")).toBe("health");
  });

  it("marks measurements and dates personal, not health", () => {
    expect(classifySensitivity("measurements", "waist", "style")).toBe("personal");
    expect(classifySensitivity("important_dates", "anniversary", "gift")).toBe("personal");
  });

  it("leaves ordinary preferences standard", () => {
    expect(classifySensitivity("colors", "liked", "style")).toBe("standard");
  });
});

describe("ledger key mapping", () => {
  it("round-trips category/key", () => {
    expect(splitLedgerKey("recipient.loves")).toEqual({
      category: "recipient",
      key: "loves",
    });
    expect(joinLedgerKey("recipient", "loves")).toBe("recipient.loves");
  });

  it("handles malformed keys without throwing", () => {
    expect(splitLedgerKey("bare")).toEqual({ category: "general", key: "bare" });
    expect(splitLedgerKey("")).toEqual({ category: "general", key: "note" });
    expect(splitLedgerKey("trailing.")).toEqual({
      category: "general",
      key: "trailing.",
    });
  });

  it("flattens deep keys into one category + key", () => {
    expect(splitLedgerKey("a.b.c")).toEqual({ category: "a", key: "b_c" });
  });

  it("humanizes keys for display", () => {
    expect(humanizeKey("recipient", "loves")).toBe("Recipient loves");
    expect(humanizeKey("skin", "concern_type")).toBe("Skin concern type");
  });
});

describe("profile → ledger hydration", () => {
  it("maps stored facts onto ledger facts marked as pre-existing (turn 0)", () => {
    const out = factsToLedgerFacts([
      fact({ category: "recipient", key: "loves", value: "coffee" }),
      fact({ id: "f2", source: "inferred", category: "style", key: "fit", value: "relaxed" }),
    ]);
    expect(out[0]).toMatchObject({
      key: "recipient.loves",
      value: "coffee",
      provenance: "said",
      turn: 0,
    });
    // Stored inferences stay hedged so they remain correctable.
    expect(out[1].provenance).toBe("inferred");
  });

  it("does not surface budget/currency/country as raw display facts", () => {
    // These are restored via constraintsFromFacts and shown, formatted, in the
    // Constraints strip — emitting them as facts too would show the bare minor
    // amount ("500000") next to the formatted "up to ₹5,000.00".
    const out = factsToLedgerFacts([
      fact({ lens: "shared", category: "budget", key: "max_minor", value: 500000 }),
      fact({ id: "f2", lens: "shared", category: "budget", key: "currency", value: "INR" }),
      fact({ id: "f3", lens: "shared", category: "profile", key: "country", value: "IN" }),
      fact({ id: "f4", category: "recipient", key: "loves", value: "coffee" }),
    ]);
    expect(out.map((f) => f.key)).toEqual(["recipient.loves"]);
  });

  it("does not let memory overwrite something said this session", () => {
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "s1",
      key: "recipient.loves",
      value: "tea",
      provenance: "said",
      quote: "she loves tea",
      turn: 2,
    });
    hydrateLedger(ledger, [fact({ value: "coffee" })]);

    const forKey = ledger.facts.filter((f) => f.key === "recipient.loves");
    expect(forKey).toHaveLength(1);
    expect(forKey[0].value).toBe("tea");
  });

  it("restores budget, currency and country from the shared profile", () => {
    const facts = [
      fact({ lens: "shared", category: "budget", key: "max_minor", value: 500000 }),
      fact({ lens: "shared", category: "budget", key: "currency", value: "USD" }),
      fact({ lens: "shared", category: "profile", key: "country", value: "IN" }),
    ];
    const c = constraintsFromFacts(facts, emptyConstraints());
    expect(c.budgetMaxMinor).toBe(500000);
    expect(c.currency).toBe("USD");
    expect(c.country).toBe("IN");
  });

  it("never overrides a constraint the shopper set this session", () => {
    const base = { ...emptyConstraints(), budgetMaxMinor: 100000, country: "GB" };
    const c = constraintsFromFacts(
      [
        fact({ lens: "shared", category: "budget", key: "max_minor", value: 999999 }),
        fact({ lens: "shared", category: "profile", key: "country", value: "IN" }),
      ],
      base,
    );
    expect(c.budgetMaxMinor).toBe(100000);
    expect(c.country).toBe("GB");
  });
});

describe("ledger → profile persistence", () => {
  it("persists facts learned this session, lens-local by default", () => {
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "s1",
      key: "recipient.loves",
      value: "coffee",
      provenance: "said",
      quote: "he loves coffee",
      turn: 1,
    });
    const [up] = ledgerFactsToUpserts(ledger, "gift");
    expect(up).toMatchObject({
      lens: "gift",
      category: "recipient",
      // "recipient.loves" is a declared alias of the canonical form field
      // "recipient.interests", so the answer lands in the control the shopper
      // can actually see and edit rather than as an orphan row. That field is
      // a tag list, so the value is coerced to an array on the way in.
      key: "interests",
      value: ["coffee"],
      source: "explicit",
      confidence: 1,
      consentScope: "lens_only",
      quote: "he loves coffee",
    });
  });

  it("routes the model's alias slug to the canonical field on persist", () => {
    // The delete path must resolve identically (see the deletion-scoping fix):
    // "recipient.loves" is stored as "recipient.interests".
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "s1",
      key: "recipient.loves",
      value: "coffee",
      provenance: "said",
      quote: null,
      turn: 1,
      lens: "gift",
    });
    const [up] = ledgerFactsToUpserts(ledger, "gift");
    expect(up.category).toBe("recipient");
    expect(up.key).toBe("interests");
  });

  it("does not re-persist facts that came from memory (turn 0)", () => {
    const ledger = emptyLedger();
    hydrateLedger(ledger, [fact()]);
    expect(ledgerFactsToUpserts(ledger, "gift")).toHaveLength(0);
  });

  it("refuses to harden throwaway assumptions into long-term memory", () => {
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "s1",
      key: "recipient.age",
      value: "30s",
      provenance: "assumed",
      quote: null,
      turn: 1,
    });
    expect(ledgerFactsToUpserts(ledger, "gift")).toHaveLength(0);
  });

  it("auto-classifies health facts and keeps them lens-only", () => {
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "s1",
      key: "allergies.list",
      value: "peanuts",
      provenance: "said",
      quote: "I'm allergic to peanuts",
      turn: 1,
    });
    const [up] = ledgerFactsToUpserts(ledger, "nutrition");
    expect(up.sensitivity).toBe("health");
    expect(up.consentScope).toBe("lens_only");
  });

  it("dedupes repeated keys and skips empty values", () => {
    const ledger = emptyLedger();
    ledger.facts.push(
      { id: "a", key: "recipient.loves", value: "coffee", provenance: "said", quote: null, turn: 1 },
      { id: "b", key: "recipient.loves", value: "tea", provenance: "said", quote: null, turn: 2 },
      { id: "c", key: "recipient.hates", value: "   ", provenance: "said", quote: null, turn: 2 },
    );
    const ups = ledgerFactsToUpserts(ledger, "gift");
    expect(ups).toHaveLength(1);
    // Coerced to the tag field's array shape.
    expect(ups[0].value).toEqual(["coffee"]);
  });

  it("stores budget/country as shared, cross-lens-approved facts", () => {
    const ups = constraintsToUpserts({
      ...emptyConstraints(),
      budgetMaxMinor: 300000,
      country: "IN",
    });
    expect(ups.every((u) => u.lens === "shared")).toBe(true);
    expect(ups.every((u) => u.consentScope === "approved_cross_lens")).toBe(true);
    expect(ups.map((u) => u.key)).toContain("max_minor");
    expect(ups.map((u) => u.key)).toContain("country");
  });

  /**
   * Regression: `currency` is seeded with a default and is never null, so an
   * unguarded write stored a currency the shopper never chose as an "explicit"
   * cross-lens fact on the very first turn.
   */
  it("does not persist the default currency when no budget was stated", () => {
    const none = constraintsToUpserts(emptyConstraints());
    expect(none.map((u) => u.key)).not.toContain("currency");

    const withBudget = constraintsToUpserts({
      ...emptyConstraints(),
      budgetMaxMinor: 300000,
    });
    expect(withBudget.map((u) => u.key)).toContain("currency");
  });

  /**
   * Regression: a session can switch lenses mid-chat. Facts must be filed under
   * the lens they were LEARNED under, or a switch re-files the whole
   * accumulated ledger — e.g. gift recipient details landing in skincare.
   */
  it("files each fact under the lens it was learned under, not the active one", () => {
    const ledger = emptyLedger();
    ledger.facts.push(
      {
        id: "a",
        key: "recipient.loves",
        value: "coffee",
        provenance: "said",
        quote: null,
        turn: 1,
        lens: "gift",
      },
      {
        id: "b",
        key: "skin.concern",
        value: "dryness",
        provenance: "said",
        quote: null,
        turn: 3,
        lens: "skincare",
      },
    );
    // The session has since been retargeted to skincare.
    const ups = ledgerFactsToUpserts(ledger, "skincare");
    const byKey = Object.fromEntries(ups.map((u) => [u.key, u.lens]));
    // "recipient.loves" resolves to the canonical gift field "interests".
    expect(byKey.interests).toBe("gift");
    // "skin.concern" matches no field, so it is stored verbatim under skincare.
    expect(byKey.concern).toBe("skincare");
  });

  it("falls back to the session lens for facts recorded without a lens tag", () => {
    const ledger = emptyLedger();
    ledger.facts.push({
      id: "a",
      key: "recipient.loves",
      value: "coffee",
      provenance: "said",
      quote: null,
      turn: 1,
    });
    expect(ledgerFactsToUpserts(ledger, "gift")[0].lens).toBe("gift");
  });

  it("keeps the same key in two lenses as two separate facts", () => {
    const ledger = emptyLedger();
    ledger.facts.push(
      {
        id: "a",
        key: "goals.primary",
        value: "brightening",
        provenance: "said",
        quote: null,
        turn: 1,
        lens: "skincare",
      },
      {
        id: "b",
        key: "goals.primary",
        value: "more protein",
        provenance: "said",
        quote: null,
        turn: 2,
        lens: "nutrition",
      },
    );
    const ups = ledgerFactsToUpserts(ledger, "nutrition");
    expect(ups).toHaveLength(2);
    expect(ups.map((u) => u.lens).sort()).toEqual(["nutrition", "skincare"]);
  });
});

describe("profile field schema (the self-filling form)", () => {
  it("covers every lens with fields, and every field explains why we ask", () => {
    for (const lens of ["shared", "gift", "skincare", "style", "nutrition"] as const) {
      const fields = fieldsForLens(lens);
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        expect(f.why.trim().length).toBeGreaterThan(10);
        expect(f.label.trim().length).toBeGreaterThan(0);
        // Option-driven controls must actually have options to render.
        if (f.control === "chips" || f.control === "multichips" || f.control === "choice") {
          expect(f.options?.length ?? 0).toBeGreaterThan(1);
        }
      }
    }
  });

  it("has unique field identities so nothing overwrites anything else", () => {
    const ids = PROFILE_FIELDS.map((f) => `${f.lens}.${f.category}.${f.key}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks medical fields as health so they are lens-locked by default", () => {
    const health = PROFILE_FIELDS.filter((f) => f.sensitivity === "health");
    const ids = health.map((f) => f.id);
    expect(ids).toContain("skincare.allergies.list");
    expect(ids).toContain("nutrition.allergies.list");
    expect(ids).toContain("skincare.medicines.current");
  });

  it("resolves the model's natural slugs onto real form fields", () => {
    expect(resolveFieldForKey("gift", "recipient.loves")?.key).toBe("interests");
    expect(resolveFieldForKey("gift", "recipient.hates")?.key).toBe("dislikes");
    expect(resolveFieldForKey("style", "colours.preferred")?.key).toBe("preferred");
    expect(resolveFieldForKey("nutrition", "diet.type")?.key).toBe("pattern");
    // Exact identities resolve too.
    expect(resolveFieldForKey("skincare", "skin.type")?.id).toBe("skincare.skin.type");
  });

  it("routes shared-scope keys to the shared profile from any lens", () => {
    const f = resolveFieldForKey("gift", "profile.country");
    expect(f?.lens).toBe("shared");
  });

  it("returns null for a slug that matches nothing (stored verbatim instead)", () => {
    expect(resolveFieldForKey("gift", "totally.unknown_thing")).toBeNull();
  });

  it("shrinks the prompt catalog as fields fill, and empties when complete", () => {
    const empty = fieldCatalogForPrompt("gift", new Set());
    expect(empty.length).toBeGreaterThan(0);

    const allKeys = new Set(
      [...fieldsForLens("gift"), ...fieldsForLens("shared")].map(
        (f) => `${f.category}.${f.key}`,
      ),
    );
    expect(fieldCatalogForPrompt("gift", allKeys)).toBe("");
  });

  it("caps the catalog so a blank profile cannot bloat the prompt", () => {
    const lines = fieldCatalogForPrompt("nutrition", new Set(), 5).split("\n");
    expect(lines).toHaveLength(5);
  });

  it("computes completion from the schema", () => {
    const fields = fieldsForLens("style");
    const half = new Set(
      fields.slice(0, Math.floor(fields.length / 2)).map((f) => `${f.category}.${f.key}`),
    );
    const c = completionForLens("style", half);
    expect(c.total).toBe(fields.length);
    expect(c.filled).toBe(half.size);
    expect(c.percent).toBeGreaterThan(30);
    expect(c.percent).toBeLessThan(70);
  });
});

describe("personalized-because signals", () => {
  it("leads with explicit, confident, recent facts", () => {
    const signals = personalizationSignals([
      fact({ id: "a", source: "inferred", confidence: 0.4, key: "guess" }),
      fact({ id: "b", source: "explicit", confidence: 1, key: "stated" }),
    ]);
    expect(signals[0].factId).toBe("b");
    expect(signals[0].needsConfirmation).toBe(false);
    expect(signals[1].needsConfirmation).toBe(true);
  });

  it("caps the strip so it stays compact", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      fact({ id: `f${i}`, key: `k${i}` }),
    );
    expect(personalizationSignals(many)).toHaveLength(4);
    expect(personalizationSignals(many, 2)).toHaveLength(2);
  });

  it("omits structural constraints (budget/currency/country) — they show in Constraints", () => {
    const signals = personalizationSignals([
      fact({ id: "a", category: "budget", key: "max_minor", value: 500000 }),
      fact({ id: "b", category: "budget", key: "currency", value: "INR" }),
      fact({ id: "c", category: "profile", key: "country", value: "IN" }),
      fact({ id: "d", category: "skin", key: "type", value: "oily" }),
    ]);
    expect(signals.map((s) => s.factId)).toEqual(["d"]);
  });
});
