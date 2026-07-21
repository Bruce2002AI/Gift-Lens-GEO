"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Hash, HeartHandshake, MapPin, Pencil, SlidersHorizontal, Wallet, X } from "lucide-react";
import type { LedgerConstraints, LedgerView } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";
import { SHIPPING_COUNTRIES, countryName, postalFormat, validatePostalCode } from "@/lib/gift/countries";

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
  validate,
  numeric = false,
  maxLength,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  placeholder: string;
  busy: boolean;
  onCommit: (raw: string) => void;
  /** Return an error message for an invalid draft, or null when it's fine. */
  validate?: (raw: string) => string | null;
  /** Restrict typed input to digits (native numeric keypad on mobile). */
  numeric?: boolean;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // What the field held when editing opened, so a focus/blur with no real edit
  // never fires a refine turn.
  const [openedWith, setOpenedWith] = useState("");
  // Show the committed value immediately; the ledger only catches up once the
  // refine turn round-trips. Cleared as soon as the incoming `value` changes,
  // so the agent's canonical (e.g. formatted) value takes over.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [value]);
  const shown = pending ?? value;

  const error = editing && validate ? validate(draft) : null;

  const open = () => {
    setDraft(shown ?? "");
    setOpenedWith((shown ?? "").trim());
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    // Never commit a value that fails validation — keep editing so the shopper
    // can fix it rather than silently shopping for a wrong address.
    if (next && validate?.(next)) return;
    setEditing(false);
    // Only refine on a genuine change — re-committing the same value would
    // re-shop for nothing and spam the chat.
    if (next && next !== openedWith) {
      setPending(next);
      onCommit(next);
    }
  };

  if (editing) {
    return (
      <div className="inline-flex flex-col gap-0.5">
        <form
          className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 ${
            error ? "border-danger" : "border-plum"
          }`}
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <span className={error ? "text-danger" : "text-plum"} aria-hidden>
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
            inputMode={numeric ? "numeric" : undefined}
            maxLength={maxLength}
            aria-invalid={error ? true : undefined}
            onChange={(e) =>
              setDraft(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)
            }
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-28 border-0 bg-transparent text-xs text-ink placeholder:text-ink-soft/50 outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
          />
        </form>
        {error && <span className="px-2.5 text-[10px] text-danger">{error}</span>}
      </div>
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
      {shown ? (
        <span>{shown}</span>
      ) : (
        <span className="text-ink-soft">{placeholder}</span>
      )}
      <Pencil size={11} className="text-ink-soft/60 group-hover:text-plum" aria-hidden />
    </button>
  );
}

/**
 * A ship-to chip backed by a native <select> of major shipping markets. Picking
 * a country issues the same plain-language refine turn the free-text field used
 * to, so the ledger stays the single source of truth.
 */
function CountrySelectChip({
  code,
  busy,
  onSelect,
}: {
  code: string | null;
  busy: boolean;
  onSelect: (country: string) => void;
}) {
  // Show the shopper's pick immediately: the ledger only updates once the
  // refine turn round-trips through the agent, so we hold the selection locally
  // and let a confirmed ledger value take over when it arrives.
  const [pending, setPending] = useState<string | null>(null);
  // The freshest pick wins for display; once the ledger confirms it, drop the
  // local override so the ledger stays authoritative for later corrections.
  useEffect(() => {
    if (pending && code === pending) setPending(null);
  }, [code, pending]);
  const effective = pending ?? code;
  const label = countryName(effective);
  return (
    <label
      title="Choose where the gift ships — the expert re-shops for that market"
      className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink transition-colors hover:border-plum has-[:focus-visible]:border-plum has-[:disabled]:opacity-50"
    >
      <span className="text-ink-soft group-hover:text-plum" aria-hidden>
        <MapPin size={12} />
      </span>
      <span className="sr-only">Ship to</span>
      {label ? <span>Ships to {label}</span> : <span className="text-ink-soft">Ship to…</span>}
      <ChevronDown size={11} className="text-ink-soft/60 group-hover:text-plum" aria-hidden />
      <select
        disabled={busy}
        value={effective ?? ""}
        onChange={(e) => {
          const next = SHIPPING_COUNTRIES.find((x) => x.code === e.target.value);
          if (next) {
            setPending(next.code);
            onSelect(next.name);
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        aria-label="Ship to country"
      >
        <option value="" disabled>
          Ship to…
        </option>
        {SHIPPING_COUNTRIES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
    </label>
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
  const postal = postalFormat(c?.country ?? null);

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

      <CountrySelectChip
        code={c?.country ?? null}
        busy={busy}
        onSelect={(country) => onRefine(`Ship to ${country}.`)}
      />

      {/* PIN code only makes sense once we know the country — its format,
          validation, and placeholder all depend on it. */}
      {c?.country && (
        <EditableChip
          icon={<Hash size={12} />}
          label="pin code"
          value={c.postalCode ?? null}
          placeholder={postal?.example ? `e.g. ${postal.example}` : "Add PIN code"}
          busy={busy}
          numeric={postal?.numeric ?? false}
          maxLength={postal?.maxLength}
          validate={(raw) => validatePostalCode(c.country, raw)}
          onCommit={(raw) => onRefine(`My postal/PIN code is ${raw}.`)}
        />
      )}

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
