"use client";

import { ShoppingBag, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { OUTCOMES, type Outcome } from "@/lib/personalization/types";

/**
 * The single question we ask after a shopper acts on a recommendation.
 *
 * Design note — why outcomes beat more questions:
 * "did this work out?" is worth more than any amount of preference elicitation,
 * because it grades the recommendation rather than the shopper's self-report.
 * One tap here teaches the system something no profile question can.
 *
 * Design note — three choices, always dismissible:
 * the full Outcome union has eight members, but a shopper mid-flow will not
 * read eight buttons. We surface the three that cover the common case and let
 * richer outcomes (returned/kept/tolerated) be captured later, in context, by
 * the Personalization Center. The "x" is a real button and nothing here blocks
 * the page — an unanswered prompt costs the shopper nothing.
 */

/** Constrained to the Outcome union, so a typo here is a compile error. */
type SurfacedOutcome = Extract<(typeof OUTCOMES)[number], "liked" | "rejected" | "purchased">;

const CHOICES: ReadonlyArray<{
  outcome: SurfacedOutcome;
  label: string;
  icon: typeof ThumbsUp;
  hoverClass: string;
}> = [
  { outcome: "liked", label: "Liked it", icon: ThumbsUp, hoverClass: "hover:border-ok hover:text-ok" },
  {
    outcome: "rejected",
    label: "Not for me",
    icon: ThumbsDown,
    hoverClass: "hover:border-danger hover:text-danger",
  },
  {
    outcome: "purchased",
    label: "Bought it",
    icon: ShoppingBag,
    hoverClass: "hover:border-plum hover:text-plum",
  },
];

export interface OutcomePromptProps {
  productTitle: string;
  onOutcome: (outcome: Outcome) => void;
  onDismiss: () => void;
  busy?: boolean;
}

export function OutcomePrompt({
  productTitle,
  onOutcome,
  onDismiss,
  busy = false,
}: OutcomePromptProps) {
  return (
    <aside
      aria-label="Feedback on a recommendation"
      className="card relative flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 pr-6 sm:pr-0">
        <p className="font-(family-name:--font-display) text-sm text-ink">Did this work out?</p>
        <p className="mt-0.5 truncate text-xs text-ink-soft" title={productTitle}>
          {productTitle}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHOICES.map(({ outcome, label, icon: Icon, hoverClass }) => (
          <button
            key={outcome}
            type="button"
            disabled={busy}
            onClick={() => onOutcome(outcome)}
            className={`chip disabled:cursor-not-allowed disabled:opacity-50 ${hoverClass}`}
          >
            <Icon size={13} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss this question"
        title="Dismiss"
        className="absolute top-3 right-3 rounded-full p-1 text-ink-soft/60 transition-colors hover:bg-cream-deep hover:text-ink sm:static sm:ml-1"
      >
        <X size={14} aria-hidden />
      </button>
    </aside>
  );
}

export default OutcomePrompt;
