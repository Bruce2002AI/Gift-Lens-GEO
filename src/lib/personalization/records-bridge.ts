import type { FactUpsert, FactValue, ProfileLens, RecordKind } from "./types";

/**
 * Turn what the agent learned about a PERSON into a durable person-record.
 *
 * Lens-level fields describe the shopper ("my budget", "my sizes"). But a gift
 * conversation is about somebody else, and the interesting facts —
 * relationship, interests, sizes, key date — belong to that person, not to the
 * account. Left as lens fields they collide: shopping for a sister on Monday
 * and a manager on Friday would overwrite each other, and the agent would
 * cheerfully suggest hiking gear for the manager.
 *
 * So when a conversation names someone, we mirror the recipient.* facts into a
 * `recipient` record keyed by that name. The lens fields stay as the working
 * set for the CURRENT conversation; the record is the long-term memory of that
 * person, editable in the Personalization Center.
 *
 * Deterministic and free: it reads facts the agent already wrote, and makes no
 * extra model call.
 */

/** recipient.* keys worth carrying onto a person's record. */
const PERSON_KEYS = [
  "relationship",
  "interests",
  "dislikes",
  "sizes",
  "colors",
  "brands",
] as const;

/** Lens-field keys that map onto a record attribute under a different name. */
const EXTRA_KEY_MAP: Record<string, string> = {
  "occasion.deadline": "important_date",
  "history.past": "past_gifts",
  "budget.max_minor": "budget_minor",
};

export interface PersonRecordDraft {
  kind: RecordKind;
  label: string;
  data: Record<string, FactValue>;
  sensitivity: "standard" | "personal" | "health";
  consentScope: "lens_only" | "approved_cross_lens";
}

/**
 * Build a person-record from this turn's upserts, or null when no one was
 * named. Only the gift lens has recipients, so other lenses short-circuit.
 */
export function personRecordFromUpserts(
  lens: ProfileLens,
  upserts: FactUpsert[],
): PersonRecordDraft | null {
  if (lens !== "gift") return null;

  const byKey = new Map<string, FactValue>();
  for (const u of upserts) {
    if (u.lens !== "gift") continue;
    byKey.set(`${u.category}.${u.key}`, u.value);
  }

  const rawName = byKey.get("recipient.name");
  const label = typeof rawName === "string" ? rawName.trim() : "";
  // No name means no person to file this under. We do NOT invent one from the
  // relationship ("Sibling" is not a person), because a second sibling would
  // then silently overwrite the first.
  if (!label || label.length > 120) return null;

  const data: Record<string, FactValue> = {};
  for (const key of PERSON_KEYS) {
    const v = byKey.get(`recipient.${key}`);
    if (v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) {
      data[key] = v;
    }
  }
  for (const [lensKey, recordKey] of Object.entries(EXTRA_KEY_MAP)) {
    const v = byKey.get(lensKey);
    if (v !== undefined && v !== "") data[recordKey] = v;
  }

  // A bare name with nothing attached isn't worth a record yet; it would just
  // be an empty card the shopper has to tidy up.
  if (Object.keys(data).length === 0) return null;

  return {
    kind: "recipient",
    label,
    data,
    // People you shop for are personal data, and never cross lenses.
    sensitivity: "personal",
    consentScope: "lens_only",
  };
}

/**
 * Merge a draft into an existing record's data.
 *
 * Additive on purpose: learning "she also likes hiking" must not erase
 * "pottery" recorded last month. List values union; scalars take the newer
 * value, since a corrected size should win.
 */
export function mergeRecordData(
  existing: Record<string, FactValue>,
  incoming: Record<string, FactValue>,
): Record<string, FactValue> {
  const out: Record<string, FactValue> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const prior = out[key];
    if (Array.isArray(prior) || Array.isArray(value)) {
      const a = Array.isArray(prior) ? prior : prior != null ? [String(prior)] : [];
      const b = Array.isArray(value) ? value : [String(value)];
      out[key] = [...new Set([...a, ...b])];
    } else {
      out[key] = value;
    }
  }
  return out;
}
