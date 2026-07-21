import { describe, expect, it } from "vitest";
import { detectSubjectMention } from "@/lib/personalization/subject-detect";
import { factsFromRecordData } from "@/lib/personalization/subjects";
import { subjectIdFromName, selfSubject, SELF_SUBJECT_ID } from "@/lib/personalization/types";
import { newSession, switchSubject } from "@/lib/agent/ledger";
import type { CareFlag } from "@/lib/agent/types";

// ---------------------------------------------------------------------------
// subjectIdFromName — stable per-user slug
// ---------------------------------------------------------------------------

describe("subjectIdFromName", () => {
  it("slugs a name deterministically and case-insensitively", () => {
    expect(subjectIdFromName("Rajesh")).toBe("rajesh");
    expect(subjectIdFromName("  RAJESH ")).toBe("rajesh");
    expect(subjectIdFromName("Priya Sharma")).toBe("priya-sharma");
  });

  it("collapses punctuation and never yields an empty id", () => {
    expect(subjectIdFromName("D'Souza")).toBe("d-souza");
    expect(subjectIdFromName("!!!")).toBe("person");
    expect(subjectIdFromName("   ")).toBe("person");
  });

  it("keeps unicode letters", () => {
    expect(subjectIdFromName("Zoë")).toBe("zoë");
  });
});

describe("selfSubject", () => {
  it("is always the reserved owner id", () => {
    const s = selfSubject("u1");
    expect(s.subjectId).toBe(SELF_SUBJECT_ID);
    expect(s.kind).toBe("self");
    expect(s.name).toBe("You");
  });
});

// ---------------------------------------------------------------------------
// detectSubjectMention — reading who a message is about
// ---------------------------------------------------------------------------

describe("detectSubjectMention", () => {
  it("returns null when no one is referenced", () => {
    expect(detectSubjectMention("show me a warm scarf under 2000")).toBeNull();
    expect(detectSubjectMention("")).toBeNull();
  });

  it("catches an explicit self-reference", () => {
    expect(detectSubjectMention("a skincare routine for myself")).toEqual({ target: "self" });
    expect(detectSubjectMention("actually it's for me")).toEqual({ target: "self" });
    expect(detectSubjectMention("switch back to me")).toEqual({ target: "self" });
  });

  it("captures a relationship AND a capitalized name", () => {
    expect(detectSubjectMention("a gift for my dad Rajesh, he loves cricket")).toEqual({
      target: "person",
      name: "Rajesh",
      relationship: "dad",
    });
    expect(detectSubjectMention("my sister Anaya wants a new bag")).toEqual({
      target: "person",
      name: "Anaya",
      relationship: "sister",
    });
  });

  it("does NOT treat a verb after a relationship as a name", () => {
    // The classic false positive: "my mom needs …" must not create "Needs".
    expect(detectSubjectMention("my mom needs a present")).toEqual({
      target: "relationship",
      relationship: "mum",
    });
    expect(detectSubjectMention("my dad wants headphones")).toEqual({
      target: "relationship",
      relationship: "dad",
    });
  });

  it("catches a shopping-anchored name even in lowercase", () => {
    expect(detectSubjectMention("buy something for anaya")).toEqual({
      target: "person",
      name: "Anaya",
      relationship: null,
    });
    expect(detectSubjectMention("a gift for Priya")).toEqual({
      target: "person",
      name: "Priya",
      relationship: null,
    });
  });

  it("never mints a profile for an occasion or generic noun", () => {
    expect(detectSubjectMention("a gift for Christmas")).toBeNull();
    expect(detectSubjectMention("shopping for inspiration")).toBeNull();
    expect(detectSubjectMention("something nice for work")).toBeNull();
    expect(detectSubjectMention("looking for something under 5000")).toBeNull();
  });

  it("matches a known person named anywhere, without a cue", () => {
    expect(detectSubjectMention("what about priya?", ["Priya"])).toEqual({
      target: "person",
      name: "Priya",
      relationship: null,
    });
    // Unknown + no cue + lowercase → not a switch.
    expect(detectSubjectMention("what about priya?", [])).toBeNull();
  });

  it("reads a capitalized possessive but ignores time possessives", () => {
    expect(detectSubjectMention("Priya's skincare routine")).toEqual({
      target: "person",
      name: "Priya",
      relationship: null,
    });
    expect(detectSubjectMention("today's best deal")).toBeNull();
    expect(detectSubjectMention("this week's menu")).toBeNull();
  });

  it("falls back to a relationship when no name is given", () => {
    expect(detectSubjectMention("a gift for my sister")).toEqual({
      target: "relationship",
      relationship: "sister",
    });
    expect(detectSubjectMention("my best friend's birthday is coming")).toEqual({
      target: "relationship",
      relationship: "friend",
    });
  });

  it("lets a named relationship override a self-reference in the same message", () => {
    // "for me and my sister" is really about the sister here.
    expect(detectSubjectMention("something for me and my sister")).toEqual({
      target: "relationship",
      relationship: "sister",
    });
  });

  it("never mints a person from a contraction opener", () => {
    // The classic "What's" -> "What" possessive false positive and friends.
    expect(detectSubjectMention("What's the best gift for a teenager?")).toBeNull();
    expect(detectSubjectMention("Let's find something nice")).toBeNull();
    expect(detectSubjectMention("There's a sale — what do you recommend?")).toBeNull();
    expect(detectSubjectMention("He's into cycling, any ideas?")).toBeNull();
    expect(detectSubjectMention("Where's a good pick under 3000?")).toBeNull();
  });

  it("strips a trailing possessive from a captured name", () => {
    expect(detectSubjectMention("get something for my mom Sarah's birthday")).toEqual({
      target: "person",
      name: "Sarah",
      relationship: "mum",
    });
  });

  it("captures the name after a multi-word relationship", () => {
    expect(detectSubjectMention("buy a gift for my best friend Alex")).toEqual({
      target: "person",
      name: "Alex",
      relationship: "friend",
    });
    expect(detectSubjectMention("a present for my mother-in-law Susan")).toEqual({
      target: "person",
      name: "Susan",
      relationship: "mother-in-law",
    });
  });
});

// ---------------------------------------------------------------------------
// switchSubject — re-pointing a session
// ---------------------------------------------------------------------------

describe("switchSubject", () => {
  function seededSession() {
    const s = newSession("sess-1234-5678", "gift");
    s.ledger.facts.push({ id: "f1", key: "recipient.interests", value: "cricket", provenance: "said", quote: "cricket", turn: 1, lens: "gift" });
    s.ledger.constraints.budgetMaxMinor = 500000;
    s.ledger.constraints.deadline = "2026-03-01";
    s.ledger.constraints.exclusions = ["wool"];
    s.ledger.constraints.currency = "INR";
    s.ledger.constraints.country = "IN";
    const care: CareFlag = {
      kind: "pregnancy", label: "pregnancy", matchedText: "x", turn: 1, scopeFence: ["retinol"], lastCaredTurn: null,
    };
    s.ledger.careFlags.push(care);
    s.candidates.set("p1", "line");
    s.evidence.set("p1", {} as never);
    s.hydratedLenses.push("gift");
    return s;
  }

  it("clears the previous person's facts, budget and product caches", () => {
    const s = seededSession();
    const changed = switchSubject(s, "priya");
    expect(changed).toBe(true);
    expect(s.activeSubjectId).toBe("priya");
    expect(s.ledger.facts).toEqual([]);
    expect(s.ledger.constraints.budgetMaxMinor).toBeNull();
    expect(s.ledger.constraints.deadline).toBeNull();
    expect(s.ledger.constraints.exclusions).toEqual([]);
    expect(s.candidates.size).toBe(0);
    expect(s.evidence.size).toBe(0);
    expect(s.hydratedLenses).toEqual([]);
  });

  it("keeps account-level and safety context across the switch", () => {
    const s = seededSession();
    switchSubject(s, "priya");
    // Currency/country belong to the owner; care flags must never regress.
    expect(s.ledger.constraints.currency).toBe("INR");
    expect(s.ledger.constraints.country).toBe("IN");
    expect(s.ledger.careFlags.map((f) => f.kind)).toContain("pregnancy");
  });

  it("is a no-op when the subject is unchanged", () => {
    const s = seededSession();
    expect(switchSubject(s, SELF_SUBJECT_ID)).toBe(false);
    // Nothing cleared, since we never left self.
    expect(s.ledger.facts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// factsFromRecordData — recipient-record → subject migration mapping
// ---------------------------------------------------------------------------

describe("factsFromRecordData", () => {
  it("maps a record's data back onto gift-lens fields under the subject", () => {
    const upserts = factsFromRecordData("rajesh", {
      relationship: "dad",
      interests: ["cricket", "old Hindi music"],
      budget_minor: 2000000,
      important_date: "2026-03-01",
      notes: "ignore me",
    });
    const bySlug = new Map(upserts.map((u) => [`${u.category}.${u.key}`, u]));
    expect(bySlug.get("recipient.relationship")?.value).toBe("dad");
    expect(bySlug.get("recipient.interests")?.value).toEqual(["cricket", "old Hindi music"]);
    expect(bySlug.get("budget.max_minor")?.value).toBe(2000000);
    expect(bySlug.get("occasion.deadline")?.value).toBe("2026-03-01");
    // Everything lands under the named subject, never the owner.
    expect(upserts.every((u) => u.subjectId === "rajesh")).toBe(true);
    // "notes" has no field, so it is dropped rather than orphaned.
    expect(bySlug.has("general.notes")).toBe(false);
  });

  it("skips empty values", () => {
    const upserts = factsFromRecordData("x", { interests: [], relationship: "" });
    expect(upserts).toEqual([]);
  });
});
