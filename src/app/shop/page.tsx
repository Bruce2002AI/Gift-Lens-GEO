"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  HeartHandshake,
  ImagePlus,
  Info,
  Loader2,
  PackageSearch,
  Search,
  Send,
  StickyNote,
  X,
} from "lucide-react";
import {
  EXPERT_LENS_IDS,
  type ExpertEvent,
  type ExpertLensId,
  type ExpertRequest,
  type Fork,
  type LedgerView,
  type VerifiedBoardCategory,
  type VerifiedBoardItem,
  type VerifiedPresentation,
} from "@/lib/agent/types";
import { MODE_META } from "@/lib/modes/meta";
import { modeIcon } from "@/components/agent/mode-icons";
import { ProductImage } from "@/components/catalog/ProductImage";
import { FilterBar } from "@/components/expert/FilterBar";
import { PortraitPanel } from "@/components/expert/PortraitPanel";
import { PresentationView } from "@/components/expert/PresentationView";
import { ProductBoard, type BoardSort } from "@/components/expert/ProductBoard";
import { RichText } from "@/components/expert/RichText";

// ---------------------------------------------------------------------------
// Feed model — every stream event (plus user messages) lands here in order
// ---------------------------------------------------------------------------

type TraceEventPayload = Extract<ExpertEvent, { type: "trace" }>;

type FeedItemBase =
  | { kind: "user"; text: string; imageUrl?: string }
  | { kind: "say"; text: string }
  | { kind: "trace"; trace: TraceEventPayload }
  | { kind: "ask"; text: string; fork: Fork | null; quickReplies: string[] }
  | { kind: "care"; text: string; flags: string[] }
  | { kind: "propose"; summary: string; sections: Array<{ title: string; detail: string }> }
  | { kind: "present"; presentation: VerifiedPresentation }
  | { kind: "limitation"; text: string }
  | { kind: "notice"; tone: "mock" | "degraded" | "info"; text: string }
  | { kind: "error"; text: string };

type FeedItem = FeedItemBase & { id: number };
type TraceItem = Extract<FeedItem, { kind: "trace" }>;

/** Consecutive trace events render together as one muted chip row. */
type FeedBlock =
  | { key: string; kind: "traces"; traces: TraceItem[] }
  | { key: string; kind: "item"; item: Exclude<FeedItem, { kind: "trace" }> };

const TRACE_ICONS = { search: Search, inspect: PackageSearch, note: StickyNote } as const;

const MOCK_BANNER = "Demo catalog data — not live listings";

/** Data URLs inflate ~33% over the file, and the route caps them at ~4MB. */
const MAX_IMAGE_BYTES = 2_500_000;

/**
 * Folds a turn's board into the accumulated one. A later turn that narrows to
 * two categories must not erase the shirts the shopper is still considering:
 * categories are add-only, and within a category items dedupe by productId with
 * the newest turn's insight winning (fresh picks lead, older options follow).
 */
function mergeBoard(
  prev: VerifiedBoardCategory[],
  next: VerifiedBoardCategory[],
): VerifiedBoardCategory[] {
  if (next.length === 0) return prev;

  const itemsByCategory = new Map<string, VerifiedBoardItem[]>();
  const order: string[] = [];
  for (const category of prev) {
    itemsByCategory.set(category.name, [...category.items]);
    order.push(category.name);
  }

  for (const category of next) {
    const existing = itemsByCategory.get(category.name);
    if (!existing) {
      itemsByCategory.set(category.name, [...category.items]);
      order.push(category.name);
      continue;
    }
    const merged = [...category.items];
    const seen = new Set(merged.map((item) => item.productId));
    for (const item of existing) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      // The fresh turn's picks are THE picks: carried-over items keep their
      // place but lose the badge, so re-running a rail under new constraints
      // can't accumulate four "AI pick" badges in one category.
      merged.push(item.isPick ? { ...item, isPick: false } : item);
    }
    itemsByCategory.set(category.name, merged);
  }

  return order.map((name) => ({ name, items: itemsByCategory.get(name) ?? [] }));
}

/** Pulls the route's `{ error }` reason off a failed response, if there is one. */
async function readErrorMessage(res: Response): Promise<string> {
  const fallback = `The expert is unavailable right now (HTTP ${res.status}).`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const { error } = body as { error: unknown };
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON (or already consumed) — fall through to the status message.
  }
  return fallback;
}

export default function ExpertShopPage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lens, setLens] = useState<ExpertLensId | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [board, setBoard] = useState<VerifiedBoardCategory[]>([]);
  const [portraitCollapsed, setPortraitCollapsed] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [sort, setSort] = useState<BoardSort>("picks");

  const idRef = useRef(0);
  const autoCollapsedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feed, streaming]);

  /** Grow the composer to fit its text (up to a cap) instead of scrolling it. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /** Once products exist the board owns the panel — fold the Portrait away once. */
  useEffect(() => {
    if (autoCollapsedRef.current || board.length === 0) return;
    autoCollapsedRef.current = true;
    setPortraitCollapsed(true);
  }, [board]);

  /** Compositions reference board products by id — resolve them from here. */
  const boardIndex = useMemo(() => {
    const index = new Map<string, VerifiedBoardItem>();
    for (const category of board) {
      for (const item of category.items) index.set(item.productId, item);
    }
    return index;
  }, [board]);

  const pushItem = useCallback((item: FeedItemBase) => {
    idRef.current += 1;
    const id = idRef.current;
    setFeed((prev) => [...prev, { ...item, id }]);
  }, []);

  const handleEvent = useCallback(
    (event: ExpertEvent) => {
      switch (event.type) {
        case "session":
          setSessionId(event.sessionId);
          setLens(event.lens);
          break;
        case "ledger":
          setLedger(event.view);
          break;
        case "done":
          break;
        case "say":
          pushItem({ kind: "say", text: event.text });
          break;
        case "trace":
          pushItem({ kind: "trace", trace: event });
          break;
        case "ask":
          pushItem({ kind: "ask", text: event.text, fork: event.fork, quickReplies: event.quickReplies });
          break;
        case "care":
          pushItem({ kind: "care", text: event.text, flags: event.flags });
          break;
        case "propose":
          pushItem({ kind: "propose", summary: event.summary, sections: event.sections });
          break;
        case "present":
          setBoard((prev) => mergeBoard(prev, event.presentation.board));
          pushItem({ kind: "present", presentation: event.presentation });
          break;
        case "limitation":
          pushItem({ kind: "limitation", text: event.text });
          break;
        case "notice":
          pushItem({ kind: "notice", tone: event.tone, text: event.text });
          break;
        case "error":
          pushItem({ kind: "error", text: event.message });
          break;
      }
    },
    [pushItem],
  );

  /**
   * POST to /api/expert and consume the NDJSON stream line by line.
   * A new turn aborts any in-flight one first (mid-turn interruption).
   */
  const stream = useCallback(
    async (request: ExpertRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);

      const parseLine = (line: string) => {
        try {
          handleEvent(JSON.parse(line) as ExpertEvent);
        } catch {
          // Skip malformed lines rather than killing the whole stream.
        }
      };

      try {
        const res = await fetch("/api/expert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!res.ok) {
          // The route rejects bad requests with `{ ok:false, error }` JSON —
          // surface that reason instead of a bare status code.
          throw new Error(await readErrorMessage(res));
        }
        if (!res.body) throw new Error("The expert sent an empty response stream.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) parseLine(line);
            newline = buffer.indexOf("\n");
          }
        }
        const tail = (buffer + decoder.decode()).trim();
        if (tail) parseLine(tail);
      } catch (err) {
        if (!controller.signal.aborted) {
          pushItem({
            kind: "error",
            text:
              err instanceof Error
                ? err.message
                : "Something went wrong reaching the expert — please try again.",
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [handleEvent, pushItem],
  );

  const sendMessage = useCallback(
    (text: string, opts?: { lens?: ExpertLensId; imageDataUrl?: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      pushItem({ kind: "user", text: trimmed, imageUrl: opts?.imageDataUrl });
      void stream({
        sessionId: sessionId ?? undefined,
        lens: opts?.lens ?? lens ?? undefined,
        message: trimmed,
        imageDataUrl: opts?.imageDataUrl,
      });
    },
    [lens, pushItem, sessionId, stream],
  );

  const sendOp = useCallback(
    (label: string, op: NonNullable<ExpertRequest["op"]>) => {
      if (!sessionId) return;
      pushItem({ kind: "user", text: label });
      void stream({ sessionId, lens: lens ?? undefined, op });
    },
    [lens, pushItem, sessionId, stream],
  );

  /** "More like this" under a card — a similarity search anchored on it. */
  const handleMoreLike = useCallback(
    (productId: string) => {
      sendOp("More like this →", { kind: "more_like", productId });
    },
    [sendOp],
  );

  const submitComposer = () => {
    const text = input.trim();
    if (!text) return;
    const image = pendingImage;
    setInput("");
    setPendingImage(null);
    sendMessage(text, { imageDataUrl: image?.dataUrl });
  };

  const prefillComposer = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const focusComposer = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      pushItem({
        kind: "notice",
        tone: "info",
        text: `That photo is ${(file.size / 1_000_000).toFixed(1)}MB — I can only take images under 2.5MB. Try a smaller one or a screenshot.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingImage({ dataUrl: reader.result, name: file.name });
      }
    };
    reader.readAsDataURL(file);
  };

  const blocks = useMemo<FeedBlock[]>(() => {
    const out: FeedBlock[] = [];
    for (const item of feed) {
      if (item.kind === "trace") {
        const last = out[out.length - 1];
        if (last && last.kind === "traces") last.traces.push(item);
        else out.push({ key: `t${item.id}`, kind: "traces", traces: [item] });
      } else {
        out.push({ key: `i${item.id}`, kind: "item", item });
      }
    }
    return out;
  }, [feed]);

  const accentClass =
    lens && MODE_META[lens].accent === "gold" ? "border-l-gold/70" : "border-l-plum/70";
  const agentBubble = `max-w-[90%] whitespace-pre-wrap rounded-2xl border-l-2 bg-sand px-4 py-2.5 text-sm leading-relaxed text-ink ${accentClass}`;

  const renderItem = (item: Exclude<FeedItem, { kind: "trace" }>) => {
    switch (item.kind) {
      case "user":
        return (
          <div className="ml-auto max-w-[85%] rounded-2xl bg-plum px-4 py-2.5 text-sm leading-relaxed text-white">
            <p className="whitespace-pre-wrap">{item.text}</p>
            {item.imageUrl && (
              <ProductImage
                src={item.imageUrl}
                alt="Photo you attached"
                className="mt-2 h-24 w-24 rounded-lg"
              />
            )}
          </div>
        );
      case "say":
        // RichText manages its own block layout, so this bubble drops the
        // pre-wrap the plain-text bubbles use.
        return (
          <div className={agentBubble.replace(" whitespace-pre-wrap", "")}>
            <RichText text={item.text} />
          </div>
        );
      case "ask":
        return (
          <div className={agentBubble.replace("max-w-[90%]", "max-w-[95%]")}>
            <p>{item.text}</p>
            {item.fork && (
              <p className="mt-1.5 text-xs italic text-ink-soft">
                asking because: {item.fork.ifA} → {item.fork.thenA} · {item.fork.ifB} →{" "}
                {item.fork.thenB}
              </p>
            )}
            {item.quickReplies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.quickReplies.map((reply, i) => (
                  <button
                    key={i}
                    type="button"
                    className="chip !bg-white !py-1 text-xs"
                    onClick={() => sendMessage(reply)}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      case "care":
        return (
          <div
            role="note"
            className="max-w-[95%] rounded-2xl border border-gold/40 bg-gold-wash px-4 py-3 text-sm leading-relaxed text-ink"
          >
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-gold/50 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gold">
              <HeartHandshake size={11} aria-hidden />
              care mode{item.flags.length > 0 ? `: ${item.flags.join(" · ")}` : ""}
            </span>
            <p className="whitespace-pre-wrap">{item.text}</p>
          </div>
        );
      case "propose":
        return (
          <div className="card max-w-[95%] p-4">
            <h3 className="font-(family-name:--font-display) text-base font-semibold">
              {item.summary}
            </h3>
            {item.sections.length > 0 && (
              <ul className="mt-2 space-y-2">
                {item.sections.map((section, i) => (
                  <li key={i} className="rounded-lg bg-sand/50 px-3 py-2">
                    <p className="text-sm font-medium text-ink">{section.title}</p>
                    <p className="text-xs leading-relaxed text-ink-soft">{section.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary !py-2 text-sm"
                onClick={() => sendMessage("Go ahead with this plan.")}
              >
                Sounds right — go ahead
              </button>
              <button type="button" className="btn-secondary !py-2 text-sm" onClick={focusComposer}>
                Adjust
              </button>
            </div>
          </div>
        );
      case "present":
        return (
          <PresentationView
            presentation={item.presentation}
            accentClass={accentClass}
            boardIndex={boardIndex}
            onPrefill={prefillComposer}
            onMoreLike={handleMoreLike}
            onSend={(text) => sendMessage(text)}
            compact
          />
        );
      case "limitation":
        return (
          <div className="max-w-[90%] rounded-2xl border border-line bg-white px-4 py-2.5 text-sm italic leading-relaxed text-ink-soft">
            {item.text}
          </div>
        );
      case "notice":
        if (item.tone === "mock") {
          return (
            <div role="note" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-ink">
              <p className="font-semibold">{MOCK_BANNER}</p>
              {item.text && item.text !== MOCK_BANNER && (
                <p className="mt-0.5 text-ink-soft">{item.text}</p>
              )}
            </div>
          );
        }
        if (item.tone === "degraded") {
          return (
            <div role="note" className="rounded-xl border border-line bg-sand px-4 py-2.5 text-sm text-ink-soft">
              {item.text}
            </div>
          );
        }
        return (
          <p className="flex items-start gap-1.5 px-1 text-xs text-ink-soft">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            {item.text}
          </p>
        );
      case "error":
        return (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {item.text}
          </p>
        );
    }
  };

  const hasStarted = feed.length > 0;
  const totalItems = board.reduce((n, category) => n + category.items.length, 0);

  const renderLensPicker = (compact: boolean) => (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "justify-center"}`}
      aria-label="Choose a lens"
    >
      {EXPERT_LENS_IDS.map((id) => {
        const meta = MODE_META[id];
        const Icon = modeIcon(meta.icon);
        const active = lens === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setLens(id)}
            title={meta.tagline}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border transition ${
              compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
            } ${
              active
                ? "border-plum bg-plum text-white"
                : "border-line bg-white text-ink hover:border-plum/40"
            }`}
          >
            <Icon size={compact ? 12 : 14} aria-hidden />
            {meta.name}
          </button>
        );
      })}
      <Link
        href="/shop/classic"
        className={`ml-1 font-medium text-plum hover:underline ${compact ? "text-xs" : "text-sm"}`}
      >
        More lenses →
      </Link>
    </div>
  );

  const composer = (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
    >
      {pendingImage && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-sand/50 p-2">
          <ProductImage
            src={pendingImage.dataUrl}
            alt={`Preview of ${pendingImage.name}`}
            className="h-14 w-14 shrink-0 rounded-lg"
          />
          <p className="flex-1 text-xs leading-relaxed text-ink-soft">
            {"I can't see photos on this setup — the catalog will match visually similar items."}
          </p>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => setPendingImage(null)}
            className="rounded p-1 text-ink-soft hover:text-danger"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="expert-input" className="sr-only">
          Describe what you need
        </label>
        <textarea
          id="expert-input"
          ref={inputRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComposer();
            }
          }}
          placeholder={lens ? MODE_META[lens].examplePrompt : "e.g. A retirement gift for my dad…"}
          className="field-input min-h-[52px] flex-1 resize-none"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <button
          type="button"
          aria-label="Attach a photo"
          title="Attach a photo — the catalog matches visually similar items"
          onClick={() => fileRef.current?.click()}
          className="btn-secondary !px-3 !py-3"
        >
          <ImagePlus size={16} aria-hidden />
        </button>
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label={streaming ? "Interrupt and send" : "Send"}
          title={streaming ? "Sends now — the expert will adjust mid-thought" : undefined}
          className="btn-primary !px-3 !py-3"
        >
          <Send size={16} aria-hidden />
        </button>
      </div>
    </form>
  );

  // ---------------------------------------------------------------------------
  // Launch state — a focused hero: nothing but the composer until the shopper
  // starts. The split results view only appears once there's a conversation.
  // ---------------------------------------------------------------------------
  if (!hasStarted) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
        <header className="mb-6 text-center">
          <h1 className="font-(family-name:--font-display) text-4xl font-semibold">ShopLens</h1>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            Describe what you need — the right expert shows its work and finds live, buyable products.
          </p>
        </header>

        <div className="card p-4">{composer}</div>

        <div className="mt-5">{renderLensPicker(false)}</div>

        <div className="mt-8">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Or try one
          </p>
          <div className="flex flex-col gap-2">
            {EXPERT_LENS_IDS.map((id) => {
              const meta = MODE_META[id];
              const Icon = modeIcon(meta.icon);
              return (
                <button
                  key={id}
                  type="button"
                  className="chip w-full justify-start text-left"
                  onClick={() => {
                    setLens(id);
                    sendMessage(meta.examplePrompt, { lens: id });
                  }}
                >
                  <Icon size={14} aria-hidden className="shrink-0" />
                  {meta.examplePrompt}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Active state — chat rail (left) + product results page (right).
  // Below 1280px the two columns stack, so the page never scrolls sideways.
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Chat rail */}
        <section aria-label="Conversation" className="min-w-0">
          <div className="card flex flex-col p-4 xl:sticky xl:top-[4.5rem] xl:h-[calc(100vh-6rem)]">
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-3">
              <h1 className="font-(family-name:--font-display) text-lg font-semibold">ShopLens</h1>
              {lens && (
                <span className="text-xs font-medium text-ink-soft">{MODE_META[lens].name}</span>
              )}
            </div>

            <div className="mb-3">{renderLensPicker(true)}</div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
              {blocks.map((block) =>
                block.kind === "traces" ? (
                  <div key={block.key} className="flex flex-wrap items-center gap-1.5 pl-1">
                    {block.traces.map((t) => {
                      const Icon = TRACE_ICONS[t.trace.kind];
                      return (
                        <span
                          key={t.id}
                          title={t.trace.detail}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            t.trace.ok === false
                              ? "border-warn/40 bg-warn/10 text-warn"
                              : "border-line bg-white text-ink-soft"
                          }`}
                        >
                          <Icon size={11} aria-hidden />
                          {t.trace.label}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div key={block.key}>{renderItem(block.item)}</div>
                ),
              )}

              {streaming && (
                <WorkingIndicator
                  lensName={lens ? MODE_META[lens].name : null}
                  accentClass={accentClass}
                />
              )}
              <div ref={endRef} />
            </div>

            <div className="mt-3 border-t border-line pt-3">{composer}</div>
          </div>
        </section>

        {/* Results page */}
        <section aria-label="Products" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-(family-name:--font-display) text-xl font-semibold">
              {totalItems > 0 ? (
                <>
                  {totalItems} product{totalItems === 1 ? "" : "s"}
                  <span className="ml-2 text-sm font-normal text-ink-soft">
                    across {board.length} categor{board.length === 1 ? "y" : "ies"}
                  </span>
                </>
              ) : (
                "Finding products…"
              )}
            </h2>
            {totalItems > 0 && (
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="text-ink-soft">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as BoardSort)}
                  className="field-input !w-auto !py-1.5"
                >
                  <option value="picks">Picks first</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                </select>
              </label>
            )}
          </div>

          <FilterBar view={ledger} busy={streaming} onRefine={(message) => sendMessage(message)} />

          <PortraitPanel
            lens={lens}
            view={ledger}
            busy={streaming}
            collapsed={portraitCollapsed}
            onToggleCollapsed={() => setPortraitCollapsed((open) => !open)}
            onCorrectFact={(factId, newValue) =>
              sendOp(`Correction: ${newValue}`, { kind: "correct_fact", factId, newValue })
            }
            onRemoveFact={(factId, value) =>
              sendOp(`Remove: ${value}`, { kind: "correct_fact", factId, remove: true })
            }
            onRevokeConsent={(category) =>
              sendOp(`Revoke my ${category} opt-in.`, { kind: "revoke_consent", category })
            }
          />

          {board.length === 0 ? (
            streaming ? (
              <SkeletonBoard />
            ) : (
              <div className="card flex items-center gap-3 p-6 text-sm text-ink-soft">
                <p>
                  Everything the expert finds lands here — grouped by category,
                  with why each one made the list.
                </p>
              </div>
            )
          ) : (
            <ProductBoard
              board={board}
              busy={streaming}
              onMoreLike={handleMoreLike}
              layout="grid"
              sort={sort}
              showHeading={false}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The "expert is working" indicator — three dots that pulse in sequence,
 * lens-aware, styled to match the agent's own message bubbles so the wait
 * reads as active work rather than a stalled spinner.
 */
function WorkingIndicator({
  lensName,
  accentClass,
}: {
  lensName: string | null;
  accentClass: string;
}) {
  return (
    <div className="pl-1" role="status" aria-live="polite">
      <div
        className={`inline-flex items-center gap-2.5 rounded-2xl border-l-2 bg-sand px-4 py-2.5 ${accentClass}`}
      >
        <span className="flex items-end gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-plum"
              style={{ animation: "dot 1s ease-in-out infinite", animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
        <span className="text-sm text-ink-soft">
          {lensName
            ? `${lensName} is searching & verifying…`
            : "Searching & verifying live products…"}
        </span>
      </div>
    </div>
  );
}

/** Placeholder product grid shown while the first verified picks are loading. */
function SkeletonBoard() {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm text-ink-soft" role="status">
        <Loader2 size={14} className="animate-spin text-plum" aria-hidden />
        Searching the catalog — verified products appear here as they&apos;re confirmed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton h-44 w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-3 w-1/2" />
              <div className="mt-3 flex gap-2">
                <div className="skeleton h-8 flex-1 rounded-full" />
                <div className="skeleton h-8 flex-1 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
