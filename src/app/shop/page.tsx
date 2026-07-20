"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  ChevronDown,
  HeartHandshake,
  ImagePlus,
  Info,
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

/** Three bouncing dots — a livelier "the expert is working" than static text. */
function ThinkingDots({ label = "thinking" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-label={`${label}…`}>
      <span className="text-ink-soft">{label}</span>
      <span className="ml-0.5 flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-plum"
            style={{ animation: "dot-bounce 1.2s infinite", animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </span>
    </span>
  );
}

/** Shimmer placeholders shown in the results grid while the first turn streams. */
function ResultsSkeleton() {
  return (
    <section aria-hidden className="space-y-3">
      <div className="h-4 w-32 rounded skeleton" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="aspect-square w-full skeleton" />
            <div className="space-y-2 p-2.5">
              <div className="h-2.5 w-2/3 rounded skeleton" />
              <div className="h-3 w-full rounded skeleton" />
              <div className="h-3 w-1/3 rounded skeleton" />
              <div className="h-8 w-full rounded-lg skeleton" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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

      {/* One unified input surface: the textarea and its actions share a single
          rounded container that lifts and highlights when focused. */}
      <div className="rounded-2xl border border-line bg-white px-3 pb-2 pt-2.5 shadow-(--shadow-card) transition-colors focus-within:border-plum focus-within:ring-2 focus-within:ring-plum/15">
        <label htmlFor="expert-input" className="sr-only">
          Describe what you need
        </label>
        <textarea
          id="expert-input"
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComposer();
            }
          }}
          placeholder={lens ? MODE_META[lens].examplePrompt : "e.g. A retirement gift for my dad…"}
          className="block max-h-[140px] min-h-[24px] w-full resize-none bg-transparent text-sm leading-relaxed text-ink placeholder:text-ink-soft/50 focus:outline-none"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Attach a photo"
            title="Attach a photo — the catalog matches visually similar items"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-plum active:scale-90"
          >
            <ImagePlus size={17} aria-hidden />
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-ink-soft/70 sm:inline">
              {input.trim() ? "Enter to send · Shift+Enter for a new line" : ""}
            </span>
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label={streaming ? "Interrupt and send" : "Send"}
              title={streaming ? "Sends now — the expert will adjust mid-thought" : undefined}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-plum text-white transition-all hover:bg-plum-dark active:scale-90 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft/50"
            >
              <Send size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  // ---------------------------------------------------------------------------
  // Launch state — a focused hero: nothing but the composer until the shopper
  // starts. The split results view only appears once there's a conversation.
  // ---------------------------------------------------------------------------
  if (!hasStarted) {
    return (
      <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
        {/* Soft warm glow behind the composer so the empty state feels inviting. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 mx-auto h-72 max-w-lg rounded-full bg-plum/10 blur-3xl"
        />
        <header className="mb-6 animate-rise text-center">
          <h1 className="font-(family-name:--font-display) text-4xl font-semibold">ShopLens</h1>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            Describe what you need — the right expert shows its work and finds live, buyable products.
          </p>
        </header>

        <div className="animate-rise">{composer}</div>

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
          <div className="card flex max-h-[65vh] flex-col p-4 xl:sticky xl:top-[4.5rem] xl:h-[calc(100vh-6rem)] xl:max-h-none">
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-3">
              <h1 className="font-(family-name:--font-display) text-lg font-semibold">ShopLens</h1>
              {lens && (
                <span className="text-xs font-medium text-ink-soft">{MODE_META[lens].name}</span>
              )}
            </div>

            <div className="mb-3">{renderLensPicker(true)}</div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 scroll-fade" aria-live="polite">
              {blocks.map((block) =>
                block.kind === "traces" ? (
                  <div key={block.key} className="animate-rise flex flex-wrap items-center gap-1.5 pl-1">
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
                  <div key={block.key} className="animate-rise">
                    {renderItem(block.item)}
                  </div>
                ),
              )}

              {streaming && (
                <div className="pl-1 text-sm">
                  <ThinkingDots />
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="mt-3">{composer}</div>
          </div>
        </section>

        {/* Results page */}
        <section aria-label="Products" className="min-w-0 space-y-4">
          {/* Toolbar — count, sort, and the derived filter chips read as one bar. */}
          <div className="space-y-3 border-b border-line pb-4">
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
                  <span className="relative">
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as BoardSort)}
                      className="cursor-pointer appearance-none rounded-full border border-line bg-white py-1.5 pl-3 pr-8 text-sm text-ink transition-colors hover:border-plum focus:border-plum focus:outline-none"
                    >
                      <option value="picks">Picks first</option>
                      <option value="price-asc">Price: low to high</option>
                      <option value="price-desc">Price: high to low</option>
                    </select>
                    <ChevronDown
                      size={14}
                      aria-hidden
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
                    />
                  </span>
                </label>
              )}
            </div>

            <FilterBar view={ledger} busy={streaming} onRefine={(message) => sendMessage(message)} />
          </div>

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
              <ResultsSkeleton />
            ) : (
              <div className="card p-6 text-sm leading-relaxed text-ink-soft">
                Everything the expert finds lands here — grouped by category, with why each one made
                the list.
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
