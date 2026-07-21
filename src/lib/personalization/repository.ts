import "server-only";

import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import {
  getOutcomeEvents,
  getProfileFacts,
  getProfileRecords,
  getProfileSubjects,
  type OutcomeEventDoc,
  type ProfileFactDoc,
  type ProfileRecordDoc,
} from "@/lib/db/mongo";
import {
  RECORD_KIND_LENS,
  SELF_SUBJECT_ID,
  factIsLive,
  factVisibleToLens,
  type FactPatch,
  type FactUpsert,
  type FactValue,
  type Outcome,
  type OutcomeCreate,
  type OutcomeEvent,
  type ProfileFact,
  type ProfileLens,
  type ProfileRecord,
  type RecordKind,
  type RecordUpsert,
} from "./types";

/**
 * Persistence for the personalization profile.
 *
 * Every read is scoped by `userId` — there is no code path that returns another
 * shopper's facts. Consent/visibility rules live in `types.ts` as pure
 * functions and are applied here so the API, the UI and the agent can never
 * disagree about what a lens is allowed to see.
 */

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toFact(doc: ProfileFactDoc): ProfileFact {
  return {
    id: String(doc._id),
    userId: doc.userId,
    // Legacy docs predate subjects; they belong to the account owner.
    subjectId: doc.subjectId ?? SELF_SUBJECT_ID,
    lens: doc.lens as ProfileLens,
    category: doc.category,
    key: doc.key,
    value: doc.value as FactValue,
    source: doc.source as ProfileFact["source"],
    confidence: doc.confidence,
    sensitivity: doc.sensitivity as ProfileFact["sensitivity"],
    consentScope: doc.consentScope as ProfileFact["consentScope"],
    quote: doc.quote ?? null,
    lastConfirmedAt: doc.lastConfirmedAt ? doc.lastConfirmedAt.toISOString() : null,
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toRecord(doc: ProfileRecordDoc): ProfileRecord {
  return {
    id: String(doc._id),
    userId: doc.userId,
    lens: doc.lens as ProfileLens,
    kind: doc.kind as RecordKind,
    label: doc.label,
    data: (doc.data ?? {}) as Record<string, FactValue>,
    sensitivity: doc.sensitivity as ProfileRecord["sensitivity"],
    consentScope: doc.consentScope as ProfileRecord["consentScope"],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toOutcome(doc: OutcomeEventDoc): OutcomeEvent {
  return {
    id: String(doc._id),
    userId: doc.userId,
    lens: doc.lens as ProfileLens,
    productId: doc.productId,
    productTitle: doc.productTitle ?? null,
    outcome: doc.outcome as Outcome,
    note: doc.note ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Guard against a malformed id crashing a query. */
function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * Every live fact for one SUBJECT of a user, newest first. Defaults to the
 * account owner (`self`). Legacy facts were backfilled to `self`, so the scope
 * is exact even for data written before subjects existed.
 */
export async function listFacts(
  userId: string,
  subjectId: string = SELF_SUBJECT_ID,
  lens?: ProfileLens,
): Promise<ProfileFact[]> {
  const col = await getProfileFacts();
  // Legacy docs are backfilled to `self` on first DB access (see ensureIndexes),
  // and every write stamps a subjectId, so an exact match is complete.
  const query: Record<string, unknown> = { userId, subjectId };
  if (lens) query.lens = lens;
  const docs = await col.find(query).sort({ updatedAt: -1 }).limit(500).toArray();
  return docs.map(toFact).filter((f) => factIsLive(f));
}

/**
 * The facts a given lens may actually use for a subject — the single source of
 * truth for "what does the agent know about this person in this lens".
 *
 * Account-level SHARED facts (currency, country, general budget, the shopper's
 * own taste) live on the owner and apply to whoever they're shopping for, so a
 * person's view is their own facts PLUS the owner's shared profile. The
 * ledger-bridge dedupes any lens-vs-shared key collision, lens winning.
 */
export async function factsForLens(
  userId: string,
  lens: ProfileLens,
  subjectId: string = SELF_SUBJECT_ID,
): Promise<ProfileFact[]> {
  const own = (await listFacts(userId, subjectId)).filter((f) => factVisibleToLens(f, lens));
  if (subjectId === SELF_SUBJECT_ID) return own;
  const ownerShared = (await listFacts(userId, SELF_SUBJECT_ID, "shared")).filter((f) =>
    factVisibleToLens(f, lens),
  );
  return [...own, ...ownerShared];
}

/**
 * Create or replace a fact, keyed on (user, lens, category, key).
 *
 * Re-stating a fact you already hold should not silently downgrade it, so an
 * inferred re-write never overwrites an explicit answer — the shopper's own
 * words outrank the agent's guess.
 */
export async function upsertFact(
  userId: string,
  input: FactUpsert,
): Promise<ProfileFact | null> {
  const col = await getProfileFacts();
  const now = new Date();
  const subjectId = input.subjectId ?? SELF_SUBJECT_ID;
  const identity = {
    userId,
    subjectId,
    lens: input.lens,
    category: input.category,
    key: input.key,
  };

  const existing = await col.findOne(identity);
  if (
    existing &&
    existing.source === "explicit" &&
    input.source !== "explicit"
  ) {
    // Keep the shopper's stated value; don't let an inference clobber it.
    return toFact(existing);
  }

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  const doc = await col.findOneAndUpdate(
    identity,
    {
      $set: {
        value: input.value,
        source: input.source,
        confidence: input.confidence,
        sensitivity: input.sensitivity,
        consentScope: input.consentScope,
        quote: input.quote ?? null,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        updatedAt: now,
        // An explicit statement counts as a confirmation.
        ...(input.source === "explicit" ? { lastConfirmedAt: now } : {}),
      },
      $setOnInsert: {
        ...identity,
        createdAt: now,
        ...(input.source === "explicit" ? {} : { lastConfirmedAt: null }),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return doc ? toFact(doc) : null;
}

/**
 * Bulk upsert used by the agent bridge, in THREE round-trips regardless of
 * how many facts a turn produced.
 *
 * The naive per-fact loop was 2 sequential round-trips each (a read to protect
 * explicit answers, then a write); a six-fact turn spent ~6s on the response
 * path and blew the persistence deadline, so the live form update never fired.
 * Here we read all existing facts at once, decide locally, write once, and
 * read back once.
 */
export async function upsertFacts(
  userId: string,
  rawInputs: FactUpsert[],
): Promise<ProfileFact[]> {
  if (rawInputs.length === 0) return [];
  const col = await getProfileFacts();
  const now = new Date();

  // Collapse duplicate identities BEFORE the write. A single turn can produce
  // two writes for the same (lens,category,key) — e.g. a coerced ledger fact
  // and the authoritative budget constraint both landing on shared.budget.
  // In an unordered bulkWrite that is a nondeterministic last-wins race, so
  // resolve it here: an explicit value beats an inferred one; among equals the
  // later input wins (constraints are appended last, and are authoritative).
  const slugOf = (i: FactUpsert) =>
    `${i.subjectId ?? SELF_SUBJECT_ID}.${i.lens}.${i.category}.${i.key}`;
  const dedupedBySlug = new Map<string, FactUpsert>();
  for (const input of rawInputs) {
    const slug = slugOf(input);
    const prior = dedupedBySlug.get(slug);
    if (
      !prior ||
      (prior.source !== "explicit") // later wins unless it would demote explicit
    ) {
      if (prior?.source === "explicit" && input.source !== "explicit") continue;
      dedupedBySlug.set(slug, input);
    }
  }
  const inputs = [...dedupedBySlug.values()];

  const identities = inputs.map((i) => ({
    subjectId: i.subjectId ?? SELF_SUBJECT_ID,
    lens: i.lens,
    category: i.category,
    key: i.key,
  }));

  // 1. One read for every identity we're about to touch.
  const existing = await col.find({ userId, $or: identities }).toArray();
  const existingBySlug = new Map(
    existing.map((d) => [
      `${d.subjectId ?? SELF_SUBJECT_ID}.${d.lens}.${d.category}.${d.key}`,
      d,
    ]),
  );

  const ops: AnyBulkWriteOperation<ProfileFactDoc>[] = [];
  for (const input of inputs) {
    const slug = slugOf(input);
    const subjectId = input.subjectId ?? SELF_SUBJECT_ID;
    const prior = existingBySlug.get(slug);
    // The shopper's own words outrank the agent's guess: never let an
    // inferred write overwrite a value they stated explicitly.
    if (prior && prior.source === "explicit" && input.source !== "explicit") {
      continue;
    }
    const expires = input.expiresAt ? new Date(input.expiresAt) : null;
    ops.push({
      updateOne: {
        filter: {
          userId,
          subjectId,
          lens: input.lens,
          category: input.category,
          key: input.key,
        },
        update: {
          $set: {
            value: input.value,
            source: input.source,
            confidence: input.confidence,
            sensitivity: input.sensitivity,
            consentScope: input.consentScope,
            quote: input.quote ?? null,
            expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
            updatedAt: now,
            ...(input.source === "explicit" ? { lastConfirmedAt: now } : {}),
          },
          $setOnInsert: {
            userId,
            subjectId,
            lens: input.lens,
            category: input.category,
            key: input.key,
            createdAt: now,
            ...(input.source === "explicit" ? {} : { lastConfirmedAt: null }),
          },
        },
        upsert: true,
      },
    });
  }
  if (ops.length === 0) return [];

  // 2. One write for the whole batch. `ordered: false` so one bad op cannot
  //    abort the rest — the old loop's per-fact isolation, kept.
  await col.bulkWrite(ops, { ordered: false });

  // 3. One read back so callers get the canonical stored documents.
  const saved = await col.find({ userId, $or: identities }).toArray();
  return saved.map(toFact);
}

/**
 * Edit a fact the shopper owns. `confirm` promotes an inferred guess to a
 * confirmed, full-confidence fact — the "Confirm" action in the UI.
 */
export async function patchFact(
  userId: string,
  factId: string,
  patch: FactPatch,
): Promise<ProfileFact | null> {
  const _id = toObjectId(factId);
  if (!_id) return null;
  const col = await getProfileFacts();
  const now = new Date();

  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.value !== undefined) {
    set.value = patch.value;
    // Editing a value makes it the shopper's own statement.
    set.source = "explicit";
    set.confidence = 1;
    set.lastConfirmedAt = now;
  }
  if (patch.consentScope !== undefined) set.consentScope = patch.consentScope;
  if (patch.sensitivity !== undefined) set.sensitivity = patch.sensitivity;
  if (patch.confirm) {
    set.source = "explicit";
    set.confidence = 1;
    set.lastConfirmedAt = now;
  }

  // The userId in the filter is the authorization check.
  const doc = await col.findOneAndUpdate(
    { _id: _id, userId },
    { $set: set },
    { returnDocument: "after" },
  );
  return doc ? toFact(doc) : null;
}

/**
 * Forget a fact the shopper removed from the agent's understanding.
 *
 * Scoped to a single lens on purpose: the same (category, key) is a DIFFERENT
 * fact in different lenses — allergies.list is peanuts in nutrition and
 * fragrance in skincare — so deleting one must never touch the other. Returns
 * how many were removed (0 or 1 for a well-formed identity).
 */
export async function forgetFactByKey(
  userId: string,
  subjectId: string,
  lens: string,
  category: string,
  key: string,
): Promise<number> {
  const col = await getProfileFacts();
  const res = await col.deleteMany({ userId, subjectId, lens, category, key });
  return res.deletedCount;
}

export async function deleteFact(userId: string, factId: string): Promise<boolean> {
  const _id = toObjectId(factId);
  if (!_id) return false;
  const col = await getProfileFacts();
  const res = await col.deleteOne({
    _id: _id,
    userId,
  });
  return res.deletedCount > 0;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export async function listRecords(
  userId: string,
  kind?: RecordKind,
): Promise<ProfileRecord[]> {
  const col = await getProfileRecords();
  const query: Record<string, unknown> = { userId };
  if (kind) query.kind = kind;
  const docs = await col.find(query).sort({ updatedAt: -1 }).limit(300).toArray();
  return docs.map(toRecord);
}

/** Create a record, or update it in place when `recordId` is supplied. */
export async function upsertRecord(
  userId: string,
  input: RecordUpsert,
  recordId?: string | null,
): Promise<ProfileRecord | null> {
  const col = await getProfileRecords();
  const now = new Date();
  // The kind determines the owning lens — clients don't get to choose.
  const lens = RECORD_KIND_LENS[input.kind];

  if (recordId) {
    const _id = toObjectId(recordId);
    if (!_id) return null;
    const doc = await col.findOneAndUpdate(
      { _id: _id, userId },
      {
        $set: {
          kind: input.kind,
          lens,
          label: input.label,
          data: input.data,
          sensitivity: input.sensitivity,
          consentScope: input.consentScope,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    return doc ? toRecord(doc) : null;
  }

  const insert: ProfileRecordDoc = {
    userId,
    lens,
    kind: input.kind,
    label: input.label,
    data: input.data,
    sensitivity: input.sensitivity,
    consentScope: input.consentScope,
    createdAt: now,
    updatedAt: now,
  };
  const res = await col.insertOne(insert);
  return toRecord({ ...insert, _id: res.insertedId });
}

/**
 * Atomically create-or-merge an AGENT-authored record keyed by its normalized
 * label, so two overlapping turns that name the same person can't mint two
 * cards. The unique partial index on (userId, kind, labelKey) makes the insert
 * race-safe: a concurrent second upsert loses the insert and is retried once as
 * a merge onto the winner. `merge(existingData)` computes the new data from
 * whatever is currently stored, so additive merges never lose prior detail.
 */
export async function upsertRecordByLabel(
  userId: string,
  input: {
    kind: RecordKind;
    lens: ProfileLens;
    label: string;
    sensitivity: ProfileRecord["sensitivity"];
    consentScope: ProfileRecord["consentScope"];
  },
  merge: (existing: Record<string, FactValue>) => Record<string, FactValue>,
): Promise<ProfileRecord | null> {
  const col = await getProfileRecords();
  const labelKey = input.label.trim().toLowerCase();
  if (!labelKey) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const existing = await col.findOne({ userId, kind: input.kind, labelKey });
    const data = merge((existing?.data ?? {}) as Record<string, FactValue>);
    try {
      const doc = await col.findOneAndUpdate(
        { userId, kind: input.kind, labelKey },
        {
          $set: {
            lens: input.lens,
            label: existing?.label ?? input.label,
            labelKey,
            data,
            sensitivity: input.sensitivity,
            consentScope: input.consentScope,
            updatedAt: now,
          },
          $setOnInsert: { userId, kind: input.kind, createdAt: now },
        },
        { upsert: true, returnDocument: "after" },
      );
      return doc ? toRecord(doc) : null;
    } catch (err) {
      // A concurrent insert won the unique index; loop once to merge onto it.
      if ((err as { code?: number }).code === 11000 && attempt === 0) continue;
      throw err;
    }
  }
  return null;
}

export async function deleteRecord(userId: string, recordId: string): Promise<boolean> {
  const _id = toObjectId(recordId);
  if (!_id) return false;
  const col = await getProfileRecords();
  const res = await col.deleteOne({
    _id: _id,
    userId,
  });
  return res.deletedCount > 0;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export async function recordOutcome(
  userId: string,
  input: OutcomeCreate,
): Promise<OutcomeEvent> {
  const col = await getOutcomeEvents();
  const doc: OutcomeEventDoc = {
    userId,
    lens: input.lens,
    productId: input.productId,
    productTitle: input.productTitle ?? null,
    outcome: input.outcome,
    note: input.note ?? null,
    createdAt: new Date(),
  };
  const res = await col.insertOne(doc);
  return toOutcome({ ...doc, _id: res.insertedId });
}

export async function listOutcomes(
  userId: string,
  lens?: ProfileLens,
  limit = 100,
): Promise<OutcomeEvent[]> {
  const col = await getOutcomeEvents();
  const query: Record<string, unknown> = { userId };
  if (lens) query.lens = lens;
  const docs = await col
    .find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 300))
    .toArray();
  return docs.map(toOutcome);
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/** Erase everything we hold for a shopper. Backs the "Delete all" control. */
export async function deleteAllPersonalization(
  userId: string,
): Promise<{ facts: number; records: number; outcomes: number; subjects: number }> {
  const [facts, records, outcomes, subjects] = await Promise.all([
    getProfileFacts(),
    getProfileRecords(),
    getOutcomeEvents(),
    getProfileSubjects(),
  ]);
  const [f, r, o, s] = await Promise.all([
    facts.deleteMany({ userId }),
    records.deleteMany({ userId }),
    outcomes.deleteMany({ userId }),
    subjects.deleteMany({ userId }),
  ]);
  return {
    facts: f.deletedCount,
    records: r.deletedCount,
    outcomes: o.deletedCount,
    subjects: s.deletedCount,
  };
}
