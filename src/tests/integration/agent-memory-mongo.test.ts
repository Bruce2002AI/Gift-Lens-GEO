import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { newSession } from "@/lib/agent/ledger";
import type { AgentSession, LedgerFact } from "@/lib/agent/types";

/**
 * Deterministic, LLM-free proof of the whole agent-memory turn flow against a
 * real database: resolve the active subject from the shopper's words → switch →
 * persist under the right person → the backstop → cross-session recall. This is
 * the closest thing to a live conversation smoke without invoking the model.
 *
 *   RUN_DB_SMOKE=1 npx vitest run src/tests/integration/agent-memory-mongo.test.ts
 */

function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

const ENABLED = Boolean(process.env.RUN_DB_SMOKE && process.env.MONGODB_URI);
const DB_TIMEOUT = 30_000;
const USER = `test-agentmem-${Date.now()}`;

/** Simulate the loop recording a fact the shopper stated this turn. */
function say(session: AgentSession, key: string, value: string): void {
  const f: LedgerFact = {
    id: `f${session.ledger.facts.length + 1}`,
    key,
    value,
    provenance: "said",
    quote: value,
    turn: 1,
    lens: session.lens,
  };
  session.ledger.facts.push(f);
}

describe.runIf(ENABLED)("agent memory turn flow (real MongoDB)", () => {
  afterAll(async () => {
    const { deleteAllPersonalization } = await import("@/lib/personalization/repository");
    await deleteAllPersonalization(USER);
  });

  it("names a recipient from the message, persists under them, and keeps two people isolated", async () => {
    const { resolveActiveSubject, persistSessionMemory } = await import(
      "@/lib/personalization/agent-memory"
    );
    const { factsForLens, listFacts } = await import("@/lib/personalization/repository");

    const session = newSession("sess-aaaa-bbbb", "gift");

    // Turn 1: "a gift for my dad Rajesh, he loves cricket".
    const r1 = await resolveActiveSubject(session, USER, "a gift for my dad Rajesh", null);
    expect(r1?.active.subjectId).toBe("rajesh");
    expect(r1?.created).toBe(true);
    expect(session.activeSubjectId).toBe("rajesh");
    say(session, "recipient.name", "Rajesh");
    say(session, "recipient.interests", "cricket");
    await persistSessionMemory(session, USER);

    // Turn 2: switch to a second person — the ledger resets, no bleed.
    const r2 = await resolveActiveSubject(session, USER, "actually for my sister Priya", null);
    expect(r2?.active.subjectId).toBe("priya");
    expect(session.ledger.facts).toEqual([]); // switch cleared Rajesh's working set
    say(session, "recipient.name", "Priya");
    say(session, "recipient.interests", "pottery");
    await persistSessionMemory(session, USER);

    // Each person kept their own interests; neither leaked into the other.
    const rajesh = await factsForLens(USER, "gift", "rajesh");
    const priya = await factsForLens(USER, "gift", "priya");
    const rv = rajesh.map((f) => JSON.stringify(f.value));
    const pv = priya.map((f) => JSON.stringify(f.value));
    expect(rv).toContain(JSON.stringify(["cricket"]));
    expect(rv).not.toContain(JSON.stringify(["pottery"]));
    expect(pv).toContain(JSON.stringify(["pottery"]));
    expect(pv).not.toContain(JSON.stringify(["cricket"]));

    // Nothing about a named person leaked onto the owner's own profile.
    const ownGift = (await listFacts(USER, "self")).filter((f) => f.lens === "gift");
    expect(ownGift).toEqual([]);
  }, DB_TIMEOUT);

  it("backstop: a name that surfaces mid-turn (owner active) files facts under that person", async () => {
    const { persistSessionMemory } = await import("@/lib/personalization/agent-memory");
    const { factsForLens, listFacts } = await import("@/lib/personalization/repository");

    // Owner is active; the detector never ran, but the turn names a recipient.
    const session = newSession("sess-cccc-dddd", "gift");
    expect(session.activeSubjectId).toBe("self");
    say(session, "recipient.name", "Meera");
    say(session, "recipient.interests", "gardening");

    const { switchedTo } = await persistSessionMemory(session, USER);
    expect(switchedTo?.subjectId).toBe("meera");
    expect(switchedTo?.created).toBe(true);
    expect(session.activeSubjectId).toBe("meera"); // session moved to them

    const meera = await factsForLens(USER, "gift", "meera");
    expect(meera.map((f) => JSON.stringify(f.value))).toContain(JSON.stringify(["gardening"]));
    // The recipient facts did NOT land on the owner.
    const ownGift = (await listFacts(USER, "self")).filter((f) => f.lens === "gift");
    expect(ownGift).toEqual([]);
  }, DB_TIMEOUT);

  it("recalls a person's profile in a brand-new session (cross-session memory)", async () => {
    const { resolveActiveSubject, hydrateSessionMemory } = await import(
      "@/lib/personalization/agent-memory"
    );

    const session = newSession("sess-eeee-ffff", "gift");
    // A fresh session naming Rajesh again should switch to the SAME profile...
    const r = await resolveActiveSubject(session, USER, "another gift for Rajesh", null);
    expect(r?.active.subjectId).toBe("rajesh");
    expect(r?.created).toBe(false); // not re-created — recognized

    // ...and hydration loads his remembered interests into the ledger.
    await hydrateSessionMemory(session, USER);
    const keys = session.ledger.facts.map((f) => `${f.key}=${f.value}`);
    expect(keys.some((k) => k.startsWith("recipient.interests") && k.includes("cricket"))).toBe(true);
  }, DB_TIMEOUT);
});
