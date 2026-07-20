"use client";

import { Layers, ListChecks, MessageCircleQuestion } from "lucide-react";
import type {
  VerifiedBoardItem,
  VerifiedComposition,
  VerifiedPresentation,
  VerifiedSection,
} from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinor } from "@/lib/gift/currency";
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
  accentClass,
  boardIndex,
  onPrefill,
  onMoreLike,
  onSend,
  compact = false,
}: {
  presentation: VerifiedPresentation;
  /** border-left accent class matching the active lens. */
  accentClass: string;
  /**
   * productId → board item, accumulated across turns by the page. Compositions
   * reference board products by id; anything missing is skipped silently.
   */
  boardIndex: Map<string, VerifiedBoardItem>;
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
      <div
        className={`max-w-[95%] rounded-2xl border-l-2 bg-sand px-4 py-3 text-sm leading-relaxed text-ink ${accentClass}`}
      >
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

      {presentation.compositions.length > 0 && (
        <CompositionStrip compositions={presentation.compositions} boardIndex={boardIndex} />
      )}

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
        <div
          className={`max-w-[95%] rounded-2xl border-l-2 bg-sand px-4 py-3 text-sm leading-relaxed text-ink ${accentClass}`}
        >
          <p className="flex items-start gap-2">
            <MessageCircleQuestion size={15} className="mt-0.5 shrink-0 text-plum" aria-hidden />
            <span className="whitespace-pre-wrap">{presentation.followUp.text}</span>
          </p>
          {presentation.followUp.fork && (
            <p className="mt-1.5 pl-6 text-xs italic text-ink-soft">
              asking because: {presentation.followUp.fork.ifA} → {presentation.followUp.fork.thenA} ·{" "}
              {presentation.followUp.fork.ifB} → {presentation.followUp.fork.thenB}
            </p>
          )}
          {presentation.followUp.quickReplies.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
              {presentation.followUp.quickReplies.map((reply, i) => (
                <button
                  key={i}
                  type="button"
                  className="chip !bg-white !py-1 text-xs"
                  onClick={() => onSend(reply)}
                >
                  {reply}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The composed looks/stages: complete outfits, routines or plans assembled
 * from board products. Members are resolved out of the accumulated board —
 * an id the board doesn't (yet) carry is dropped rather than rendered blank.
 */
function CompositionStrip({
  compositions,
  boardIndex,
}: {
  compositions: VerifiedComposition[];
  boardIndex: Map<string, VerifiedBoardItem>;
}) {
  const resolved = compositions
    .map((composition) => ({
      composition,
      members: composition.productIds
        .map((id) => boardIndex.get(id))
        .filter((item): item is VerifiedBoardItem => item != null),
    }))
    .filter((entry) => entry.members.length > 0);

  if (resolved.length === 0) return null;

  return (
    <section aria-label="Ways to put it together" className="space-y-3">
      <h3 className="inline-flex items-center gap-1.5 font-(family-name:--font-display) text-lg font-semibold">
        <Layers size={16} className="text-plum" aria-hidden />
        Ways to put it together
        <span className="text-xs font-normal text-ink-soft">
          {resolved.length} option{resolved.length === 1 ? "" : "s"}
        </span>
      </h3>

      {resolved.map(({ composition, members }, i) => {
        const currency = members[0]?.currency ?? null;
        const priced = members.every(
          (member) => member.priceMinor != null && member.currency === currency,
        );
        const totalMinor = priced
          ? members.reduce((sum, member) => sum + (member.priceMinor ?? 0), 0)
          : null;

        return (
          <article key={i} className="rounded-xl border border-plum/25 bg-plum-wash/60 p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h4 className="font-(family-name:--font-display) font-semibold text-ink">
                {composition.name}
              </h4>
              {totalMinor != null && (
                <span className="text-sm font-semibold text-plum">
                  {formatMinor(totalMinor, currency)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{composition.rationale}</p>

            <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {members.map((member) => (
                <li key={member.productId} className="w-24 shrink-0">
                  <ProductImage
                    src={member.imageUrl}
                    alt={member.title}
                    className="aspect-square w-full rounded-lg"
                  />
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink">
                    {member.title}
                  </p>
                  <p className="text-[11px] font-semibold text-ink">
                    {formatMinor(member.priceMinor, member.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
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
