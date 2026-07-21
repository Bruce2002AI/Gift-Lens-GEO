"use client";

import { useState } from "react";
import { Check, Lock, Pencil, Trash2 } from "lucide-react";
import { humanizeKey } from "@/lib/personalization/ledger-bridge";
import {
  formatFactValue,
  needsConfirmation,
  type ConsentScope,
  type ProfileFact,
} from "@/lib/personalization/types";

interface FactCardProps {
  fact: ProfileFact;
  onConfirm: (fact: ProfileFact) => void;
  /** `value` is the raw text the shopper typed; the caller coerces the type. */
  onEdit: (fact: ProfileFact, value: string) => void;
  onDelete: (fact: ProfileFact) => void;
  onConsentChange: (fact: ProfileFact, scope: ConsentScope) => void;
  busy?: boolean;
}

/**
 * One stored fact, with the controls that make it correctable.
 *
 * Pure presentation: every action is delegated upward, so this renders
 * identically in the Personalization Center and anywhere else a fact is shown.
 */
export function FactCard({
  fact,
  onConfirm,
  onEdit,
  onDelete,
  onConsentChange,
  busy = false,
}: FactCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatFactValue(fact.value));

  const label = humanizeKey(fact.category, fact.key);
  const display = formatFactValue(fact.value);
  const unconfirmed = needsConfirmation(fact);
  const isHealth = fact.sensitivity === "health";
  const crossLens = fact.consentScope === "approved_cross_lens";
  const inputId = `fact-${fact.id}-value`;

  function startEditing() {
    setDraft(formatFactValue(fact.value));
    setEditing(true);
  }

  function save() {
    const next = draft.trim();
    // An empty value would silently blank the fact; deleting is the explicit
    // way to remove one, so a blank save is treated as a cancel.
    if (next && next !== display) onEdit(fact, next);
    setEditing(false);
  }

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="field-label mb-0.5">{label}</p>
          {editing ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label htmlFor={inputId} className="sr-only">
                Edit {label}
              </label>
              <input
                id={inputId}
                className="field-input sm:w-64"
                value={draft}
                autoFocus
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5 text-sm"
                onClick={save}
                disabled={busy}
              >
                Save
              </button>
              <button
                type="button"
                className="btn-secondary !px-3 !py-1.5 text-sm"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="break-words text-ink">{display}</p>
          )}
        </div>

        {unconfirmed && !editing && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-wash px-2.5 py-1 text-xs font-medium text-gold">
            Inferred
          </span>
        )}
      </div>

      {fact.quote && (
        <p className="mt-2 border-l-2 border-line pl-3 text-sm text-ink-soft italic">
          your words: “{fact.quote}”
        </p>
      )}

      {isHealth && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <Lock size={13} aria-hidden />
          Health data — kept private to this lens
        </p>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {unconfirmed && (
            <button
              type="button"
              className="chip !py-1 text-xs"
              onClick={() => onConfirm(fact)}
              disabled={busy}
              aria-label={`Confirm ${label}`}
            >
              <Check size={13} aria-hidden />
              Confirm
            </button>
          )}
          <button
            type="button"
            className="chip !py-1 text-xs"
            onClick={startEditing}
            disabled={busy}
            aria-label={`Edit ${label}`}
          >
            <Pencil size={13} aria-hidden />
            Edit
          </button>
          <button
            type="button"
            className="chip !py-1 text-xs hover:!border-danger hover:!text-danger"
            onClick={() => onDelete(fact)}
            disabled={busy}
            aria-label={`Delete ${label}`}
          >
            <Trash2 size={13} aria-hidden />
            Delete
          </button>

          {/* Per-fact privacy. Health data can never be opted into cross-lens
              sharing, so the control is disabled rather than merely ignored. */}
          <button
            type="button"
            role="switch"
            aria-checked={crossLens}
            disabled={busy || isHealth}
            title={
              isHealth
                ? "Health data never crosses lenses."
                : crossLens
                  ? "This fact can inform every lens. Select to keep it to this lens only."
                  : "This fact stays in this lens. Select to let it inform every lens."
            }
            onClick={() =>
              onConsentChange(fact, crossLens ? "lens_only" : "approved_cross_lens")
            }
            aria-label={`Sharing for ${label}: ${
              crossLens ? "All lenses" : "Only this lens"
            }`}
            className={`ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              crossLens && !isHealth
                ? "border-plum bg-plum-wash text-plum"
                : "border-line bg-white text-ink-soft"
            }`}
          >
            {isHealth ? <Lock size={12} aria-hidden /> : null}
            <span
              aria-hidden
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                crossLens && !isHealth ? "bg-plum" : "bg-sand"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                  crossLens && !isHealth ? "left-3.5" : "left-0.5"
                }`}
              />
            </span>
            {crossLens && !isHealth ? "All lenses" : "Only this lens"}
          </button>
        </div>
      )}
    </li>
  );
}
