"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { PersonalizationSignal } from "@/lib/personalization/ledger-bridge";

/**
 * The "Personalized because…" strip: a one-line, honest account of which
 * remembered facts shaped the recommendations directly beneath it.
 *
 * Design note — why this exists at all:
 * personalization that can't be seen can't be trusted or corrected. Showing the
 * actual signals turns "how did it know that?" into "ah, because I said that" —
 * and gives the shopper a one-click route to fix anything wrong.
 *
 * Design note — inferred signals are marked, not hidden:
 * a guess rendered as a fact is how a system loses credibility. Inferred and
 * behavioural signals carry a gold dot and say so on hover, so the shopper
 * knows which of these they actually told us.
 *
 * Design note — renders nothing when empty:
 * a new shopper has no signals, and an empty "Personalized because…" label
 * would be pure clutter plus an implied promise we haven't earned yet.
 */

export interface PersonalizedBecauseProps {
  signals: PersonalizationSignal[];
  /** Optional in-place handler; without it the strip links to /personalization. */
  onManage?: () => void;
}

export function PersonalizedBecause({ signals, onManage }: PersonalizedBecauseProps) {
  if (signals.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5 font-medium text-ink-soft">
        <Sparkles size={13} className="text-plum" aria-hidden />
        Personalized because…
      </span>

      <ul className="flex flex-wrap items-center gap-1.5">
        {signals.map((signal) => (
          <li key={signal.factId}>
            <span
              title={
                signal.needsConfirmation
                  ? "Inferred — confirm or correct in your profile"
                  : `You told us: ${signal.label} — ${signal.value}`
              }
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-ink-soft"
            >
              {signal.needsConfirmation && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-gold"
                />
              )}
              <span className="truncate">
                <span className="text-ink-soft/80">{signal.label}:</span>{" "}
                <span className="font-medium text-ink">{signal.value}</span>
              </span>
              {signal.needsConfirmation && <span className="sr-only">(inferred, unconfirmed)</span>}
            </span>
          </li>
        ))}
      </ul>

      {onManage ? (
        <button
          type="button"
          onClick={onManage}
          className="text-plum underline underline-offset-4 transition-colors hover:text-plum-dark"
        >
          Manage
        </button>
      ) : (
        <Link
          href="/personalization"
          className="text-plum underline underline-offset-4 transition-colors hover:text-plum-dark"
        >
          Manage
        </Link>
      )}
    </div>
  );
}

export default PersonalizedBecause;
