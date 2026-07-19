"use client";

import { useState } from "react";
import { Check, ChevronDown, HeartHandshake, Pencil, X } from "lucide-react";
import type { ExpertLensId, LedgerConstraints, LedgerFact, LedgerView } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";

const PORTRAIT_TITLES: Record<ExpertLensId, string> = {
  gift: "Recipient Portrait",
  skincare: "Skin Profile",
  style: "Style Read",
  nutrition: "Nutrition Snapshot",
};

function formatBudget(constraints: LedgerConstraints): string | null {
  const { budgetMinMinor: min, budgetMaxMinor: max, currency } = constraints;
  if (min != null && max != null) {
    return `${formatMinor(min, currency)} – ${formatMinor(max, currency)}`;
  }
  if (max != null) return `up to ${formatMinor(max, currency)}`;
  if (min != null) return `from ${formatMinor(min, currency)}`;
  return null;
}

function groupFacts(facts: LedgerFact[]): Array<[string, LedgerFact[]]> {
  const map = new Map<string, LedgerFact[]>();
  for (const fact of facts) {
    const segment = fact.key.split(".")[0] || "notes";
    const existing = map.get(segment);
    if (existing) existing.push(fact);
    else map.set(segment, [fact]);
  }
  return Array.from(map.entries());
}

function ProvenanceBadge({ fact }: { fact: LedgerFact }) {
  if (fact.provenance === "said") {
    return (
      <span
        title={fact.quote ? `Your words: “${fact.quote}”` : undefined}
        className="shrink-0 rounded-full bg-plum px-1.5 py-0.5 text-[10px] font-medium text-white"
      >
        you said
      </span>
    );
  }
  if (fact.provenance === "inferred") {
    return (
      <span className="shrink-0 rounded-full border border-dashed border-plum/60 px-1.5 py-0.5 text-[10px] font-medium text-plum">
        my guess
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
      assumed
    </span>
  );
}

/**
 * The Living Portrait — a view over the session ledger. Every fact carries a
 * provenance badge and is tap-to-correct; consents are visible and revocable.
 */
export function PortraitPanel({
  lens,
  view,
  busy,
  collapsed = false,
  onToggleCollapsed,
  onCorrectFact,
  onRemoveFact,
  onRevokeConsent,
}: {
  lens: ExpertLensId | null;
  view: LedgerView | null;
  /** True while a turn is streaming — edits are disabled to avoid racing it. */
  busy: boolean;
  /** Collapsed to its header only — used when it shares the side panel with the board. */
  collapsed?: boolean;
  /** Supply to make the header a disclosure toggle; omit for a plain heading. */
  onToggleCollapsed?: () => void;
  onCorrectFact: (factId: string, newValue: string) => void;
  onRemoveFact: (factId: string, value: string) => void;
  onRevokeConsent: (category: string) => void;
}) {
  const [editing, setEditing] = useState<{ factId: string; value: string } | null>(null);

  const title = lens ? PORTRAIT_TITLES[lens] : "Living Portrait";
  const budget = view ? formatBudget(view.constraints) : null;
  const hasConstraints =
    view != null &&
    (budget != null ||
      view.constraints.country != null ||
      view.constraints.deadline != null ||
      view.constraints.exclusions.length > 0);
  const isEmpty =
    view == null ||
    (view.facts.length === 0 &&
      !hasConstraints &&
      view.careFlags.length === 0 &&
      view.consents.length === 0);

  const submitEdit = () => {
    if (!editing) return;
    const next = editing.value.trim();
    if (next.length > 0) onCorrectFact(editing.factId, next);
    setEditing(null);
  };

  const factCount = view?.facts.length ?? 0;
  const heading = (
    <h2 className="font-(family-name:--font-display) text-lg font-semibold">{title}</h2>
  );

  return (
    <div className="card p-4">
      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="living-portrait-body"
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          {heading}
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
            {collapsed && factCount > 0 && (
              <span>
                {factCount} detail{factCount === 1 ? "" : "s"}
              </span>
            )}
            <ChevronDown
              size={16}
              aria-hidden
              className={`transition-transform ${collapsed ? "" : "rotate-180"}`}
            />
          </span>
        </button>
      ) : (
        heading
      )}

      {collapsed ? null : isEmpty ? (
        <p id="living-portrait-body" className="mt-2 text-sm leading-relaxed text-ink-soft">
          {"I'll build my understanding here as we talk — you can correct anything."}
        </p>
      ) : (
        <div id="living-portrait-body" className="mt-3 space-y-4">
          {groupFacts(view.facts).map(([group, facts]) => (
            <section key={group} aria-label={group}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {group}
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {facts.map((fact) => (
                  <li key={fact.id} className="flex items-start gap-1.5">
                    {editing?.factId === fact.id ? (
                      <form
                        className="flex flex-1 items-center gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitEdit();
                        }}
                      >
                        <label htmlFor={`edit-${fact.id}`} className="sr-only">
                          Correct this detail
                        </label>
                        <input
                          id={`edit-${fact.id}`}
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ factId: fact.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="field-input !px-2 !py-1 text-xs"
                        />
                        <button
                          type="submit"
                          aria-label="Save correction"
                          className="shrink-0 rounded p-1 text-ok hover:bg-sand"
                        >
                          <Check size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel editing"
                          onClick={() => setEditing(null)}
                          className="shrink-0 rounded p-1 text-ink-soft hover:bg-sand"
                        >
                          <X size={13} aria-hidden />
                        </button>
                      </form>
                    ) : (
                      <>
                        <span
                          className={`min-w-0 flex-1 text-sm leading-snug text-ink ${
                            fact.provenance === "inferred"
                              ? "underline decoration-plum/50 decoration-dotted underline-offset-4"
                              : ""
                          }`}
                          title={
                            fact.provenance === "said" && fact.quote
                              ? `Your words: “${fact.quote}”`
                              : undefined
                          }
                        >
                          {fact.value}
                        </span>
                        <ProvenanceBadge fact={fact} />
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Correct “${fact.value}”`}
                          onClick={() => setEditing({ factId: fact.id, value: fact.value })}
                          className="shrink-0 rounded p-1 text-ink-soft transition-colors hover:text-plum disabled:opacity-40"
                        >
                          <Pencil size={12} aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Remove “${fact.value}”`}
                          onClick={() => onRemoveFact(fact.id, fact.value)}
                          className="shrink-0 rounded p-1 text-ink-soft transition-colors hover:text-danger disabled:opacity-40"
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {hasConstraints && (
            <section aria-label="Constraints">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Constraints
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {budget && (
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink">
                    budget: {budget}
                  </span>
                )}
                {view.constraints.country && (
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink">
                    ships to {view.constraints.country}
                  </span>
                )}
                {view.constraints.deadline && (
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink">
                    by {view.constraints.deadline}
                  </span>
                )}
                {view.constraints.exclusions.map((exclusion) => (
                  <span
                    key={exclusion}
                    className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-ink-soft line-through"
                  >
                    {exclusion}
                  </span>
                ))}
              </div>
            </section>
          )}

          {view.careFlags.length > 0 && (
            <section aria-label="Care flags">
              <div className="flex flex-wrap gap-1.5">
                {view.careFlags.map((flag) => (
                  <span
                    key={flag.kind}
                    className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold-wash px-2 py-0.5 text-[11px] font-medium text-gold"
                  >
                    <HeartHandshake size={11} aria-hidden />
                    care mode: {flag.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {view.consents.length > 0 && (
            <section aria-label="Consents">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Your consents
              </p>
              <div className="mt-1.5 space-y-1.5">
                {/* A revoke → re-consent leaves two rows in the same category,
                    so the index (not the category) has to carry the key. */}
                {view.consents.map((consent, i) =>
                  consent.revoked ? (
                    <p
                      key={`${consent.category}-${i}`}
                      className="text-xs text-ink-soft line-through"
                    >
                      {consent.category}: revoked
                    </p>
                  ) : (
                    <div
                      key={`${consent.category}-${i}`}
                      className="flex items-start justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5"
                    >
                      <p className="text-xs leading-snug text-ink">
                        {consent.category}: opted in — “{consent.quote}”
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRevokeConsent(consent.category)}
                        className="shrink-0 text-[11px] font-medium text-plum hover:underline disabled:opacity-40"
                      >
                        revoke
                      </button>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
