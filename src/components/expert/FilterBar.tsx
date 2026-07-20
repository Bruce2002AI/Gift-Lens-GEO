"use client";

import { useState } from "react";
import { HeartHandshake, MapPin, Pencil, SlidersHorizontal, Wallet, X } from "lucide-react";
import type { LedgerConstraints, LedgerView } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";

function formatBudget(c: LedgerConstraints): string | null {
  const { budgetMinMinor: min, budgetMaxMinor: max, currency } = c;
  if (min != null && max != null) return `${formatMinor(min, currency)} – ${formatMinor(max, currency)}`;
  if (max != null) return `up to ${formatMinor(max, currency)}`;
  if (min != null) return `from ${formatMinor(min, currency)}`;
  return null;
}

/** A chip that flips to an inline text field when edited. */
function EditableChip({
  icon,
  label,
  value,
  placeholder,
  busy,
  onCommit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  placeholder: string;
  busy: boolean;
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const open = () => {
    setDraft(value ?? "");
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next) onCommit(next);
  };

  if (editing) {
    return (
      <form
        className="inline-flex items-center gap-1 rounded-full border border-plum bg-white px-2 py-0.5"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <span className="text-plum" aria-hidden>
          {icon}
        </span>
        <label className="sr-only" htmlFor={`filter-${label}`}>
          {label}
        </label>
        <input
          id={`filter-${label}`}
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-28 bg-transparent text-xs text-ink placeholder:text-ink-soft/50 focus:outline-none"
        />
      </form>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={open}
      title={`Edit ${label} — the expert re-shops with the new value`}
      className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink transition-colors hover:border-plum disabled:opacity-50"
    >
      <span className="text-ink-soft group-hover:text-plum" aria-hidden>
        {icon}
      </span>
      {value ? (
        <span>{value}</span>
      ) : (
        <span className="text-ink-soft">{placeholder}</span>
      )}
      <Pencil size={11} className="text-ink-soft/60 group-hover:text-plum" aria-hidden />
    </button>
  );
}

/**
 * The results-page filter bar: a shopping-style readout of the constraints the
 * agent has extracted (budget, ship-to, deadline, exclusions), rendered as
 * chips. Editing or removing one issues a plain-language refine turn — the same
 * channel a typed message uses — so the ledger stays the single source of truth.
 */
export function FilterBar({
  view,
  busy,
  onRefine,
}: {
  view: LedgerView | null;
  busy: boolean;
  onRefine: (message: string) => void;
}) {
  const c = view?.constraints ?? null;
  const budget = c ? formatBudget(c) : null;
  const currency = c?.currency ?? "INR";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
        <SlidersHorizontal size={13} aria-hidden />
        Filters
      </span>

      <EditableChip
        icon={<Wallet size={12} />}
        label="budget"
        value={budget}
        placeholder="Set budget"
        busy={busy}
        onCommit={(raw) => {
          // Digits only → an unambiguous max; anything else passes through as
          // the shopper's own phrasing (e.g. "5k–8k") for the agent to parse.
          const digits = raw.replace(/[^\d]/g, "");
          onRefine(
            digits && digits === raw.replace(/[\s,]/g, "")
              ? `Set my budget to a maximum of ${digits} ${currency}.`
              : `Change my budget to ${raw}.`,
          );
        }}
      />

      <EditableChip
        icon={<MapPin size={12} />}
        label="ship-to"
        value={c?.country ? `Ships to ${c.country}` : null}
        placeholder="Ship to…"
        busy={busy}
        onCommit={(raw) => onRefine(`Ship to ${raw}.`)}
      />

      {c?.deadline && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink">
          by {c.deadline}
        </span>
      )}

      {c?.exclusions.map((exclusion) => (
        <button
          key={exclusion}
          type="button"
          disabled={busy}
          onClick={() => onRefine(`Actually, ${exclusion} is fine — drop that restriction.`)}
          title={`Remove "${exclusion}" — the expert stops filtering it out`}
          className="group inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft line-through transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {exclusion}
          <X size={11} className="no-underline" aria-hidden />
        </button>
      ))}

      {view?.careFlags.map((flag) => (
        <span
          key={flag.kind}
          className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold-wash px-2.5 py-1 text-xs font-medium text-gold"
        >
          <HeartHandshake size={11} aria-hidden />
          {flag.label}
        </span>
      ))}
    </div>
  );
}
