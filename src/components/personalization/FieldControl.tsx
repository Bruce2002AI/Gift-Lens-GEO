"use client";

import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { ProfileField } from "@/lib/personalization/schema";
import type { FactValue } from "@/lib/personalization/types";

/**
 * One control for ANY `ProfileField`, driven entirely by `field.control`.
 *
 * This is the piece that lets the profile fill itself: the agent writes a fact,
 * the schema resolves it onto a field, and the same control renders it whether
 * the shopper typed it or the model learned it. Purely presentational — value
 * in, `onChange` out, no I/O and no local source of truth.
 */

interface FieldControlProps {
  field: ProfileField;
  value: FactValue | null;
  onChange: (v: FactValue | null) => void;
  disabled?: boolean;
  /** Id applied to the focusable input, for an external <label htmlFor>. */
  id?: string;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * Whether a field counts as unanswered.
 *
 * `false` is deliberately NOT empty: switching a consent toggle off is an
 * answer, and treating it as blank would keep nagging the shopper for it.
 */
export function isEmptyValue(v: FactValue | null): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

/**
 * Coerce to a string list. The agent writes multi-values as one comma-joined
 * string (that is what `formatFactValue` produces), so splitting here is what
 * makes an agent-learned fact land in the right chips instead of one long tag.
 */
function toList(v: FactValue | null): string[] {
  if (Array.isArray(v)) return v.filter((s) => s.trim().length > 0);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (v == null) return [];
  return [String(v)];
}

function toText(v: FactValue | null): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function toNumber(v: FactValue | null): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function toBool(v: FactValue | null): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|on|1)$/i.test(v.trim());
  if (typeof v === "number") return v !== 0;
  return false;
}

/** ISO datetimes are trimmed to the date part `<input type="date">` accepts. */
function toDate(v: FactValue | null): string {
  const s = toText(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** Groups thousands without a comma's visual weight. Minor units render as
 *  major units with no decimals. */
const THIN_SPACE = "\u2009";

function formatMinor(minor: number): string {
  const major = Math.round(minor / 100);
  return String(major).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

function sliderReadout(field: ProfileField, n: number | null): string {
  if (n == null) return "Not set";
  if (field.minorUnits) return formatMinor(n);
  return field.unit ? `${n} ${field.unit}` : String(n);
}

const SELECTED_CHIP = "!border-plum !bg-plum-wash !text-plum";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FieldControl({
  field,
  value,
  onChange,
  disabled = false,
  id,
}: FieldControlProps) {
  const autoId = useId();
  const controlId = id ?? `field-${field.id}-${autoId}`;
  const groupRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // -- chips (single-select) -------------------------------------------------
  if (field.control === "chips") {
    const current = toText(value);
    return (
      <div className="flex flex-wrap gap-1.5" id={controlId}>
        {(field.options ?? []).map((opt) => {
          const on = current === opt;
          return (
            <button
              key={opt}
              type="button"
              className={`chip !py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${on ? SELECTED_CHIP : ""}`}
              aria-pressed={on}
              disabled={disabled}
              // Re-selecting clears, so a wrong guess is one tap to undo.
              onClick={() => onChange(on ? null : opt)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  // -- multichips (multi-select) --------------------------------------------
  if (field.control === "multichips") {
    const selected = toList(value);
    return (
      <div className="flex flex-wrap gap-1.5" id={controlId}>
        {(field.options ?? []).map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              className={`chip !py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${on ? SELECTED_CHIP : ""}`}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => {
                const next = on
                  ? selected.filter((s) => s !== opt)
                  : [...selected, opt];
                onChange(next.length ? next : null);
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  // -- choice (segmented control) -------------------------------------------
  if (field.control === "choice") {
    const options = field.options ?? [];
    const current = toText(value);

    // Radios are expected to be arrow-navigable; buttons are not by default.
    function onGroupKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!keys.includes(e.key)) return;
      const buttons = Array.from(
        groupRef.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [],
      ).filter((b) => !b.disabled);
      const index = buttons.findIndex((b) => b === document.activeElement);
      if (index === -1 || buttons.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next.focus();
      next.click();
    }

    return (
      <div
        ref={groupRef}
        id={controlId}
        role="radiogroup"
        aria-label={field.label}
        onKeyDown={onGroupKeyDown}
        className="inline-flex max-w-full flex-wrap overflow-hidden rounded-full border border-line bg-white"
      >
        {options.map((opt, i) => {
          const on = current === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              tabIndex={on || (!current && i === 0) ? 0 : -1}
              onClick={() => onChange(opt)}
              className={`px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                i > 0 ? "border-l border-line" : ""
              } ${on ? "bg-plum-wash font-medium text-plum" : "text-ink-soft hover:text-plum"}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  // -- slider ----------------------------------------------------------------
  if (field.control === "slider") {
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const step = field.step ?? 1;
    const n = toNumber(value);
    const readout = sliderReadout(field, n);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={controlId}
          type="range"
          className="h-5 min-w-0 flex-1 accent-plum disabled:cursor-not-allowed disabled:opacity-50"
          min={min}
          max={max}
          step={step}
          value={n ?? min}
          disabled={disabled}
          aria-label={field.label}
          aria-valuetext={readout}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output
          htmlFor={controlId}
          className={`shrink-0 tabular-nums text-sm ${n == null ? "text-ink-soft italic" : "font-medium text-ink"}`}
        >
          {readout}
        </output>
        {n != null && (
          <button
            type="button"
            className="chip !py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label={`Clear ${field.label}`}
          >
            Clear
          </button>
        )}
      </div>
    );
  }

  // -- text ------------------------------------------------------------------
  if (field.control === "text") {
    return (
      <input
        id={controlId}
        type="text"
        className="field-input disabled:cursor-not-allowed disabled:opacity-50"
        value={toText(value)}
        placeholder={field.placeholder}
        disabled={disabled}
        aria-label={field.label}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next.trim() ? next : null);
        }}
      />
    );
  }

  // -- date ------------------------------------------------------------------
  if (field.control === "date") {
    return (
      <input
        id={controlId}
        type="date"
        className="field-input disabled:cursor-not-allowed disabled:opacity-50 sm:w-52"
        value={toDate(value)}
        disabled={disabled}
        aria-label={field.label}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }

  // -- toggle ----------------------------------------------------------------
  if (field.control === "toggle") {
    const on = toBool(value);
    return (
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={field.label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          on ? "border-plum bg-plum-wash text-plum" : "border-line bg-white text-ink-soft"
        }`}
      >
        <span
          aria-hidden
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-plum" : "bg-sand"}`}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`}
          />
        </span>
        {on ? "On" : "Off"}
      </button>
    );
  }

  // -- tags (free-form multi-value) -----------------------------------------
  const tags = toList(value);

  function commit(raw: string) {
    const added = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      // Case-insensitive de-dupe: "Navy" and "navy" are the same preference.
      .filter((s, i, arr) => {
        const lower = s.toLowerCase();
        return (
          arr.findIndex((o) => o.toLowerCase() === lower) === i &&
          !tags.some((t) => t.toLowerCase() === lower)
        );
      });
    if (added.length === 0) return;
    onChange([...tags, ...added]);
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(input.value);
      input.value = "";
    } else if (e.key === "Backspace" && input.value === "" && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1).length ? tags.slice(0, -1) : null);
    }
  }

  // Pasting "navy, olive, sand" must become three tags, not one.
  function onTagPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes("\n")) return;
    e.preventDefault();
    commit(text.replace(/\n+/g, ","));
    if (tagInputRef.current) tagInputRef.current.value = "";
  }

  return (
    <div className="min-w-0">
      {tags.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-plum-wash py-1 pr-1 pl-2.5 text-xs text-plum">
                <span className="break-words">{tag}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${tag}`}
                  onClick={() => {
                    const next = tags.filter((t) => t !== tag);
                    onChange(next.length ? next : null);
                  }}
                  className="rounded-full p-0.5 text-plum transition-colors hover:bg-white hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        id={controlId}
        ref={tagInputRef}
        type="text"
        className="field-input disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={field.placeholder ?? "Type and press Enter"}
        disabled={disabled}
        aria-label={`Add to ${field.label}`}
        aria-describedby={`${controlId}-hint`}
        onKeyDown={onTagKeyDown}
        onPaste={onTagPaste}
        onBlur={(e) => {
          // Losing focus shouldn't silently discard what they typed.
          commit(e.currentTarget.value);
          e.currentTarget.value = "";
        }}
      />
      <p id={`${controlId}-hint`} className="mt-1 text-xs text-ink-soft">
        Press Enter or comma to add.
      </p>
    </div>
  );
}
