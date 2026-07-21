import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Real-MongoDB proof of the cross-SUBJECT isolation invariants — the ones that
 * cannot be unit-tested because they live in the query layer and the unique
 * index. Skipped by default so `npm test` stays offline; run explicitly with a
 * reachable database:
 *
 *   RUN_DB_SMOKE=1 npx vitest run src/tests/integration/subjects-mongo.test.ts
 */

function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnvLocal();

const ENABLED = Boolean(process.env.RUN_DB_SMOKE && process.env.MONGODB_URI);

// Each test makes several sequential round-trips to a remote cluster; the 5s
// default is too tight for Atlas from a dev machine.
const DB_TIMEOUT = 30_000;

// A throwaway account, cleaned up afterwards.
const USER = `test-subjects-${Date.now()}`;

function giftInterest(subjectId: string, value: string[]) {
  return {
    subjectId,
    lens: "gift" as const,
    category: "recipient",
    key: "interests",
    value,
    source: "explicit" as const,
    confidence: 1,
    sensitivity: "standard" as const,
    consentScope: "lens_only" as const,
    quote: null,
  };
}

describe.runIf(ENABLED)("subjects isolation (real MongoDB)", () => {
  afterAll(async () => {
    const { deleteAllPersonalization } = await import("@/lib/personalization/repository");
    await deleteAllPersonalization(USER);
  });

  it("keeps each person's facts and the owner's shared facts correctly scoped", async () => {
    const { resolveOrCreateSubject, listSubjects } = await import(
      "@/lib/personalization/subjects"
    );
    const { upsertFacts, factsForLens, listFacts } = await import(
      "@/lib/personalization/repository"
    );

    // Two people + the owner.
    const rajesh = await resolveOrCreateSubject(USER, { name: "Rajesh", relationship: "dad", createdBy: "agent" });
    const priya = await resolveOrCreateSubject(USER, { name: "Priya", relationship: "sister", createdBy: "user" });
    expect(rajesh?.subject.subjectId).toBe("rajesh");
    expect(priya?.subject.subjectId).toBe("priya");

    const subjects = await listSubjects(USER);
    expect(subjects[0].subjectId).toBe("self");
    expect(subjects.map((s) => s.subjectId).sort()).toEqual(["priya", "rajesh", "self"]);

    // Facts land under the intended subject; two people hold the SAME key.
    await upsertFacts(USER, [
      giftInterest("rajesh", ["cricket"]),
      giftInterest("priya", ["pottery"]),
      // Owner-level shared facts.
      {
        subjectId: "self", lens: "shared", category: "budget", key: "currency", value: "INR",
        source: "explicit", confidence: 1, sensitivity: "standard", consentScope: "approved_cross_lens", quote: null,
      },
    ]);

    const rajeshOwn = await listFacts(USER, "rajesh");
    const priyaOwn = await listFacts(USER, "priya");
    expect(rajeshOwn.map((f) => f.value)).toEqual([["cricket"]]);
    expect(priyaOwn.map((f) => f.value)).toEqual([["pottery"]]);

    // Agent hydration for a person = their facts PLUS the owner's shared profile.
    const rajeshGift = await factsForLens(USER, "gift", "rajesh");
    const values = rajeshGift.map((f) => JSON.stringify(f.value));
    expect(values).toContain(JSON.stringify(["cricket"]));
    expect(values).toContain(JSON.stringify("INR")); // owner shared currency reaches the person
    expect(values).not.toContain(JSON.stringify(["pottery"])); // Priya never leaks in
  }, DB_TIMEOUT);

  it("re-stating a fact updates in place (no duplicate) even across subjects", async () => {
    const { upsertFacts, listFacts } = await import("@/lib/personalization/repository");
    await upsertFacts(USER, [giftInterest("rajesh", ["cricket", "chess"])]);
    await upsertFacts(USER, [giftInterest("rajesh", ["cricket", "chess"])]);
    const rajesh = await listFacts(USER, "rajesh");
    const interests = rajesh.filter((f) => f.category === "recipient" && f.key === "interests");
    expect(interests.length).toBe(1);
    expect(interests[0].value).toEqual(["cricket", "chess"]);
  }, DB_TIMEOUT);

  it("scopes a deletion to one subject, never another person's health fact", async () => {
    const { upsertFacts, forgetFactByKey, listFacts } = await import(
      "@/lib/personalization/repository"
    );
    // A health allergy for each person, same (lens,category,key).
    await upsertFacts(USER, [
      {
        subjectId: "rajesh", lens: "nutrition", category: "allergies", key: "list", value: ["gluten"],
        source: "explicit", confidence: 1, sensitivity: "health", consentScope: "lens_only", quote: null,
      },
      {
        subjectId: "priya", lens: "nutrition", category: "allergies", key: "list", value: ["peanuts"],
        source: "explicit", confidence: 1, sensitivity: "health", consentScope: "lens_only", quote: null,
      },
    ]);
    // Delete Rajesh's allergy only.
    await forgetFactByKey(USER, "rajesh", "nutrition", "allergies", "list");
    const rajesh = await listFacts(USER, "rajesh");
    const priya = await listFacts(USER, "priya");
    expect(rajesh.some((f) => f.category === "allergies")).toBe(false);
    expect(priya.find((f) => f.category === "allergies")?.value).toEqual(["peanuts"]);
  }, DB_TIMEOUT);

  it("deleting a subject erases their facts and leaves everyone else intact", async () => {
    const { deleteSubject, getSubject } = await import("@/lib/personalization/subjects");
    const { listFacts } = await import("@/lib/personalization/repository");
    const ok = await deleteSubject(USER, "rajesh");
    expect(ok).toBe(true);
    expect(await getSubject(USER, "rajesh")).toBeNull();
    expect(await listFacts(USER, "rajesh")).toEqual([]);
    // Priya survives untouched.
    expect((await listFacts(USER, "priya")).length).toBeGreaterThan(0);
  }, DB_TIMEOUT);

  it("does not resurrect a deleted person from a labelKey-less recipient record", async () => {
    const { upsertRecord } = await import("@/lib/personalization/repository");
    const { listSubjects, deleteSubject } = await import("@/lib/personalization/subjects");

    // A record created through the public API carries NO labelKey (finding 10).
    await upsertRecord(USER, {
      kind: "recipient",
      label: "Meera",
      data: { relationship: "friend", interests: ["books"] },
      sensitivity: "personal",
      consentScope: "lens_only",
    });
    // The migration promotes it to a subject.
    let subjects = await listSubjects(USER);
    expect(subjects.some((s) => s.subjectId === "meera")).toBe(true);

    // Deleting the subject must also remove the record, or it re-migrates back.
    expect(await deleteSubject(USER, "meera")).toBe(true);
    subjects = await listSubjects(USER);
    expect(subjects.some((s) => s.subjectId === "meera")).toBe(false);
  }, DB_TIMEOUT);

  it("refuses to delete the owner", async () => {
    const { deleteSubject } = await import("@/lib/personalization/subjects");
    expect(await deleteSubject(USER, "self")).toBe(false);
  }, DB_TIMEOUT);
});
