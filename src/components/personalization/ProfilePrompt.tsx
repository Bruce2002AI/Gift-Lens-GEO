"use client";

import { useMemo, useState } from "react";
import { HelpCircle, Lock } from "lucide-react";
import { MINOR_UNIT_SUFFIX, type ProfileQuestion } from "@/lib/personalization/questions";
import type { FactValue } from "@/lib/personalization/types";

/**
 * One progressive-profiling question, rendered as the lowest-friction control
 * that can capture it.
 *
 * Design note — why a single question per component:
 * this is deliberately not a form. It gets dropped inline next to whatever the
 * shopper is already looking at, and answering it is one tap. The caller
 * decides how many to show (see `nextQuestions`), and the answer is persisted
 * by the caller — there is no fetching in here, which keeps the control usable
 * inside a conversation, a sidebar or the Personalization Center alike.
 *
 * Design note — Skip is always present and never penalised:
 * a question you cannot decline is an interrogation. Skip is a real, reachable
 * button, not a greyed-out afterthought.
 */

/** Sliders on `*_minor` keys store minor units but must READ as major ones. */
function readSlider(q: ProfileQuestion, raw: number): string {
  const isMoney = q.key.endsWith(MINOR_UNIT_SUFFIX);
  const shown = isMoney ? Math.round(raw / 100) : raw;
  return q.unit ? `${shown} ${q.unit}` : String(shown);
}

function sliderDefault(q: ProfileQuestion): number {
  const min = q.min ?? 0;
  const max = q.max ?? 100;
  const step = q.step ?? 1;
  const mid = min + (max - min) / 2;
  return Math.round(mid / step) * step;
}

export interface ProfilePromptProps {
  question: ProfileQuestion;
  onAnswer: (value: FactValue) => void;
  onSkip: () => void;
  busy?: boolean;
}

export function ProfilePrompt({ question, onAnswer, onSkip, busy = false }: ProfilePromptProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [sliderValue, setSliderValue] = useState<number>(() => sliderDefault(question));
  const [sliderTouched, setSliderTouched] = useState(false);
  const [askedId, setAskedId] = useState(question.id);

  // Callers often render this component in a fixed slot and swap the question
  // as each one is answered. Resetting on id change means a new question can
  // never inherit the previous answer's selection.
  if (askedId !== question.id) {
    setAskedId(question.id);
    setSelected([]);
    setSliderValue(sliderDefault(question));
    setSliderTouched(false);
  }

  const options = useMemo(() => question.options ?? [], [question.options]);
  const isHealth = question.sensitivity === "health";

  const hasValue =
    question.kind === "slider" ? sliderTouched : selected.length > 0;

  const toggle = (option: string) => {
    setSelected((prev) => {
      if (question.multi) {
        return prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option];
      }
      return prev[0] === option ? [] : [option];
    });
  };

  const save = () => {
    if (busy || !hasValue) return;
    if (question.kind === "slider") {
      onAnswer(sliderValue);
      return;
    }
    onAnswer(question.multi ? selected : selected[0]);
  };

  const chipClass = (active: boolean) =>
    active
      ? "chip border-plum bg-plum-wash font-medium text-plum"
      : "chip";

  return (
    <div className="card p-4 sm:p-5">
      <fieldset disabled={busy} className="min-w-0">
        <legend className="font-(family-name:--font-display) text-base text-ink sm:text-lg">
          {question.prompt}
        </legend>

        {isHealth && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <Lock size={12} aria-hidden />
            Kept private to this lens.
          </p>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Toggle buttons rather than a radiogroup: real <button>s are already
            tab-reachable and Space/Enter-activated, whereas role="radio" would
            promise arrow-key roving we don't implement. */}
        {question.kind === "chips" && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={question.prompt}>
            {options.map((option) => {
              const active = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggle(option)}
                  aria-pressed={active}
                  className={chipClass(active)}
                >
                  {option}
                </button>
              );
            })}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {question.kind === "choice" && (
          <div
            className="mt-3 inline-flex w-full flex-wrap overflow-hidden rounded-full border border-line bg-white sm:w-auto sm:flex-nowrap"
            role="group"
            aria-label={question.prompt}
          >
            {options.map((option, i) => {
              const active = selected[0] === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(option)}
                  className={[
                    "flex-1 px-4 py-2 text-sm whitespace-nowrap transition-colors",
                    i > 0 ? "border-l border-line" : "",
                    active
                      ? "bg-plum font-medium text-white"
                      : "text-ink-soft hover:bg-plum-wash hover:text-plum",
                  ].join(" ")}
                >
                  {option}
                </button>
              );
            })}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {question.kind === "slider" && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`q-${question.id}`} className="field-label mb-0">
                Your answer
              </label>
              <output
                htmlFor={`q-${question.id}`}
                aria-live="polite"
                className="font-(family-name:--font-display) text-lg text-plum"
              >
                {readSlider(question, sliderValue)}
              </output>
            </div>
            <input
              id={`q-${question.id}`}
              type="range"
              min={question.min ?? 0}
              max={question.max ?? 100}
              step={question.step ?? 1}
              value={sliderValue}
              onChange={(e) => {
                setSliderValue(Number(e.target.value));
                setSliderTouched(true);
              }}
              className="mt-2 w-full accent-plum"
            />
            <div className="mt-1 flex justify-between text-xs text-ink-soft">
              <span>{readSlider(question, question.min ?? 0)}</span>
              <span>{readSlider(question, question.max ?? 100)}</span>
            </div>
          </div>
        )}
      </fieldset>

      {/* ------------------------------------------------------------------ */}
      <details className="group mt-4">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft transition-colors hover:text-plum">
          <HelpCircle size={13} aria-hidden />
          Why we ask this
        </summary>
        <p className="mt-2 max-w-prose rounded-lg bg-cream-deep px-3 py-2 text-xs leading-relaxed text-ink-soft">
          {question.why}
        </p>
      </details>

      <div className="mt-4 flex items-center gap-3">
        {hasValue && (
          <button type="button" className="btn-primary text-sm" onClick={save} disabled={busy}>
            Save
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-sm text-ink-soft underline underline-offset-4 transition-colors hover:text-plum disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default ProfilePrompt;
