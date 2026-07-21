import "server-only";

import {
  getProfileFacts,
  getProfileRecords,
  getProfileSubjects,
  type ProfileSubjectDoc,
} from "@/lib/db/mongo";
import { findField } from "./schema";
import { mergeRecordData } from "./records-bridge";
import { listRecords, upsertFacts } from "./repository";
import {
  SELF_SUBJECT_ID,
  selfSubject,
  subjectIdFromName,
  type FactUpsert,
  type FactValue,
  type ProfileSubject,
  type SubjectOrigin,
} from "./types";

/**
 * Subjects: the people a shopper's conversations are about.
 *
 * The account owner is the reserved, virtual subject `self` — never stored,
 * always present. Everyone else ("my dad Rajesh", "Priya") is a row here, and
 * their profile facts hang off their `subjectId`. This is what lets one shopper
 * keep a distinct, remembered profile per person without those profiles ever
 * bleeding into each other.
 *
 * Every read is scoped by `userId`; there is no path that returns another
 * shopper's subjects.
 */

function toSubject(doc: ProfileSubjectDoc): ProfileSubject {
  return {
    id: String(doc._id),
    userId: doc.userId,
    subjectId: doc.subjectId,
    kind: (doc.kind as ProfileSubject["kind"]) ?? "person",
    name: doc.name,
    relationship: doc.relationship ?? null,
    createdBy: (doc.createdBy as SubjectOrigin) ?? "agent",
    data: (doc.data ?? {}) as Record<string, FactValue>,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Recipient-record → subject migration (continuity for pre-subjects data)
// ---------------------------------------------------------------------------

/**
 * Reverse of the recipient-record bridge: a person-record's data keys mapped
 * back onto the gift-lens fields they were mirrored from, so a migrated subject
 * actually recalls their interests rather than being an empty shell.
 */
const RECORD_DATA_TO_FIELD: Record<string, { category: string; key: string }> = {
  relationship: { category: "recipient", key: "relationship" },
  interests: { category: "recipient", key: "interests" },
  dislikes: { category: "recipient", key: "dislikes" },
  sizes: { category: "recipient", key: "sizes" },
  colors: { category: "recipient", key: "colors" },
  brands: { category: "recipient", key: "brands" },
  important_date: { category: "occasion", key: "deadline" },
  budget_minor: { category: "budget", key: "max_minor" },
  past_gifts: { category: "history", key: "past" },
};

/** Build gift-lens fact upserts for a subject from a person-record's data blob. */
export function factsFromRecordData(
  subjectId: string,
  data: Record<string, FactValue>,
): FactUpsert[] {
  const out: FactUpsert[] = [];
  for (const [dataKey, value] of Object.entries(data)) {
    const target = RECORD_DATA_TO_FIELD[dataKey];
    if (!target) continue;
    if (value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const field = findField("gift", target.category, target.key);
    out.push({
      subjectId,
      lens: "gift",
      category: target.category,
      key: target.key,
      value,
      // Migrated from managed data, but shown correctable, never as gospel.
      source: "inferred",
      confidence: 0.7,
      sensitivity: field?.sensitivity ?? "standard",
      consentScope: "lens_only",
      quote: null,
    });
  }
  return out;
}

/**
 * Promote pre-existing recipient records into subjects, once, so nobody the
 * shopper already told us about vanishes when the switcher arrives. Idempotent:
 * a record whose name already has a subject is skipped, so facts are seeded
 * exactly once (on first creation).
 */
async function migrateRecipientRecords(
  userId: string,
  existing: Set<string>,
): Promise<ProfileSubject[]> {
  const records = await listRecords(userId, "recipient");
  const created: ProfileSubject[] = [];
  for (const rec of records) {
    const label = rec.label.trim();
    if (!label) continue;
    const subjectId = subjectIdFromName(label);
    if (subjectId === SELF_SUBJECT_ID || existing.has(subjectId)) continue;
    existing.add(subjectId);
    const relationship =
      typeof rec.data.relationship === "string" ? rec.data.relationship : null;
    const subject = await upsertSubject(userId, {
      subjectId,
      name: label,
      relationship,
      createdBy: "agent",
      data: rec.data,
    });
    if (subject) {
      created.push(subject);
      const seeds = factsFromRecordData(subjectId, rec.data);
      if (seeds.length > 0) {
        // Best-effort: a seeding failure must not block the switcher.
        await upsertFacts(userId, seeds).catch(() => []);
      }
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The named people a shopper has, newest-touched first (excludes `self`). */
export async function listPersonSubjects(userId: string): Promise<ProfileSubject[]> {
  const col = await getProfileSubjects();
  const docs = await col.find({ userId }).sort({ updatedAt: -1 }).limit(200).toArray();
  return docs.map(toSubject);
}

/**
 * Every subject the shopper can shop for: the account owner first, then their
 * named people. Runs the one-time recipient-record migration so historical
 * recipients surface here too.
 */
export async function listSubjects(userId: string): Promise<ProfileSubject[]> {
  const persons = await listPersonSubjects(userId);
  const known = new Set(persons.map((p) => p.subjectId));
  const migrated = await migrateRecipientRecords(userId, known).catch(() => []);
  const all = [...persons, ...migrated];
  // De-dupe defensively (a concurrent migration could double-insert a name).
  const bySlug = new Map<string, ProfileSubject>();
  for (const p of all) if (!bySlug.has(p.subjectId)) bySlug.set(p.subjectId, p);
  return [selfSubject(userId), ...bySlug.values()];
}

export async function getSubject(
  userId: string,
  subjectId: string,
): Promise<ProfileSubject | null> {
  if (subjectId === SELF_SUBJECT_ID) return selfSubject(userId);
  const col = await getProfileSubjects();
  const doc = await col.findOne({ userId, subjectId });
  return doc ? toSubject(doc) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create or update a person subject, keyed by their per-user slug. Atomic
 * upsert on the unique (userId, subjectId) index, so two overlapping turns that
 * name the same person can't mint two profiles. `data` merges additively so a
 * new interest never erases an old one; a supplied relationship wins.
 */
export async function upsertSubject(
  userId: string,
  input: {
    subjectId?: string;
    name: string;
    relationship?: string | null;
    createdBy: SubjectOrigin;
    data?: Record<string, FactValue>;
  },
): Promise<ProfileSubject | null> {
  const name = input.name.trim();
  if (!name) return null;
  const subjectId = input.subjectId ?? subjectIdFromName(name);
  if (subjectId === SELF_SUBJECT_ID) return null; // self is virtual, never stored.

  const col = await getProfileSubjects();
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const existing = await col.findOne({ userId, subjectId });
    const data = mergeRecordData(
      (existing?.data ?? {}) as Record<string, FactValue>,
      input.data ?? {},
    );
    const relationship =
      input.relationship?.trim() || existing?.relationship || null;
    try {
      const doc = await col.findOneAndUpdate(
        { userId, subjectId },
        {
          $set: {
            // Keep the first spelling of the name we recorded; the shopper can
            // rename explicitly, but an agent re-mention shouldn't reformat it.
            name: existing?.name ?? name,
            relationship,
            data,
            updatedAt: now,
          },
          $setOnInsert: {
            userId,
            subjectId,
            kind: "person",
            createdBy: input.createdBy,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      return doc ? toSubject(doc) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && attempt === 0) continue;
      throw err;
    }
  }
  return null;
}

/**
 * Find the subject a name refers to, or create one. Match is by slug, so
 * "rajesh" and "Rajesh" resolve to the same person. Returns the subject plus
 * whether it was freshly created (the UI announces new AI-made profiles).
 */
export async function resolveOrCreateSubject(
  userId: string,
  input: { name: string; relationship?: string | null; createdBy: SubjectOrigin },
): Promise<{ subject: ProfileSubject; created: boolean } | null> {
  const name = input.name.trim();
  if (!name) return null;
  const subjectId = subjectIdFromName(name);
  if (subjectId === SELF_SUBJECT_ID) return null;

  const existing = await getSubject(userId, subjectId);
  const subject = await upsertSubject(userId, {
    subjectId,
    name,
    relationship: input.relationship ?? null,
    createdBy: input.createdBy,
  });
  if (!subject) return null;
  return { subject, created: existing === null };
}

/**
 * Delete a person subject and everything we know about them: the subject row,
 * all their facts, and any recipient record that would otherwise re-migrate
 * them back into existence. Refuses to delete `self`. Returns success.
 */
export async function deleteSubject(userId: string, subjectId: string): Promise<boolean> {
  if (subjectId === SELF_SUBJECT_ID) return false;
  const [subjects, facts] = await Promise.all([getProfileSubjects(), getProfileFacts()]);

  await Promise.all([
    subjects.deleteOne({ userId, subjectId }),
    facts.deleteMany({ userId, subjectId }),
  ]);

  // Also remove any recipient record that would RE-MIGRATE into this subject on
  // the next listSubjects, or the deleted person comes straight back. Records
  // created through the public API carry no labelKey, so we can't match on it —
  // instead delete exactly the records whose label slugs to this subjectId,
  // computed the same way the migration decides the mapping.
  try {
    const records = await getProfileRecords();
    const recipientDocs = await records.find({ userId, kind: "recipient" }).toArray();
    const ids = recipientDocs
      .filter((r) => subjectIdFromName(String(r.label ?? "")) === subjectId)
      .map((r) => r._id)
      .filter((id): id is NonNullable<typeof id> => id != null);
    if (ids.length > 0) await records.deleteMany({ _id: { $in: ids } });
  } catch {
    // The person's own facts are already gone; a lingering record is cosmetic.
  }
  return true;
}
