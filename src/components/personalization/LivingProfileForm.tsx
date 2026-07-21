"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, Lock, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { FieldControl, isEmptyValue } from "./FieldControl";
import { humanizeKey } from "@/lib/personalization/ledger-bridge";
import {
  completionForLens,
  findField,
  groupedFieldsForLens,
  resolveFieldForKey,
  type ProfileField,
} from "@/lib/personalization/schema";
import {
  formatFactValue,
  needsConfirmation,
  LENS_LABELS,
  type ConsentScope,
  type FactValue,
  type ProfileFact,
  type ProfileLens,
} from "@/lib/personalization/types";

/**
 * The always-visible Living Profile.
 *
 * The shopper never has to "go and fill in a form": the agent writes facts as
 * they chat, the schema resolves those onto real fields, and they appear here
 * already answered — with an Inferred badge wherever it was a guess. Editing
 * here and chatting are the same act, because both end up as facts.
 *
 * Presentational only: every mutation is a callback, so the page owns all I/O.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LivingProfileFormProps {
  lens: ProfileLens;
  /** Every fact the shopper owns; this component filters to `lens` itself. */
  facts: ProfileFact[];
  onSave: (field: ProfileField, value: FactValue | null) => void | Promise<void>;
  onConfirm: (fact: ProfileFact) => void;
  onDelete: (fact: ProfileFact) => void;
  onConsentChange: (fact: ProfileFact, scope: ConsentScope) => void;
  /** `"category.key"` currently saving, so only that row shows as busy. */
  busyKey?: string | null;
  /** Denser layout for the shop sidebar; also collapses untouched groups. */
  compact?: boolean;
  /** Embedded in a drawer: drop the outer card + title (the drawer supplies them). */
  bare?: boolean;
  onConfirmAll?: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/** How long we wait before persisting free-text and slider drags. */
const TYPING_DEBOUNCE_MS = 500;

const IDENTITY = (category: string, key: string) => `${category}.${key}`;

/**
 * A local edit, plus the stored value it was made against.
 *
 * Keeping `base` is what lets a draft yield to a genuinely newer stored value
 * (the agent learning something mid-edit) without yielding to the echo of the
 * shopper's own save — and it does so during render, so no state-syncing
 * effect is needed.
 */
interface Draft {
  value: FactValue | null;
  base: FactValue | null;
}

/** State scoped to a lens: switching lens discards it during render. */
interface LensScoped<T> {
  lens: ProfileLens;
  map: Record<string, T>;
}

const NO_DRAFTS: Record<string, Draft> = {};
const NOT_REVEALED: Record<string, boolean> = {};

function same(a: FactValue | null, b: FactValue | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function scopedMap<T>(state: LensScoped<T>, lens: ProfileLens, fallback: Record<string, T>) {
  return state.lens === lens ? state.map : fallback;
}

// ---------------------------------------------------------------------------
// Fact → field resolution
// ---------------------------------------------------------------------------

/**
 * `category.key` identities that count as answered for this lens.
 *
 * Aliases resolve too, so a fact the model filed as `recipient.loves` counts
 * toward the `recipient.interests` field it actually renders in.
 */
export function filledKeysFromFacts(
  facts: ProfileFact[],
  lens: ProfileLens,
): Set<string> {
  const filled = new Set<string>();
  for (const fact of facts) {
    if (fact.lens !== lens) continue;
    if (isEmptyValue(fact.value)) continue;
    filled.add(IDENTITY(fact.category, fact.key));
    const field =
      findField(lens, fact.category, fact.key) ??
      resolveFieldForKey(lens, IDENTITY(fact.category, fact.key));
    if (field && field.lens === lens) filled.add(IDENTITY(field.category, field.key));
  }
  return filled;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LivingProfileForm({
  lens,
  facts,
  onSave,
  onConfirm,
  onDelete,
  onConsentChange,
  busyKey = null,
  compact = false,
  bare = false,
  onConfirmAll,
  loading = false,
  error = null,
  onRetry,
}: LivingProfileFormProps) {
  // Local drafts keep typing responsive while the save is in flight.
  const [draftState, setDraftState] = useState<LensScoped<Draft>>({ lens, map: {} });
  const [revealState, setRevealState] = useState<LensScoped<boolean>>({ lens, map: {} });
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Identities like "budget.max_minor" exist in more than one lens, so drafts
  // and reveals are scoped rather than carried across a lens switch.
  const drafts = scopedMap(draftState, lens, NO_DRAFTS);
  const revealed = scopedMap(revealState, lens, NOT_REVEALED);

  const groups = useMemo(() => groupedFieldsForLens(lens), [lens]);

  const { factForKey, orphans, lensFacts } = useMemo(() => {
    const mine = facts.filter((f) => f.lens === lens);
    const map = new Map<string, ProfileFact>();
    const claimed = new Set<string>();
    for (const fact of mine) {
      const field =
        findField(lens, fact.category, fact.key) ??
        resolveFieldForKey(lens, IDENTITY(fact.category, fact.key));
      if (!field || field.lens !== lens) continue;
      const identity = IDENTITY(field.category, field.key);
      // First writer wins so an alias can never displace an exact match that
      // was already claimed.
      if (map.has(identity)) continue;
      map.set(identity, fact);
      claimed.add(fact.id);
    }
    return {
      factForKey: map,
      // Nothing the agent learns is ever invisible — unmatched facts still render.
      orphans: mine.filter((f) => !claimed.has(f.id)),
      lensFacts: mine,
    };
  }, [facts, lens]);

  const unconfirmed = useMemo(
    () => lensFacts.filter((f) => needsConfirmation(f)),
    [lensFacts],
  );

  /**
   * The value a control should show: the draft while it is still the freshest
   * thing we know, otherwise whatever is stored.
   */
  function valueFor(identity: string): FactValue | null {
    const stored = factForKey.get(identity)?.value ?? null;
    const draft = drafts[identity];
    if (!draft) return stored;
    // Stored has moved somewhere neither we nor our save put it — the agent
    // learned something newer, so it wins.
    if (!same(stored, draft.base) && !same(stored, draft.value)) return stored;
    return draft.value;
  }

  const filledKeys = filledKeysFromFacts(facts, lens);
  // Count what they just typed, so the counter moves before the save lands.
  for (const [identity, draft] of Object.entries(drafts)) {
    if (isEmptyValue(draft.value)) filledKeys.delete(identity);
    else filledKeys.add(identity);
  }

  const completion = completionForLens(lens, filledKeys);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  function handleChange(field: ProfileField, value: FactValue | null) {
    const identity = IDENTITY(field.category, field.key);
    const base = factForKey.get(identity)?.value ?? null;
    setDraftState((prev) => ({
      lens,
      map: { ...scopedMap(prev, lens, NO_DRAFTS), [identity]: { value, base } },
    }));

    // Discrete controls save on the click; typing and dragging wait, so we
    // don't fire a write per keystroke.
    const delay =
      field.control === "text" || field.control === "slider" || field.control === "tags"
        ? TYPING_DEBOUNCE_MS
        : 0;
    const existing = timers.current.get(identity);
    if (existing) clearTimeout(existing);
    timers.current.set(
      identity,
      setTimeout(() => {
        timers.current.delete(identity);
        void onSave(field, value);
      }, delay),
    );
  }

  function groupIsOpen(group: string, fields: ProfileField[]): boolean {
    const override = openOverrides[`${lens}::${group}`];
    if (override !== undefined) return override;
    if (!compact) return true;
    // In the sidebar, only open what already has something in it.
    return fields.some((f) => {
      const identity = IDENTITY(f.category, f.key);
      const fact = factForKey.get(identity);
      return filledKeys.has(identity) || (fact ? needsConfirmation(fact) : false);
    });
  }

  // -- loading ---------------------------------------------------------------
  if (loading) {
    return (
      <div className="card p-4 sm:p-5" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading your profile…</span>
        <div className="skeleton h-5 w-40" />
        <div className="skeleton mt-3 h-2 w-full rounded-full" />
        <div className="mt-5 space-y-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-28" />
              <div className="skeleton h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // -- error -----------------------------------------------------------------
  if (error) {
    return (
      <div className="card p-4 sm:p-5" role="alert">
        <h3 className="font-(family-name:--font-display) text-base text-ink">
          We couldn&rsquo;t load your profile
        </h3>
        <p className="mt-1 text-sm break-words text-ink-soft">{error}</p>
        {onRetry && (
          <button type="button" className="btn-secondary mt-3 !px-4 !py-2 text-sm" onClick={onRetry}>
            <RotateCw size={14} aria-hidden />
            Retry
          </button>
        )}
      </div>
    );
  }

  const canConfirmAll = unconfirmed.length > 0;

  return (
    <section
      className={bare ? "" : "card p-4 sm:p-5"}
      aria-label={`${LENS_LABELS[lens]} profile`}
    >
      {/* -- header ---------------------------------------------------------- */}
      <div
        className={`flex flex-wrap items-end gap-3 ${bare ? "justify-end" : "justify-between"}`}
      >
        {!bare && (
          <div className="min-w-0">
            <h3 className="font-(family-name:--font-display) text-base text-ink">
              {LENS_LABELS[lens]} profile
            </h3>
            <p className="mt-0.5 text-sm text-ink-soft">
              <span className="font-medium text-ink">
                {completion.filled} of {completion.total}
              </span>{" "}
              filled in — everything here is editable, and it fills itself as you chat.
            </p>
          </div>
        )}
        <button
          type="button"
          className="btn-secondary !px-3.5 !py-2 text-sm"
          onClick={() => {
            if (onConfirmAll) onConfirmAll();
            else for (const fact of unconfirmed) onConfirm(fact);
          }}
          disabled={!canConfirmAll}
          title={
            canConfirmAll
              ? `Confirm ${unconfirmed.length} thing${unconfirmed.length === 1 ? "" : "s"} we guessed from your chat.`
              : "Nothing to confirm — everything here you told us yourself."
          }
        >
          <Sparkles size={14} aria-hidden />
          Use what you already know
          {canConfirmAll && (
            <span className="rounded-full bg-gold-wash px-1.5 text-xs text-gold">
              {unconfirmed.length}
            </span>
          )}
        </button>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sand"
        role="progressbar"
        aria-valuenow={completion.filled}
        aria-valuemin={0}
        aria-valuemax={completion.total}
        aria-valuetext={`${completion.filled} of ${completion.total} fields filled in`}
        aria-label="Profile completeness"
      >
        <div
          className="h-full rounded-full bg-plum transition-[width] duration-300"
          style={{ width: `${completion.percent}%` }}
        />
      </div>

      {lensFacts.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-cream px-3 py-2.5 text-sm text-ink-soft">
          Nothing yet — this fills in as you chat, or start typing.
        </p>
      )}

      {/* -- groups ---------------------------------------------------------- */}
      <div className={compact ? "mt-4 space-y-2" : "mt-5 space-y-3"}>
        {groups.map(({ group, fields }) => (
          <details
            key={group}
            open={groupIsOpen(group, fields)}
            onToggle={(e) => {
              // Read before the updater runs: React nulls `currentTarget` once
              // the event is done, and the updater is deferred.
              const isOpen = e.currentTarget.open;
              setOpenOverrides((prev) => ({ ...prev, [`${lens}::${group}`]: isOpen }));
            }}
            className="rounded-xl border border-line bg-cream/40 px-3 py-2"
          >
            <summary className="cursor-pointer list-item text-sm font-medium text-ink marker:text-ink-soft">
              {group}
              <span className="ml-2 text-xs font-normal text-ink-soft">
                {fields.filter((f) => filledKeys.has(IDENTITY(f.category, f.key))).length}/
                {fields.length}
              </span>
            </summary>

            <div className={compact ? "mt-3 space-y-4" : "mt-4 space-y-5"}>
              {fields.map((field) => {
                const identity = IDENTITY(field.category, field.key);
                const fact = factForKey.get(identity) ?? null;
                return (
                  <FieldRow
                    key={field.id}
                    field={field}
                    fact={fact}
                    value={valueFor(identity)}
                    busy={busyKey === identity}
                    revealed={revealed[identity] === true}
                    onReveal={(next) =>
                      setRevealState((prev) => ({
                        lens,
                        map: { ...scopedMap(prev, lens, NOT_REVEALED), [identity]: next },
                      }))
                    }
                    onChange={(next) => handleChange(field, next)}
                    onConfirm={onConfirm}
                    onDelete={onDelete}
                    onConsentChange={onConsentChange}
                  />
                );
              })}
            </div>
          </details>
        ))}

        {/* -- unmatched facts ------------------------------------------------ */}
        {orphans.length > 0 && (
          <details
            open={!compact}
            className="rounded-xl border border-line bg-cream/40 px-3 py-2"
          >
            <summary className="cursor-pointer list-item text-sm font-medium text-ink marker:text-ink-soft">
              Other things we&rsquo;ve learned
              <span className="ml-2 text-xs font-normal text-ink-soft">{orphans.length}</span>
            </summary>
            <p className="mt-2 text-xs text-ink-soft">
              These don&rsquo;t map to a question above, so they live here rather than
              anywhere you can&rsquo;t see them.
            </p>
            <ul className="mt-3 space-y-2">
              {orphans.map((fact) => (
                <OrphanRow
                  key={fact.id}
                  fact={fact}
                  busy={busyKey === IDENTITY(fact.category, fact.key)}
                  onConfirm={onConfirm}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

interface FieldRowProps {
  field: ProfileField;
  fact: ProfileFact | null;
  value: FactValue | null;
  busy: boolean;
  revealed: boolean;
  onReveal: (next: boolean) => void;
  onChange: (value: FactValue | null) => void;
  onConfirm: (fact: ProfileFact) => void;
  onDelete: (fact: ProfileFact) => void;
  onConsentChange: (fact: ProfileFact, scope: ConsentScope) => void;
}

function FieldRow({
  field,
  fact,
  value,
  busy,
  revealed,
  onReveal,
  onChange,
  onConfirm,
  onDelete,
  onConsentChange,
}: FieldRowProps) {
  const isHealth = field.sensitivity === "health" || fact?.sensitivity === "health";
  const inferred = fact ? needsConfirmation(fact) : false;
  const hasValue = !isEmptyValue(value);
  // Nothing to hide when it's empty, and masking an empty box would only add a
  // click between the shopper and answering.
  const masked = isHealth && hasValue && !revealed;
  const controlId = `lpf-${field.id}`;
  const lockId = `${controlId}-lock`;

  return (
    <fieldset className="min-w-0" disabled={busy}>
      <legend className="field-label">{field.label}</legend>

      {(inferred || isHealth || busy) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {inferred && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-wash px-2 py-0.5 text-xs font-medium text-gold">
              Inferred
            </span>
          )}
          {isHealth && (
            <span id={lockId} className="inline-flex items-center gap-1 text-xs text-ink-soft">
              <Lock size={12} aria-hidden />
              Private to this lens
            </span>
          )}
          {busy && (
            <span className="text-xs text-ink-soft" role="status">
              Saving…
            </span>
          )}
        </div>
      )}

      {masked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-lg border border-line bg-sand px-3 py-2 text-sm tracking-widest text-ink-soft"
            aria-hidden
          >
            ••••••
          </span>
          <button
            type="button"
            className="chip !py-1 text-xs"
            onClick={() => onReveal(true)}
            aria-label={`Show ${field.label}`}
          >
            <Eye size={13} aria-hidden />
            Show
          </button>
        </div>
      ) : (
        <>
          <FieldControl
            field={field}
            value={value}
            onChange={onChange}
            disabled={busy}
            id={controlId}
          />
          {isHealth && hasValue && (
            <button
              type="button"
              className="chip mt-1.5 !py-1 text-xs"
              onClick={() => onReveal(false)}
              aria-label={`Hide ${field.label}`}
            >
              <EyeOff size={13} aria-hidden />
              Hide
            </button>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <details className="min-w-0">
          <summary className="cursor-pointer text-xs text-ink-soft underline decoration-line underline-offset-2 hover:text-plum">
            Why we ask this
          </summary>
          <p className="mt-1 max-w-prose text-xs text-ink-soft">{field.why}</p>
        </details>

        {fact && inferred && (
          <>
            <button
              type="button"
              className="chip !py-1 text-xs"
              onClick={() => onConfirm(fact)}
              aria-label={`Confirm ${field.label}`}
            >
              <Check size={13} aria-hidden />
              Confirm
            </button>
            <button
              type="button"
              className="chip !py-1 text-xs hover:!border-danger hover:!text-danger"
              onClick={() => onDelete(fact)}
              aria-label={`Delete ${field.label}`}
            >
              <Trash2 size={13} aria-hidden />
              Delete
            </button>
          </>
        )}

        {fact && (
          <PrivacySwitch
            fact={fact}
            label={field.label}
            isHealth={isHealth}
            describedBy={isHealth ? lockId : undefined}
            onConsentChange={onConsentChange}
          />
        )}
      </div>

      {fact?.quote && !masked && (
        <p className="mt-2 border-l-2 border-line pl-3 text-xs break-words text-ink-soft italic">
          your words: “{fact.quote}”
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Per-fact privacy
// ---------------------------------------------------------------------------

interface PrivacySwitchProps {
  fact: ProfileFact;
  label: string;
  isHealth: boolean;
  describedBy?: string;
  onConsentChange: (fact: ProfileFact, scope: ConsentScope) => void;
}

/**
 * Health data is disabled here rather than merely ignored downstream: a control
 * that silently does nothing is worse than one that explains why it can't.
 */
function PrivacySwitch({
  fact,
  label,
  isHealth,
  describedBy,
  onConsentChange,
}: PrivacySwitchProps) {
  const crossLens = fact.consentScope === "approved_cross_lens" && !isHealth;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={crossLens}
      disabled={isHealth}
      aria-describedby={describedBy}
      title={
        isHealth
          ? "Health data never crosses lenses, so this can't be turned on."
          : crossLens
            ? "This can inform every lens. Select to keep it to this lens only."
            : "This stays in this lens. Select to let it inform every lens."
      }
      aria-label={`Sharing for ${label}: ${crossLens ? "All lenses" : "Only this lens"}`}
      onClick={() => onConsentChange(fact, crossLens ? "lens_only" : "approved_cross_lens")}
      className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        crossLens ? "border-plum bg-plum-wash text-plum" : "border-line bg-white text-ink-soft"
      }`}
    >
      {isHealth && <Lock size={11} aria-hidden />}
      <span
        aria-hidden
        className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${crossLens ? "bg-plum" : "bg-sand"}`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${crossLens ? "left-3" : "left-0.5"}`}
        />
      </span>
      {crossLens ? "All lenses" : "Only this lens"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A fact with no matching field
// ---------------------------------------------------------------------------

interface OrphanRowProps {
  fact: ProfileFact;
  busy: boolean;
  onConfirm: (fact: ProfileFact) => void;
  onDelete: (fact: ProfileFact) => void;
}

function OrphanRow({ fact, busy, onConfirm, onDelete }: OrphanRowProps) {
  const label = humanizeKey(fact.category, fact.key);
  const inferred = needsConfirmation(fact);
  return (
    <li className="rounded-lg border border-line bg-white p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="field-label mb-0.5">{label}</p>
          <p className="text-sm break-words text-ink">{formatFactValue(fact.value)}</p>
        </div>
        {inferred && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-wash px-2 py-0.5 text-xs font-medium text-gold">
            Inferred
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {inferred && (
          <button
            type="button"
            className="chip !py-1 text-xs"
            disabled={busy}
            onClick={() => onConfirm(fact)}
            aria-label={`Confirm ${label}`}
          >
            <Check size={13} aria-hidden />
            Confirm
          </button>
        )}
        <button
          type="button"
          className="chip !py-1 text-xs hover:!border-danger hover:!text-danger"
          disabled={busy}
          onClick={() => onDelete(fact)}
          aria-label={`Delete ${label}`}
        >
          <Trash2 size={13} aria-hidden />
          Delete
        </button>
        {busy && (
          <span className="text-xs text-ink-soft" role="status">
            Saving…
          </span>
        )}
      </div>
    </li>
  );
}
