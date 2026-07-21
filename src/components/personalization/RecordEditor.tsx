"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { FieldControl, isEmptyValue } from "./FieldControl";
import {
  RECORD_SCHEMAS,
  type ProfileField,
  type RecordFieldDef,
  type RecordKindDef,
} from "@/lib/personalization/schema";
import {
  RECORD_KIND_LENS,
  formatFactValue,
  type FactValue,
  type ProfileRecord,
  type RecordKind,
} from "@/lib/personalization/types";

/**
 * Full CRUD for one kind of structured record — the list-shaped things a single
 * key/value fact can't hold: the people you shop for, what's in your wardrobe,
 * the supplements you already take.
 *
 * Design note — the schema is the UI.
 * Nothing about "a recipient" or "a supplement" is hard-coded here. The whole
 * editor is generated from `RECORD_SCHEMAS[kind]`, so adding a record kind is a
 * data change in one file, not a new component. Each attribute is rendered by
 * the shared `FieldControl`, which means a chip list in this editor behaves
 * identically to a chip list in the Living Profile form.
 *
 * Design note — destructive actions are never one click.
 * Delete arms an inline "Yes, delete" instead of firing immediately, and never
 * uses `window.confirm` (unstyled, unlocalised, and it blocks the main thread).
 *
 * Purely presentational: every mutation is delegated upward, so the integrating
 * page owns all I/O.
 */

/** Record keys ending in this store MINOR currency units, never major ones. */
const MINOR_SUFFIX = "_minor";

/** How many filled attributes a card's one-line summary may show. */
const SUMMARY_LIMIT = 3;

export interface RecordEditorProps {
  kind: RecordKind;
  records: ProfileRecord[];
  onCreate: (label: string, data: Record<string, FactValue>) => void | Promise<void>;
  onUpdate: (
    record: ProfileRecord,
    label: string,
    data: Record<string, FactValue>,
  ) => void | Promise<void>;
  onDelete: (record: ProfileRecord) => void | Promise<void>;
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Schema adaptation
// ---------------------------------------------------------------------------

/**
 * Lift a `RecordFieldDef` into the `ProfileField` shape `FieldControl` expects.
 *
 * A record attribute is a profile field with less metadata, so the missing
 * parts are synthesised rather than duplicated in the schema: the owning lens
 * comes from `RECORD_KIND_LENS`, the category is the record kind itself, and
 * the record's sensitivity cascades to every one of its attributes — a dose on
 * a supplement is as health-sensitive as the stack it belongs to.
 */
function toProfileField(
  kind: RecordKind,
  def: RecordKindDef,
  field: RecordFieldDef,
): ProfileField {
  return {
    id: `record.${kind}.${field.key}`,
    lens: RECORD_KIND_LENS[kind],
    category: kind,
    key: field.key,
    label: field.label,
    why: `Stored on this ${def.noun} so suggestions fit them specifically, instead of averaging everyone together.`,
    control: field.control,
    options: field.options,
    min: field.min,
    max: field.max,
    step: field.step,
    unit: field.unit,
    placeholder: field.placeholder,
    sensitivity: def.sensitivity ?? "standard",
    group: def.pluralNoun,
    // Money lives in minor units end to end; the control divides for display.
    minorUnits: field.key.endsWith(MINOR_SUFFIX) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Display text for one attribute. Minor-unit money reads as major units. */
function displayValue(field: RecordFieldDef, value: FactValue | null): string {
  if (value === null) return "";
  if (field.key.endsWith(MINOR_SUFFIX) && typeof value === "number") {
    return (value / 100).toLocaleString();
  }
  return formatFactValue(value);
}

/** Strip blanks so an untouched control never persists an empty value. */
function compact(draft: Record<string, FactValue>): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (isEmptyValue(value)) continue;
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

/**
 * The two or three most informative filled attributes, in schema order.
 *
 * Schema order is deliberate: the definitions put the identifying attribute
 * first (relationship, category, ingredient), so "first filled" is also "most
 * informative" without needing a second ranking to keep in sync.
 */
function summarize(def: RecordKindDef, record: ProfileRecord): string {
  const parts: string[] = [];
  for (const field of def.fields) {
    if (parts.length >= SUMMARY_LIMIT) break;
    const value = record.data[field.key] ?? null;
    if (isEmptyValue(value)) continue;
    parts.push(`${field.label}: ${displayValue(field, value)}`);
  }
  return parts.join(" · ");
}

function draftFrom(record: ProfileRecord | null): Record<string, FactValue> {
  return record ? { ...record.data } : {};
}

// ---------------------------------------------------------------------------

export function RecordEditor({
  kind,
  records,
  onCreate,
  onUpdate,
  onDelete,
  busy = false,
  loading = false,
  error = null,
}: RecordEditorProps) {
  const def = RECORD_SCHEMAS[kind];
  const uid = useId();

  /** null = closed, "new" = creating, otherwise the id being edited. */
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<Record<string, FactValue>>({});
  const [labelError, setLabelError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The record whose delete is armed. Reset whenever anything else happens. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const labelRef = useRef<HTMLInputElement>(null);

  const isHealth = def.sensitivity === "health";
  const disabled = busy || saving;
  /** A disabled control must always say WHY, not just look inert. */
  const busyReason = busy ? "Waiting for the last change to save." : undefined;
  const labelId = `${uid}-label`;
  const labelErrorId = `${uid}-label-error`;
  const lockId = `${uid}-lock`;

  function openEditor(record: ProfileRecord | null) {
    setOpenFor(record ? record.id : "new");
    setLabel(record ? record.label : "");
    setDraft(draftFrom(record));
    setLabelError(null);
    setSaveError(null);
    setConfirmingId(null);
  }

  function closeEditor() {
    setOpenFor(null);
    setLabel("");
    setDraft({});
    setLabelError(null);
    setSaveError(null);
  }

  /**
   * `FieldControl` reports a cleared control as `null` (deselecting a chip,
   * emptying a text box). Dropping the key entirely — rather than storing a
   * null — keeps `data` free of tombstones the API would have to interpret.
   */
  function setField(key: string, value: FactValue | null) {
    setDraft((prev) => {
      if (value === null || isEmptyValue(value)) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const trimmed = label.trim();
    if (!trimmed) {
      // Never silently no-op: say why, and put the cursor where the fix is.
      setLabelError(`Give this ${def.noun} a name so you can tell it apart.`);
      labelRef.current?.focus();
      return;
    }

    const existing = records.find((r) => r.id === openFor) ?? null;
    setLabelError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const data = compact(draft);
      if (existing) await onUpdate(existing, trimmed, data);
      else await onCreate(trimmed, data);
      closeEditor();
    } catch {
      // Keep the editor open so nothing typed is lost to a failed save.
      setSaveError("That didn't save. Your changes are still here — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(record: ProfileRecord) {
    setConfirmingId(null);
    try {
      await onDelete(record);
    } catch {
      setSaveError(`Couldn't delete that ${def.noun}. Try again.`);
    }
  }

  // -------------------------------------------------------------------------

  function renderEditor(record: ProfileRecord | null) {
    return (
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Escape cancels from anywhere inside the form, including a control.
          if (e.key === "Escape") {
            e.stopPropagation();
            closeEditor();
          }
        }}
        aria-label={record ? `Edit ${record.label}` : `Add a ${def.noun}`}
        className="card border-plum/40 p-4 sm:p-5"
      >
        <fieldset
          disabled={disabled}
          title={disabled ? (busyReason ?? "Saving…") : undefined}
          className="min-w-0 border-0 p-0"
        >
          <legend className="font-(family-name:--font-display) text-base text-ink">
            {record ? `Edit ${record.label}` : `Add a ${def.noun}`}
          </legend>

          <div className="mt-3">
            <label htmlFor={labelId} className="field-label">
              Name
              <span className="text-danger" aria-hidden>
                {" "}
                *
              </span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id={labelId}
              ref={labelRef}
              className="field-input sm:max-w-sm"
              value={label}
              placeholder={def.labelPlaceholder}
              autoFocus
              // Not `required`: the native bubble would preempt our own message
              // and still let a whitespace-only name through.
              aria-required
              aria-invalid={labelError ? true : undefined}
              aria-describedby={labelError ? labelErrorId : undefined}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError(null);
              }}
            />
            {labelError && (
              <p id={labelErrorId} role="alert" className="mt-1.5 text-xs text-danger">
                {labelError}
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {def.fields.map((field) => {
              const controlId = `${uid}-${field.key}`;
              const labelledBy = `${controlId}-label`;
              return (
                // FieldControl labels its own input for screen readers but draws
                // no visible label, and a chip row is a <div> that `htmlFor`
                // can't target — so the visible label is wired up by reference.
                <div key={field.key} className="min-w-0">
                  <p id={labelledBy} className="field-label">
                    {field.label}
                  </p>
                  <div role="group" aria-labelledby={labelledBy}>
                    <FieldControl
                      id={controlId}
                      field={toProfileField(kind, def, field)}
                      value={draft[field.key] ?? null}
                      onChange={(next) => setField(field.key, next)}
                      disabled={disabled}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>

        {saveError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {saveError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button type="submit" className="btn-primary text-sm" disabled={disabled}>
            {saving ? "Saving…" : record ? "Save changes" : `Add ${def.noun}`}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={closeEditor}
            disabled={saving}
            title={saving ? "Saving…" : undefined}
          >
            Cancel
          </button>
          <span className="text-xs text-ink-soft">Esc to cancel</span>
        </div>
      </form>
    );
  }

  function renderCard(record: ProfileRecord) {
    const summary = summarize(def, record);
    const arming = confirmingId === record.id;

    return (
      <li key={record.id} className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-(family-name:--font-display) text-base break-words text-ink">
              {record.label}
            </p>
            {summary ? (
              <p className="mt-0.5 text-sm break-words text-ink-soft">{summary}</p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-soft italic">
                Nothing filled in yet
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {arming ? (
              <>
                <span className="text-xs text-ink-soft">Delete?</span>
                <button
                  type="button"
                  className="chip !py-1 !border-danger !text-danger text-xs"
                  onClick={() => void handleDelete(record)}
                  disabled={busy}
                  title={busyReason}
                  aria-label={`Yes, delete ${record.label}`}
                >
                  <Trash2 size={13} aria-hidden />
                  Yes, delete
                </button>
                <button
                  type="button"
                  className="chip !py-1 text-xs"
                  onClick={() => setConfirmingId(null)}
                  disabled={busy}
                  title={busyReason}
                  aria-label={`Keep ${record.label}`}
                >
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="chip !py-1 text-xs"
                  onClick={() => openEditor(record)}
                  disabled={busy}
                  title={busyReason}
                  aria-label={`Edit ${record.label}`}
                >
                  <Pencil size={13} aria-hidden />
                  Edit
                </button>
                <button
                  type="button"
                  className="chip !py-1 text-xs hover:!border-danger hover:!text-danger"
                  onClick={() => setConfirmingId(record.id)}
                  disabled={busy}
                  title={busyReason}
                  aria-label={`Delete ${record.label}`}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    );
  }

  // -------------------------------------------------------------------------

  const addButton = (
    <button
      type="button"
      className="btn-secondary text-sm"
      onClick={() => openEditor(null)}
      disabled={busy}
      title={busyReason}
      aria-describedby={isHealth ? lockId : undefined}
    >
      <Plus size={15} aria-hidden />
      Add {def.noun}
    </button>
  );

  return (
    <section aria-labelledby={`${uid}-heading`} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={`${uid}-heading`}
          className="font-(family-name:--font-display) text-lg text-ink"
        >
          {def.pluralNoun}
        </h3>
        {!loading && records.length > 0 && (
          <span className="text-xs text-ink-soft">
            {records.length} saved
          </span>
        )}
      </div>

      {isHealth && (
        <p id={lockId} className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <Lock size={13} aria-hidden />
          Private to this lens — never shared with other lenses.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-cream-deep px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="skeleton h-16 rounded-2xl" />
          <div className="skeleton h-16 rounded-2xl" />
        </div>
      ) : records.length === 0 && openFor !== "new" ? (
        <div className="card mt-4 p-5">
          <p className="max-w-prose text-sm leading-relaxed text-ink-soft">{def.blurb}</p>
          <div className="mt-4">{addButton}</div>
        </div>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {records.map((record) =>
              openFor === record.id ? (
                <li key={record.id}>{renderEditor(record)}</li>
              ) : (
                renderCard(record)
              ),
            )}
          </ul>

          {/* While a record is being edited the Add button is withheld: opening
              a second editor would discard whatever is half-typed in the first. */}
          <div className="mt-3">
            {openFor === "new" ? renderEditor(null) : openFor === null ? addButton : null}
          </div>
        </>
      )}

      {/* Screen readers hear a save land even though the list updates visually. */}
      <p aria-live="polite" className="sr-only">
        {loading ? `Loading ${def.pluralNoun.toLowerCase()}` : `${records.length} saved`}
      </p>
    </section>
  );
}

export default RecordEditor;
