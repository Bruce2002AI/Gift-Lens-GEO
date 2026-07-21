"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Hash, HeartHandshake, MapPin, Pencil, Plus, SlidersHorizontal, User, Wallet, X } from "lucide-react";
import type { LedgerView, LedgerConstraints, SubjectSummary } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";
import { SHIPPING_COUNTRIES, countryName, postalFormat, postalTerm, validatePostalCode } from "@/lib/gift/countries";

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
  // Clear the optimistic override when the incoming value changes — reconciled
  // during render (not in an effect) so it can't trigger a cascading re-render.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setPending(null);
  }
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
      // Relative so the validation message can float below the field without
      // adding height or width to the chip — otherwise it grows the row and
      // shoves the neighbouring chips out of place.
      <div className="relative inline-flex flex-col">
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
        {error && (
          <span className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap px-2.5 text-[10px] text-danger">
            {error}
          </span>
        )}
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
  // Reconciled during render (not in an effect) to avoid cascading renders.
  const [prevCode, setPrevCode] = useState(code);
  if (code !== prevCode) {
    setPrevCode(code);
    if (pending && code === pending) setPending(null);
  }
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

/** The recipient switcher chip — "For {name}" opening a people dropdown. */
function SubjectChip({
  subjects,
  activeSubjectId,
  busy,
  onSelect,
  onNew,
}: {
  subjects: SubjectSummary[];
  activeSubjectId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = subjects.find((s) => s.subjectId === activeSubjectId);
  const isPerson = active != null && active.kind === "person";
  const people = subjects.filter((s) => s.kind === "person");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          isPerson
            ? "bg-butter-soft text-ink"
            : "border border-line bg-white text-ink hover:border-plum/50"
        }`}
      >
        <User size={12} aria-hidden />
        {isPerson ? `For ${active!.name}` : "For you"}
        <ChevronDown size={11} aria-hidden className="text-ink-faint" />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-[220px] rounded-2xl border border-line bg-white p-1.5 text-left shadow-[0_16px_40px_-12px_rgba(28,34,48,.22)]">
          <button
            type="button"
            onClick={() => {
              onSelect("self");
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] hover:bg-paper ${
              !isPerson ? "font-semibold text-plum" : "text-ink"
            }`}
          >
            <User size={13} aria-hidden />
            You
          </button>
          {people.map((p) => (
            <button
              key={p.subjectId}
              type="button"
              onClick={() => {
                onSelect(p.subjectId);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] hover:bg-paper ${
                p.subjectId === activeSubjectId ? "font-semibold text-plum" : "text-ink"
              }`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-plum-wash text-[10px] font-semibold text-plum-dark">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 truncate">
                {p.name}
                {p.relationship && <span className="text-ink-faint"> · {p.relationship}</span>}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
            className="mt-1 block w-full border-t border-line px-2.5 pb-1.5 pt-2.5 text-left text-[13.5px] font-medium text-plum hover:text-plum-dark"
          >
            + New profile
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The single "Shopping with" card: recipient, the extracted constraints
 * (budget, ship-to, deadline, exclusions), interest facts, and "+ Add details".
 * Editing or removing a chip issues a plain-language refine turn (or a structured
 * fact op), so the ledger stays the single source of truth.
 */
export function FilterBar({
  view,
  busy,
  onRefine,
  subjects,
  activeSubjectId,
  onSelectSubject,
  onNewProfile,
  onRemoveFact,
  onAddDetails,
}: {
  view: LedgerView | null;
  busy: boolean;
  onRefine: (message: string) => void;
  /** Subjects for the recipient switcher. Omit to hide the recipient chip. */
  subjects?: SubjectSummary[];
  activeSubjectId?: string;
  onSelectSubject?: (id: string) => void;
  onNewProfile?: () => void;
  /** Remove a learned interest fact by id. */
  onRemoveFact?: (factId: string, value: string) => void;
  /** Opens the details drawer. Renders the "+ Add details" affordance when set. */
  onAddDetails?: () => void;
}) {
  const c = view?.constraints ?? null;
  const budget = c ? formatBudget(c) : null;
  const currency = c?.currency ?? "INR";
  const postal = postalFormat(c?.country ?? null);
  // Interest-style facts read as chips ("Loves F1"); skip constraint-ish keys.
  const facts = (view?.facts ?? []).filter((f) => !/^(budget|deadline|country|postal)/.test(f.key));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-cream/70 px-4 py-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        <SlidersHorizontal size={13} aria-hidden />
        Shopping with
      </span>

      {subjects && activeSubjectId && onSelectSubject && onNewProfile && (
        <SubjectChip
          subjects={subjects}
          activeSubjectId={activeSubjectId}
          busy={busy}
          onSelect={onSelectSubject}
          onNew={onNewProfile}
        />
      )}

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

      {/* Postal code only makes sense once we know the country — its format,
          validation, name (PIN/ZIP/postcode), and placeholder all depend on it. */}
      {c?.country && (
        <EditableChip
          icon={<Hash size={12} />}
          label={postalTerm(c.country)}
          value={c.postalCode ?? null}
          placeholder={postal?.example ? `e.g. ${postal.example}` : `Add ${postalTerm(c.country)}`}
          busy={busy}
          numeric={postal?.numeric ?? false}
          maxLength={postal?.maxLength}
          validate={(raw) => validatePostalCode(c.country, raw)}
          onCommit={(raw) => onRefine(`My ${postalTerm(c.country)} is ${raw}.`)}
        />
      )}

      {facts.map((fact) =>
        onRemoveFact ? (
          <button
            key={fact.id}
            type="button"
            disabled={busy}
            onClick={() => onRemoveFact(fact.id, fact.value)}
            title={`Remove "${fact.value}"`}
            className="group inline-flex items-center gap-1.5 rounded-full bg-butter-soft px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-butter disabled:opacity-50"
          >
            {fact.value}
            <X size={11} aria-hidden className="text-ink-soft group-hover:text-ink" />
          </button>
        ) : (
          <span
            key={fact.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-butter-soft px-3 py-1 text-xs font-medium text-ink"
          >
            {fact.value}
          </span>
        ),
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

      {onAddDetails && (
        <button
          type="button"
          onClick={onAddDetails}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-transparent px-3 py-1 text-xs font-medium text-plum transition-colors hover:border-plum hover:bg-plum-wash"
        >
          <Plus size={12} aria-hidden />
          Add details
        </button>
      )}
    </div>
  );
}
