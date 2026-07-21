"use client";

import { ListChecks } from "lucide-react";
import type { VerifiedPresentation, VerifiedSection } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";
import { AskCard } from "./AskCard";
import { ExpertCard } from "./ExpertCard";
import { RichText } from "./RichText";

/**
 * Renders a server-notarized presentation: agent prose, the correctable
 * assumptions strip, the picks (or a plan, when the agent chose that layout),
 * the "left out on purpose" block, the code-computed running total, and the
 * narrowing follow-up question the agent asks *while* showing its work.
 */
export function PresentationView({
  presentation,
  onPrefill,
  onMoreLike,
  onSend,
  compact = false,
}: {
  presentation: VerifiedPresentation;
  /** Prefills the composer (used by the assumptions strip). */
  onPrefill: (text: string) => void;
  /** "More like this" under a card → similarity search on that product. */
  onMoreLike: (productId: string) => void;
  /** Sends a message straight away (follow-up quick replies). */
  onSend: (text: string) => void;
  /**
   * Rail mode: the full product cards live in the results grid alongside this
   * conversation, so here we keep only the agent's reasoning (prose, plan
   * structure, compositions, total, follow-up) and drop the duplicated cards.
   */
  compact?: boolean;
}) {
  const isPlan = presentation.layout === "plan";
  const itemCount = presentation.sections.reduce((n, s) => n + s.cards.length, 0);
  // The total is denominated in the CARDS' currency, which can differ from the
  // ledger's — prefer it and only fall back to the session currency.
  const totalCurrency = presentation.totalCurrency ?? presentation.currency;

  return (
    <div className="space-y-4">
      <div className="max-w-[95%] text-sm leading-[1.6] text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink">
        <RichText text={presentation.message} />
      </div>

      {presentation.assumptions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {"Assumptions I'm making"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {presentation.assumptions.map((assumption, i) => (
              <button
                key={i}
                type="button"
                className="chip !py-1 text-xs"
                title="Tap to correct this assumption"
                onClick={() => onPrefill(`Correction: ${assumption}`)}
              >
                {assumption}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composed "looks" now render as buyable set cards in the results
          column (see LooksBoard), so they are intentionally omitted here. */}

      {isPlan ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 font-(family-name:--font-display) text-lg font-semibold">
              <ListChecks size={16} className="text-plum" aria-hidden />
              Your plan
            </h3>
            <span className="text-xs text-ink-soft">
              {presentation.sections.length} part
              {presentation.sections.length === 1 ? "" : "s"} · {itemCount} item
              {itemCount === 1 ? "" : "s"}
            </span>
          </div>

          {presentation.sections.map((section, i) => (
            <PlanPart
              key={i}
              index={i}
              section={section}
              total={presentation.sections.length}
              onMoreLike={onMoreLike}
              compact={compact}
            />
          ))}
        </div>
      ) : (
        presentation.sections.map((section, i) => {
          // In rail mode a cards-only section has nothing left to show once the
          // duplicated cards are dropped — skip it rather than leave a gap.
          if (compact && !section.title && !section.intro && section.steps.length === 0) {
            return null;
          }
          return (
            <section key={i} className="space-y-3">
              {section.title && (
                <h3 className="font-(family-name:--font-display) text-lg font-semibold">
                  {section.title}
                </h3>
              )}
              {section.intro && (
                <p className="text-sm leading-relaxed text-ink-soft">{section.intro}</p>
              )}

              {section.steps.length > 0 && <StepList steps={section.steps} />}

              {!compact && section.cards.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.cards.map((card) => (
                    <ExpertCard key={card.productId} card={card} onMoreLike={onMoreLike} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {presentation.leftOut.length > 0 && (
        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-sm font-medium text-ink">What I left out on purpose</p>
          <ul className="mt-1.5 space-y-1 text-sm leading-snug text-ink-soft">
            {presentation.leftOut.map((entry, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{entry.item}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {presentation.droppedCards > 0 && (
        <p className="text-xs italic text-ink-soft">
          {presentation.droppedCards} pick{presentation.droppedCards === 1 ? "" : "s"} couldn&apos;t
          be verified against listing evidence and {presentation.droppedCards === 1 ? "was" : "were"}{" "}
          left out.
        </p>
      )}

      {presentation.totalMinor != null &&
        (isPlan ? (
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-plum/25 bg-plum-wash px-4 py-3 shadow-sm">
            <span className="text-sm font-medium text-ink">
              Plan total
              <span className="ml-2 text-xs font-normal text-ink-soft">
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </span>
            </span>
            <span className="font-(family-name:--font-display) text-lg font-semibold text-plum">
              {formatMinor(presentation.totalMinor, totalCurrency)}
            </span>
          </div>
        ) : (
          <p className="text-sm font-semibold text-ink">
            Total: {formatMinor(presentation.totalMinor, totalCurrency)}
          </p>
        ))}

      {presentation.followUp && (
        <AskCard
          text={presentation.followUp.text}
          fork={presentation.followUp.fork}
          quickReplies={presentation.followUp.quickReplies}
          onReply={onSend}
        />
      )}
    </div>
  );
}

function StepList({ steps }: { steps: VerifiedSection["steps"] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, j) => (
        <li key={j} className="flex gap-3 rounded-lg bg-sand/50 px-3 py-2 text-sm leading-snug">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-plum text-[11px] font-semibold text-white"
          >
            {j + 1}
          </span>
          <span>
            {step.text}
            {step.why && <span className="mt-0.5 block text-xs text-ink-soft">{step.why}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One part of a dynamic plan. Section titles come from the agent — nothing
 * here assumes a fixed set of plan stages.
 */
function PlanPart({
  section,
  index,
  total,
  onMoreLike,
  compact = false,
}: {
  section: VerifiedSection;
  index: number;
  total: number;
  onMoreLike: (productId: string) => void;
  compact?: boolean;
}) {
  return (
    <section
      className="rounded-xl border border-line bg-white p-4"
      aria-label={section.title ?? `Plan part ${index + 1}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="font-(family-name:--font-display) font-semibold">
          {section.title ?? `Part ${index + 1}`}
        </h4>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
          step {index + 1} of {total}
        </span>
      </div>

      {section.intro && (
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{section.intro}</p>
      )}

      {section.steps.length > 0 && (
        <div className="mt-3">
          <StepList steps={section.steps} />
        </div>
      )}

      {!compact && section.cards.length > 0 && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {section.cards.map((card) => (
            <ExpertCard key={card.productId} card={card} onMoreLike={onMoreLike} />
          ))}
        </div>
      )}

      {compact && section.cards.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          {section.cards.length} option{section.cards.length === 1 ? "" : "s"} in the results →
        </p>
      )}
    </section>
  );
}
