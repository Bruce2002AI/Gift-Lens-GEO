"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, CheckCircle2, Loader2, RotateCcw, Send, ShieldAlert } from "lucide-react";
import type { AgentResponse, Blueprint, ModeMeta, ShoppingModeId } from "@/lib/modes/types";
import type { TraceEvent } from "@/lib/catalog/types";
import { ALL_MODE_META, MODE_META } from "@/lib/modes/meta";
import { RecommendationCard } from "@/components/gift/RecommendationCard";
import { ProductDetail } from "@/components/gift/ProductDetail";
import { PlanView } from "@/components/agent/PlanView";
import { modeIcon } from "@/components/agent/mode-icons";
import { SourceBanner } from "@/components/catalog/SourceBanner";
import { TracePanel } from "@/components/catalog/TracePanel";

const SAVED_KEY = "shoplens.saved";
const INITIAL_PICKS_VISIBLE = 12;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function ShopPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinnedMode, setPinnedMode] = useState<ShoppingModeId | null>(null);
  const [resp, setResp] = useState<AgentResponse | null>(null);
  const [pendingBlueprint, setPendingBlueprint] = useState<Blueprint | null>(null);
  const [clarCount, setClarCount] = useState(0);
  const [visiblePicks, setVisiblePicks] = useState(INITIAL_PICKS_VISIBLE);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [form, setForm] = useState({ budgetMax: "", currency: "", country: "", occasion: "" });

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(SAVED_KEY) ?? localStorage.getItem("giftlens.saved");
        if (raw) setSavedIds(JSON.parse(raw));
      } catch {
        /* corrupted storage — start fresh */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  const toggleSave = useCallback((productId: string) => {
    setSavedIds((prev) => {
      const next = prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const appendTrace = useCallback((events: TraceEvent[]) => {
    setTrace((prev) => [...prev, ...events]);
  }, []);

  const formPayload = () => ({
    budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
    currency: form.currency ? form.currency.toUpperCase() : null,
    country: form.country ? form.country.toUpperCase() : null,
    occasion: form.occasion || null,
  });

  const callAgent = async (
    conversation: ChatMessage[],
    opts: { approved?: boolean; blueprint?: Blueprint | null; modeId?: ShoppingModeId } = {},
  ): Promise<AgentResponse | null> => {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation,
        form: formPayload(),
        modeId: opts.modeId ?? pinnedMode ?? undefined,
        clarificationCount: clarCount,
        approved: opts.approved ?? false,
        blueprint: opts.blueprint ?? undefined,
      }),
    });
    const json = (await res.json()) as AgentResponse & { error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Something went wrong. Please retry.");
      return null;
    }
    return json;
  };

  const applyResponse = (json: AgentResponse) => {
    setResp(json);
    setTrace(json.trace ?? []);
    setVisiblePicks(INITIAL_PICKS_VISIBLE);
    const meta = MODE_META[json.modeId];

    if (json.stage === "clarification") {
      setClarCount((c) => c + 1);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: json.clarificationQuestion ?? "Could you tell me a little more?" },
      ]);
      return;
    }
    if (json.resultKind === "plan" && json.stage === "plan_approval") {
      // Mid-flow — do NOT reset the clarification budget here, or the approval
      // round-trip could be re-intercepted by the clarification gate.
      setPendingBlueprint(json.blueprint ?? null);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Here's a ${meta.name} plan I'd suggest. Take a look — tweak or approve it and I'll find real products for each part.`,
        },
      ]);
      return;
    }
    // A FINAL result (picks or plan) ends the current topic — reset the
    // clarification budget so it never bleeds into a later, unrelated request.
    setClarCount(0);
    if (json.resultKind === "picks") {
      const n = json.recommendations.length;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            n > 0
              ? `Okay — I found ${n} ${meta.short.toLowerCase()} option${n === 1 ? "" : "s"} that clear your must-haves. My favorites are up top. Want them tweaked? Just say the word.`
              : "Hmm, nothing cleared every must-have — try nudging the budget or dropping a constraint.",
        },
      ]);
      return;
    }
    // plan result
    setMessages((m) => [
      ...m,
      { role: "assistant", content: `Here's your ${meta.name} plan with a real product for each part.` },
    ]);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setLoading(true);
    try {
      // Every fresh message is unapproved — plan modes must (re)show their
      // blueprint for approval before any live search.
      const json = await callAgent(next);
      if (json) applyResponse(json);
    } catch {
      setError("Could not reach the server — is the dev server running?");
    } finally {
      setLoading(false);
    }
  };

  const approvePlan = async () => {
    if (!resp || !pendingBlueprint || loading) return;
    setError(null);
    setLoading(true);
    setMessages((m) => [...m, { role: "user", content: "Looks good — find the products." }]);
    try {
      const json = await callAgent(messages, {
        approved: true,
        blueprint: pendingBlueprint,
        modeId: resp.modeId,
      });
      if (json) {
        setPendingBlueprint(null);
        applyResponse(json);
      }
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const refineWith = (chip: string) => send(chip);

  const pickMode = (id: ShoppingModeId) => {
    setPinnedMode(id);
    if (messages.length === 0) setInput(MODE_META[id].examplePrompt);
  };

  const reset = () => {
    setMessages([]);
    setResp(null);
    setPendingBlueprint(null);
    setClarCount(0);
    setTrace([]);
    setError(null);
    setPinnedMode(null);
    setInput("");
  };

  const activeMeta: ModeMeta | null = resp ? MODE_META[resp.modeId] : pinnedMode ? MODE_META[pinnedMode] : null;
  const picks =
    resp?.resultKind === "picks" && resp.stage === "recommendations" ? resp.recommendations : [];
  const plan = resp?.resultKind === "plan" && resp.stage === "plan" ? resp.plan : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-(family-name:--font-display) text-3xl font-semibold">ShopLens</h1>
          <p className="mt-1 text-ink-soft">
            One AI shopping agent, many lenses. Describe what you need — it picks the right lens.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="btn-secondary !py-2 text-sm">
            <Bookmark size={15} aria-hidden /> Saved ({savedIds.length})
          </span>
          {messages.length > 0 && (
            <button type="button" onClick={reset} className="btn-secondary !py-2 text-sm">
              <RotateCcw size={15} aria-hidden /> Start over
            </button>
          )}
        </div>
      </header>

      {/* Mode picker */}
      <div className="mb-6 flex flex-wrap gap-2" aria-label="Choose a lens">
        {ALL_MODE_META.map((m) => {
          const Icon = modeIcon(m.icon);
          const active = (activeMeta?.id ?? pinnedMode) === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => pickMode(m.id)}
              title={m.tagline}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-plum bg-plum text-white"
                  : "border-line bg-white text-ink hover:border-plum/40"
              }`}
            >
              <Icon size={14} aria-hidden />
              {m.short}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Left: chat */}
        <section aria-label="Conversation" className="flex flex-col gap-4">
          <div className="card flex min-h-[320px] flex-col p-4">
            <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite">
              {messages.length === 0 && (
                <div className="space-y-3 text-sm text-ink-soft">
                  <p>Try a lens above, or just describe what you need:</p>
                  <div className="flex flex-col items-start gap-2">
                    {["Anniversary gift for my partner who loves coffee, ₹5000",
                      "Simple skincare routine for dry sensitive skin, no fragrance, under ₹3000",
                      "Smart-casual first-date outfit under ₹12000",
                      "Warm Scandinavian small bedroom for ₹20000"].map((p) => (
                      <button key={p} type="button" className="chip text-left" onClick={() => send(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={`${msg.role}-${i}`}
                  className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user" ? "ml-auto bg-plum text-white" : "bg-sand text-ink"
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {loading && (
                <div className="rounded-2xl bg-sand px-4 py-3 text-sm text-ink-soft" role="status">
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                    Working on it…
                  </span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <label htmlFor="shop-input" className="sr-only">
                Describe what you need
              </label>
              <textarea
                id="shop-input"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="e.g. Beginner pour-over coffee kit under ₹8,000"
                className="field-input min-h-[52px] flex-1 resize-none"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="btn-primary !px-3 !py-3"
              >
                <Send size={16} aria-hidden />
              </button>
            </form>
          </div>

          <details className="card p-4" open={messages.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Optional details (budget, destination…)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="f-budget" className="field-label">Max budget</label>
                <input id="f-budget" type="number" min="0" inputMode="numeric" className="field-input" placeholder="4000"
                  value={form.budgetMax} onChange={(e) => setForm({ ...form, budgetMax: e.target.value })} />
              </div>
              <div>
                <label htmlFor="f-currency" className="field-label">Currency</label>
                <input id="f-currency" maxLength={3} className="field-input uppercase" placeholder="INR"
                  value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </div>
              <div>
                <label htmlFor="f-country" className="field-label">Country</label>
                <input id="f-country" maxLength={2} className="field-input uppercase" placeholder="IN"
                  value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
              <div>
                <label htmlFor="f-occasion" className="field-label">Occasion / goal</label>
                <input id="f-occasion" className="field-input" placeholder="housewarming"
                  value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} />
              </div>
            </div>
          </details>
        </section>

        {/* Right: results */}
        <section aria-label="Results" className="flex flex-col gap-4">
          {resp && <SourceBanner source={resp.source} aiMode={resp.aiMode} />}

          {resp?.disclaimer && (
            <p className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink" role="note">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              {resp.disclaimer}
            </p>
          )}

          {/* Plan approval */}
          {resp?.resultKind === "plan" && resp.stage === "plan_approval" && pendingBlueprint && (
            <div className="card p-5">
              <h2 className="font-(family-name:--font-display) text-lg font-semibold">
                Proposed plan
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Review the components — approve to search live products for each.
              </p>
              <ul className="mt-4 space-y-2">
                {pendingBlueprint.components.map((c) => (
                  <li key={c.key} className="flex gap-3 rounded-lg bg-sand/50 px-3 py-2">
                    <span className="mt-0.5 text-plum">
                      <CheckCircle2 size={16} aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-medium">
                        {c.group ? <span className="text-ink-soft">{c.group} · </span> : null}
                        {c.label}
                        {c.essential && <span className="ml-1.5 text-[10px] uppercase text-ink-soft">essential</span>}
                      </p>
                      <p className="text-xs text-ink-soft">{c.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-primary mt-4" onClick={approvePlan} disabled={loading}>
                Looks good — find products
              </button>
            </div>
          )}

          {/* Picks */}
          {picks.length > 0 && (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {picks.slice(0, visiblePicks).map((rec) => (
                  <RecommendationCard
                    key={rec.productId}
                    rec={rec}
                    saved={savedIds.includes(rec.productId)}
                    onView={setDetailId}
                    onToggleSave={toggleSave}
                    badges={activeMeta?.badges}
                  />
                ))}
              </div>
              {picks.length > visiblePicks && (
                <div className="flex justify-center">
                  <button type="button" className="btn-secondary text-sm" onClick={() => setVisiblePicks((v) => v + 6)}>
                    Show more
                  </button>
                </div>
              )}
            </>
          )}

          {resp?.resultKind === "picks" && resp.stage === "recommendations" && resp.limitation && (
            <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink" role="status">
              {resp.limitation}
            </p>
          )}

          {/* Plan */}
          {plan && (
            <PlanView plan={plan} savedIds={savedIds} onView={setDetailId} onToggleSave={toggleSave} />
          )}

          {/* Refinement chips */}
          {activeMeta && (picks.length > 0 || plan) && (
            <div className="sticky bottom-2 z-10">
              <div className="card flex flex-wrap gap-1.5 p-3" aria-label="Refine">
                {activeMeta.refinements.map((chip) => (
                  <button key={chip} type="button" disabled={loading}
                    className="chip !py-1 text-xs disabled:opacity-50" onClick={() => refineWith(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!resp && !loading && (
            <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center text-ink-soft">
              <p className="font-(family-name:--font-display) text-xl text-ink">Pick a lens or just start typing</p>
              <p className="max-w-sm text-sm">
                Gifts, outfits, skincare routines, room bundles, packing kits, starter kits and more — one agent finds
                real products for each.
              </p>
            </div>
          )}

          <TracePanel trace={trace} />
        </section>
      </div>

      {detailId && (
        <ProductDetail
          productId={detailId}
          country={form.country ? form.country.toUpperCase() : "US"}
          onClose={() => setDetailId(null)}
          onTrace={appendTrace}
        />
      )}
    </div>
  );
}
