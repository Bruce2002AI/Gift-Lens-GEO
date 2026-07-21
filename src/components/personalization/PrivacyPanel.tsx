"use client";

import { useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";

interface PrivacyPanelProps {
  onReset: () => void;
  busy: boolean;
  counts?: { facts: number; records: number; outcomes: number };
}

/**
 * What we keep, why, and the control to erase it.
 *
 * The delete button is deliberately two-step: an irreversible action should
 * take a second, intentional click rather than a single stray one.
 */
export function PrivacyPanel({ onReset, busy, counts }: PrivacyPanelProps) {
  const [confirming, setConfirming] = useState(false);

  const total = counts ? counts.facts + counts.records + counts.outcomes : null;

  return (
    <section className="card mt-10 p-5 sm:p-6" aria-labelledby="privacy-heading">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-plum-wash text-plum">
          <ShieldCheck size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2
            id="privacy-heading"
            className="font-(family-name:--font-display) text-xl font-semibold"
          >
            Your data
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            We store what you tell the expert — preferences, sizes, budgets, the
            people you shop for — so recommendations reflect you instead of
            starting from scratch each session. Facts stay inside the lens you
            gave them to unless you switch a fact to “All lenses”. Health data
            never crosses lenses.
          </p>

          <ul className="mt-3 space-y-1 text-sm text-ink-soft">
            <li>Every fact shows where it came from, and you can edit or delete any of it.</li>
            <li>Anything the expert guessed is marked “Inferred” until you confirm it.</li>
            <li>Nothing here is sold or shared with other shoppers.</li>
          </ul>

          {counts && (
            <p className="mt-3 text-sm text-ink-soft">
              Currently stored:{" "}
              <span className="font-medium text-ink">{counts.facts}</span>{" "}
              {counts.facts === 1 ? "fact" : "facts"},{" "}
              <span className="font-medium text-ink">{counts.records}</span>{" "}
              {counts.records === 1 ? "entry" : "entries"},{" "}
              <span className="font-medium text-ink">{counts.outcomes}</span>{" "}
              {counts.outcomes === 1 ? "activity event" : "activity events"}.
            </p>
          )}

          <div className="mt-4 border-t border-line pt-4">
            {confirming ? (
              <div
                className="flex flex-wrap items-center gap-3"
                role="alertdialog"
                aria-labelledby="reset-confirm-text"
              >
                <p
                  id="reset-confirm-text"
                  className="text-sm font-medium text-danger"
                >
                  Are you sure? This permanently deletes
                  {total != null ? ` all ${total} stored items` : " everything we've stored"} and
                  cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary !bg-danger !px-4 !py-2 text-sm hover:!bg-danger/85"
                    onClick={() => {
                      setConfirming(false);
                      onReset();
                    }}
                    disabled={busy}
                  >
                    {busy ? "Deleting…" : "Yes, delete everything"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary !px-4 !py-2 text-sm"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                  >
                    Keep my data
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary !px-4 !py-2 text-sm hover:!border-danger hover:!text-danger"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                <Trash2 size={14} aria-hidden />
                Delete all my personalization
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
