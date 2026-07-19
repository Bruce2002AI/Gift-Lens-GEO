"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ImagePlus,
  Link2,
  Loader2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import type { GiftIntent } from "@/lib/ai/schemas";
import type { TraceEvent, NormalizedProduct } from "@/lib/catalog/types";
import type { ConciergeResponse, GiftRecommendation, LinkCheckResponse } from "@/lib/gift/types";
import { formatMinorRange } from "@/lib/gift/currency";
import { RecommendationCard } from "@/components/gift/RecommendationCard";
import { ProductDetail } from "@/components/gift/ProductDetail";
import { SourceBanner } from "@/components/catalog/SourceBanner";
import { TracePanel } from "@/components/catalog/TracePanel";
import { ProductImage } from "@/components/catalog/ProductImage";

const SAMPLE_PROMPTS = [
  "Housewarming gift for a minimalist coffee lover under ₹4,000",
  "Unique birthday gift for a friend who loves hiking",
  "Safe wedding gift for a couple I do not know well",
  "Thoughtful gift for a new parent who dislikes clutter",
];

const LOADING_STAGES = [
  "Understanding the recipient",
  "Planning Catalog searches",
  "Searching Shopify merchants",
  "Verifying variants and offers",
  "Curating your gift picks",
];

/** How many "more" matches to reveal before the shopper asks for more. */
const INITIAL_MORE_VISIBLE = 9;
const MORE_STEP = 6;

const REFINEMENT_CHIPS = [
  "More personal",
  "More unique",
  "More practical",
  "More sentimental",
  "Safer choice",
  "Lower budget",
  "Premium option",
  "Arrives sooner",
  "Same vibe",
  "Different category",
];

const SAVED_KEY = "giftlens.saved";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PendingImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  name: string;
}

export default function GiftPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<GiftIntent | null>(null);
  const [recommendations, setRecommendations] = useState<GiftRecommendation[]>([]);
  const [visibleMore, setVisibleMore] = useState(INITIAL_MORE_VISIBLE);
  const [limitation, setLimitation] = useState<string | null>(null);
  const [source, setSource] = useState<"live" | "mock" | "mixed" | null>(null);
  const [aiMode, setAiMode] = useState<"ai" | "heuristic" | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [clarificationCount, setClarificationCount] = useState(0);
  const [image, setImage] = useState<PendingImage | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedProducts, setSavedProducts] = useState<NormalizedProduct[] | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [linkResult, setLinkResult] = useState<LinkCheckResponse | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Optional structured form
  const [form, setForm] = useState({
    budgetMax: "",
    country: "",
    currency: "",
    occasion: "",
    relationship: "",
  });

  useEffect(() => {
    // Deferred so hydration completes before saved state lands (and to keep
    // the effect body free of synchronous setState).
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(SAVED_KEY);
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

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(
      () => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)),
      1700,
    );
    return () => clearInterval(timer);
  }, [loading]);

  const toggleSave = useCallback((productId: string) => {
    setSavedIds((prev) => {
      const next = prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked — ignore */
      }
      return next;
    });
  }, []);

  const appendTrace = useCallback((events: TraceEvent[]) => {
    setTrace((prev) => [...prev, ...events]);
  }, []);

  const formPayload = () => ({
    budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
    country: form.country ? form.country.toUpperCase() : null,
    currency: form.currency ? form.currency.toUpperCase() : null,
    occasion: form.occasion || null,
    relationship: form.relationship || null,
  });

  const applyResponse = (json: ConciergeResponse, userVisibleNote?: string) => {
    if (json.intent) setIntent(json.intent);
    setAiMode(json.aiMode);
    setSource(json.source);
    setTrace(json.trace ?? []);
    if (json.stage === "clarification" && json.clarificationQuestion) {
      setClarificationCount((c) => c + 1);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: json.clarificationQuestion! },
      ]);
      return;
    }
    const recs = json.recommendations ?? [];
    setRecommendations(recs);
    setVisibleMore(INITIAL_MORE_VISIBLE);
    setLimitation(json.limitation ?? null);
    // Drive the summary off the ACTUAL spotlight/more split, not the total —
    // otherwise the copy can promise named spotlight cards or a "more" section
    // that didn't actually render.
    const count = recs.length;
    const spotlightCount = recs.filter((r) => r.role !== "more").length;
    const moreCount = count - spotlightCount;
    const verb = count === 1 ? "clears" : "clear";
    const tail = moreCount > 0 ? ", with more good matches right below" : "";
    const picksLine =
      spotlightCount >= 3
        ? `My top three are up top — a Best Match, a Delight, and a Safe pick${tail}.`
        : spotlightCount > 0
          ? `My favorite${spotlightCount === 1 ? " is" : "s are"} up top${tail}.`
          : "Take a look below.";
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content:
          userVisibleNote ??
          (count > 0
            ? `Okay — I pulled ${count} gift${count === 1 ? "" : "s"} that ${verb} all your must-haves. ${picksLine} Each one says why it fits and one honest catch. Want them more personal, more unique, or a different budget? Just say the word.`
            : "Hmm, nothing cleared all your must-haves this time — usually the budget or an exclusion is the pinch. Want to nudge the budget up a little or drop one constraint? I'll take another look."),
      },
    ]);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLinkResult(null);
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setStage(0);
    setLoading(true);

    try {
      // Pasted product link → lookup + evaluation flow.
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        const res = await fetch("/api/gift/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, intent }),
        });
        const json = (await res.json()) as LinkCheckResponse & { error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Could not resolve that product URL.");
        } else {
          setLinkResult(json);
          setTrace(json.trace ?? []);
          setSource(json.source);
          setAiMode(json.aiMode);
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content: `Found it in the catalog! My honest read: it's a ${json.verdict} fit for what you're after — here's why, plus a few similar options below.`,
            },
          ]);
        }
        return;
      }

      // After the first recommendations, further messages refine the search.
      if (intent && recommendations.length > 0) {
        const res = await fetch("/api/gift/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent, message: trimmed }),
        });
        const json = (await res.json()) as ConciergeResponse & { error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Refinement failed. Please retry.");
        } else {
          applyResponse(json, json.assistantMessage ?? undefined);
        }
        return;
      }

      const res = await fetch("/api/gift/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation: nextMessages,
          form: formPayload(),
          clarificationCount,
          image: image ? { mediaType: image.mediaType, base64: image.base64 } : null,
        }),
      });
      const json = (await res.json()) as ConciergeResponse & { error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Something went wrong. Please retry.");
      } else {
        applyResponse(json);
        setImage(null);
      }
    } catch {
      setError("Could not reach the server — check that the dev server is running, then retry.");
    } finally {
      setLoading(false);
    }
  };

  const refineWithChip = async (chip: string) => {
    if (!intent || loading) return;
    setError(null);
    setStage(0);
    setLoading(true);
    setMessages((m) => [...m, { role: "user", content: chip }]);
    try {
      const res = await fetch("/api/gift/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          message: chip,
          likeProductId:
            chip.toLowerCase() === "same vibe"
              ? recommendations.find((r) => r.role === "best_match")?.productId ?? null
              : null,
        }),
      });
      const json = (await res.json()) as ConciergeResponse & { error?: string };
      if (!res.ok || !json.ok) setError(json.error ?? "Refinement failed.");
      else applyResponse(json, json.assistantMessage ?? undefined);
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const onImagePick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Unsupported image format — use JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image too large — maximum size is 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImage({
        mediaType: file.type as PendingImage["mediaType"],
        base64: dataUrl.split(",")[1] ?? "",
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const openSaved = async () => {
    setSavedOpen(true);
    if (savedIds.length === 0) {
      setSavedProducts([]);
      return;
    }
    setSavedLoading(true);
    try {
      // Always re-resolve saved ids — never trust an old cached price.
      const res = await fetch("/api/catalog/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: savedIds, country: intent?.destination.country }),
      });
      const json = await res.json();
      setSavedProducts(json.ok ? (json.products as NormalizedProduct[]) : []);
      if (json.trace) appendTrace(json.trace);
    } catch {
      setSavedProducts([]);
    } finally {
      setSavedLoading(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setIntent(null);
    setRecommendations([]);
    setLimitation(null);
    setSource(null);
    setAiMode(null);
    setTrace([]);
    setClarificationCount(0);
    setImage(null);
    setLinkResult(null);
    setError(null);
  };

  const spotlight = recommendations.filter((r) => r.role !== "more");
  const moreMatches = recommendations.filter((r) => r.role === "more");
  const shownMore = moreMatches.slice(0, visibleMore);
  const hiddenMoreCount = moreMatches.length - shownMore.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-(family-name:--font-display) text-3xl font-semibold">
            AI Gift Concierge
          </h1>
          <p className="mt-1 text-ink-soft">
            Describe the person — GiftLens searches live Shopify merchants and
            explains every pick.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={openSaved} className="btn-secondary !py-2 text-sm">
            <Bookmark size={15} aria-hidden />
            Saved ({savedIds.length})
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={reset} className="btn-secondary !py-2 text-sm">
              <RotateCcw size={15} aria-hidden />
              Start over
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Left: chat + form */}
        <section aria-label="Gift conversation" className="flex flex-col gap-4">
          <div className="card flex min-h-[320px] flex-col p-4">
            <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-soft">
                    Try one of these, or write your own:
                  </p>
                  <div className="flex flex-col items-start gap-2">
                    {SAMPLE_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="chip text-left"
                        onClick={() => send(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <p className="pt-1 text-xs text-ink-soft">
                    You can also paste a Shopify product URL (“is this a good
                    gift?”) or add an inspiration image below.
                  </p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={`${msg.role}-${i}`}
                  className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "ml-auto bg-plum text-white"
                      : "bg-sand text-ink"
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {loading && (
                <div className="rounded-2xl bg-sand px-4 py-3 text-sm" role="status">
                  <span className="flex items-center gap-2 text-ink-soft">
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                    {LOADING_STAGES[stage]}…
                  </span>
                  <ol className="mt-2 flex gap-1" aria-hidden>
                    {LOADING_STAGES.map((s, i) => (
                      <li
                        key={s}
                        className={`h-1 flex-1 rounded-full ${i <= stage ? "bg-plum" : "bg-line"}`}
                      />
                    ))}
                  </ol>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            {image && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-plum-wash px-3 py-2 text-xs text-ink">
                <ImagePlus size={14} className="text-plum" aria-hidden />
                Inspiration image attached: {image.name}
                <button
                  type="button"
                  aria-label="Remove image"
                  className="ml-auto rounded p-1 hover:bg-white"
                  onClick={() => setImage(null)}
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            )}

            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <label htmlFor="gift-input" className="sr-only">
                Describe the person you are shopping for
              </label>
              <textarea
                id="gift-input"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={
                  recommendations.length > 0
                    ? "Refine: e.g. “something they can use outdoors”"
                    : "e.g. Housewarming gift for my sister in Bengaluru. She loves coffee and Scandinavian design, hates clutter, budget ₹4,000."
                }
                className="field-input min-h-[52px] flex-1 resize-none"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => onImagePick(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Upload an inspiration image"
                className="btn-secondary !px-3 !py-3"
              >
                <ImagePlus size={16} aria-hidden />
              </button>
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

          {/* Optional structured form */}
          <details className="card p-4" open={messages.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Optional details (budget, destination…)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="f-budget" className="field-label">Max budget</label>
                <input
                  id="f-budget"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="field-input"
                  placeholder="4000"
                  value={form.budgetMax}
                  onChange={(e) => setForm({ ...form, budgetMax: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-currency" className="field-label">Currency</label>
                <input
                  id="f-currency"
                  maxLength={3}
                  className="field-input uppercase"
                  placeholder="INR"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-country" className="field-label">Country</label>
                <input
                  id="f-country"
                  maxLength={2}
                  className="field-input uppercase"
                  placeholder="IN"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-occasion" className="field-label">Occasion</label>
                <input
                  id="f-occasion"
                  className="field-input"
                  placeholder="housewarming"
                  value={form.occasion}
                  onChange={(e) => setForm({ ...form, occasion: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="f-relationship" className="field-label">Recipient</label>
                <input
                  id="f-relationship"
                  className="field-input"
                  placeholder="sister"
                  value={form.relationship}
                  onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                />
              </div>
            </div>
          </details>

          {intent && <GiftBrief intent={intent} />}
        </section>

        {/* Right: results */}
        <section aria-label="Gift recommendations" className="flex flex-col gap-4">
          <SourceBanner source={source} aiMode={aiMode} />

          {linkResult?.ok && linkResult.product && (
            <LinkVerdict result={linkResult} onView={setDetailId} />
          )}

          {limitation && (
            <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink" role="status">
              {limitation}
            </p>
          )}

          {recommendations.length > 0 ? (
            <>
              {spotlight.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-ink">
                    {spotlight.length >= 3 ? "My top picks" : "Top picks"}
                    {moreMatches.length > 0 && (
                      <span className="ml-1.5 font-normal text-ink-soft">
                        · {recommendations.length} matches in all
                      </span>
                    )}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {spotlight.map((rec) => (
                      <RecommendationCard
                        key={rec.productId}
                        rec={rec}
                        saved={savedIds.includes(rec.productId)}
                        onView={setDetailId}
                        onToggleSave={toggleSave}
                      />
                    ))}
                  </div>
                </div>
              )}

              {moreMatches.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-ink">More great matches</h2>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {shownMore.map((rec) => (
                      <RecommendationCard
                        key={rec.productId}
                        rec={rec}
                        saved={savedIds.includes(rec.productId)}
                        onView={setDetailId}
                        onToggleSave={toggleSave}
                      />
                    ))}
                  </div>
                  {hiddenMoreCount > 0 && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() =>
                          setVisibleMore((v) => v + MORE_STEP)
                        }
                      >
                        Show {Math.min(MORE_STEP, hiddenMoreCount)} more
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="sticky bottom-2 z-10">
                <div className="card flex flex-wrap gap-1.5 p-3" aria-label="Refine your results">
                  {REFINEMENT_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={loading}
                      className="chip !py-1 text-xs disabled:opacity-50"
                      onClick={() => refineWithChip(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            !loading &&
            !linkResult && (
              <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center text-ink-soft">
                <p className="font-(family-name:--font-display) text-xl text-ink">
                  Your gift picks will appear here
                </p>
                <p className="max-w-sm text-sm">
                  A dozen live, ranked matches — led by three favorites (Best
                  Match, Delight Pick, Safe Pick) — each with evidence and one
                  honest trade-off. Ask for more anytime.
                </p>
              </div>
            )
          )}

          <TracePanel trace={trace} />
        </section>
      </div>

      {detailId && (
        <ProductDetail
          productId={detailId}
          country={intent?.destination.country ?? "US"}
          onClose={() => setDetailId(null)}
          onTrace={appendTrace}
        />
      )}

      {savedOpen && (
        <SavedDrawer
          loading={savedLoading}
          products={savedProducts}
          savedIds={savedIds}
          onClose={() => setSavedOpen(false)}
          onView={(id) => {
            setSavedOpen(false);
            setDetailId(id);
          }}
          onRemove={toggleSave}
        />
      )}
    </div>
  );
}

function GiftBrief({ intent }: { intent: GiftIntent }) {
  const constraints: string[] = [];
  if (intent.budget.maxMinor != null) {
    constraints.push(
      `Budget ≤ ${formatMinorRange(intent.budget.maxMinor, intent.budget.maxMinor, intent.budget.currency)}`,
    );
  }
  constraints.push(`Ships to ${intent.destination.country}`);
  if (intent.physicality !== "either") constraints.push(intent.physicality);
  intent.recipient.dislikes.forEach((d) => constraints.push(`No ${d}`));

  return (
    <section className="card p-4" aria-label="Gift brief">
      <h2 className="text-sm font-semibold">Gift brief</h2>
      <dl className="mt-2 space-y-1 text-sm text-ink-soft">
        {intent.recipient.relationship && (
          <div className="flex gap-2">
            <dt className="font-medium text-ink">For:</dt>
            <dd>
              {intent.recipient.relationship}
              {intent.destination.city ? ` in ${intent.destination.city}` : ""}
            </dd>
          </div>
        )}
        {intent.occasion && (
          <div className="flex gap-2">
            <dt className="font-medium text-ink">Occasion:</dt>
            <dd>{intent.occasion}</dd>
          </div>
        )}
        {intent.recipient.interests.length > 0 && (
          <div className="flex gap-2">
            <dt className="font-medium text-ink">Loves:</dt>
            <dd>{intent.recipient.interests.join(", ")}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Active hard constraints">
        {constraints.map((c) => (
          <span
            key={c}
            className="rounded-full bg-plum-wash px-2.5 py-1 text-xs font-medium text-plum"
          >
            {c}
          </span>
        ))}
      </div>
    </section>
  );
}

function LinkVerdict({
  result,
  onView,
}: {
  result: LinkCheckResponse;
  onView: (id: string) => void;
}) {
  const p = result.product!;
  const verdictColor =
    result.verdict === "strong"
      ? "text-ok"
      : result.verdict === "reasonable"
        ? "text-warn"
        : "text-danger";
  return (
    <section className="card p-4" aria-label="Pasted product evaluation">
      <div className="flex gap-4">
        <ProductImage
          src={p.images[0]?.url}
          alt={p.images[0]?.altText ?? p.title}
          className="h-24 w-24 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-ink-soft">
            <Link2 size={12} aria-hidden /> Pasted product · verdict:{" "}
            <span className={`font-semibold uppercase ${verdictColor}`}>
              {result.verdict}
            </span>
          </p>
          <h3 className="mt-1 line-clamp-1 font-medium">{p.title}</h3>
          <p className="text-sm text-ink-soft">
            {formatMinorRange(p.priceRange.minMinor, p.priceRange.maxMinor, p.priceRange.currency)}
          </p>
          <button type="button" className="mt-2 text-sm font-medium text-plum" onClick={() => onView(p.id)}>
            View details
          </button>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {result.reasons?.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
            {r}
          </li>
        ))}
        {result.concerns?.map((c) => (
          <li key={c} className="flex gap-2 text-ink-soft">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            {c}
          </li>
        ))}
      </ul>
      {result.alternatives && result.alternatives.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Similar alternatives
          </p>
          <div className="flex flex-wrap gap-2">
            {result.alternatives.map((alt) => (
              <button
                key={alt.productId}
                type="button"
                onClick={() => onView(alt.productId)}
                className="chip text-xs"
              >
                {alt.product.title.slice(0, 44)}
                {alt.product.title.length > 44 ? "…" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SavedDrawer({
  loading,
  products,
  savedIds,
  onClose,
  onView,
  onRemove,
}: {
  loading: boolean;
  products: NormalizedProduct[] | null;
  savedIds: string[];
  onClose: () => void;
  onView: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/40"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Saved products"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-(--shadow-lift)"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-(family-name:--font-display) text-lg font-semibold">
            Saved products
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close saved products"
            className="rounded-full p-2 text-ink-soft hover:bg-sand"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="border-b border-line bg-cream-deep/50 px-5 py-2 text-xs text-ink-soft">
          Prices and availability re-checked via lookup_catalog on open — never
          from an old browser cache.
        </p>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Refreshing saved products…
            </p>
          )}
          {!loading && (products?.length ?? 0) === 0 && (
            <p className="text-sm text-ink-soft">
              {savedIds.length === 0
                ? "Nothing saved yet — tap the bookmark on any recommendation."
                : "Saved identifiers could not be resolved right now."}
            </p>
          )}
          <ul className="space-y-3">
            {products?.map((p) => (
              <li key={p.id} className="card flex gap-3 p-3">
                <ProductImage
                  src={p.images[0]?.url}
                  alt={p.images[0]?.altText ?? p.title}
                  className="h-16 w-16 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</p>
                  <p className="text-sm text-ink-soft">
                    {formatMinorRange(p.priceRange.minMinor, p.priceRange.maxMinor, p.priceRange.currency)}
                  </p>
                  <div className="mt-1 flex gap-3 text-xs">
                    <button type="button" className="font-medium text-plum" onClick={() => onView(p.id)}>
                      View
                    </button>
                    <button
                      type="button"
                      className="text-ink-soft hover:text-danger"
                      onClick={() => onRemove(p.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
