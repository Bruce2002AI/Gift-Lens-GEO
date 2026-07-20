"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles } from "lucide-react";
import type { VerifiedBoardCategory, VerifiedBoardItem } from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinor } from "@/lib/gift/currency";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { ShortlistButton } from "@/components/shortlist/ShortlistButton";
import { snapshotFromBoardItem } from "@/lib/wishlist/snapshot";

/** How the board arranges each category's options. */
export type BoardLayout = "rail" | "grid";

/** Client-side ordering applied within each category. */
export type BoardSort = "picks" | "price-asc" | "price-desc";

/**
 * Slide width for a board card and the gap between slides. These mirror the
 * literal `w-[200px]` / `gap-3` classes on the rail (Tailwind can't read
 * runtime values) and drive how far one arrow click scrolls.
 */
const CARD_WIDTH = 200;
const CARD_GAP = 12;

/**
 * Orders a category's items for display. "picks" preserves the agent's own
 * ranking (picks already lead); the price sorts reorder every item, nulls last,
 * so an option missing a price never jumps ahead of a real one.
 */
function sortItems(items: VerifiedBoardItem[], sort: BoardSort): VerifiedBoardItem[] {
  if (sort === "picks") return items;
  const dir = sort === "price-asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.priceMinor == null && b.priceMinor == null) return 0;
    if (a.priceMinor == null) return 1;
    if (b.priceMinor == null) return -1;
    return (a.priceMinor - b.priceMinor) * dir;
  });
}

/** Circular chevron overlaying the slider edge — translucent, subtly raised. */
const ARROW_CLASS =
  "absolute top-1/2 z-[5] grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-white/90 text-ink shadow-(--shadow-card) backdrop-blur-sm transition-colors hover:border-plum hover:text-plum";

/** Small outlined action, sized for the compact card footer. */
const ACTION_CLASS =
  "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-plum hover:text-plum disabled:cursor-not-allowed disabled:border-line disabled:text-ink-soft/60 disabled:hover:border-line disabled:hover:text-ink-soft/60";

/**
 * The side-panel product board: every option the agent has surfaced this
 * session, grouped by the agent's own categories (shirts/trousers/shoes,
 * cleanser/serum/SPF, diet/supplement stages…).
 *
 * Cards are deliberately compact — image, brand, title, price, two actions —
 * so a whole category reads at a glance. The agent's reasoning rides along:
 * an insight on every card, and a trade-off on the alternatives (the top two
 * picks per category carry none by design; nothing is fabricated to fill it).
 */
export function ProductBoard({
  board,
  onMoreLike,
  busy = false,
  layout = "rail",
  sort = "picks",
  showHeading = true,
}: {
  /** Accumulated across turns by the page — categories never vanish. */
  board: VerifiedBoardCategory[];
  /** "Show Similar" → a similarity search anchored on this product. */
  onMoreLike: (productId: string) => void;
  /** True while a turn streams — actions that start a new turn are disabled. */
  busy?: boolean;
  /** "rail" = horizontal snap-scroller (compact side panel); "grid" = wrapping grid (results page). */
  layout?: BoardLayout;
  /** Client-side ordering within each category. */
  sort?: BoardSort;
  /** The results page supplies its own header, so the built-in one can be hidden. */
  showHeading?: boolean;
}) {
  const total = board.reduce((n, category) => n + category.items.length, 0);

  return (
    <section aria-label="Products found" className="space-y-3">
      {showHeading && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-(family-name:--font-display) text-lg font-semibold">Products</h2>
          {total > 0 && (
            <span className="text-xs text-ink-soft">
              {total} option{total === 1 ? "" : "s"} · {board.length} categor
              {board.length === 1 ? "y" : "ies"}
            </span>
          )}
        </div>
      )}

      {board.length === 0 ? (
        <p className="card p-4 text-sm leading-relaxed text-ink-soft">
          {
            "Everything the expert finds lands here — grouped by category, with why each one made the list."
          }
        </p>
      ) : (
        <div className={layout === "grid" ? "space-y-8" : "space-y-5"}>
          {board.map((category) => (
            <CategorySection
              key={category.name}
              category={category}
              onMoreLike={onMoreLike}
              busy={busy}
              layout={layout}
              sort={sort}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CategorySection({
  category,
  onMoreLike,
  busy,
  layout,
  sort,
}: {
  category: VerifiedBoardCategory;
  onMoreLike: (productId: string) => void;
  busy: boolean;
  layout: BoardLayout;
  sort: BoardSort;
}) {
  const items = sortItems(category.items, sort);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  /** Recompute which arrows apply — no overflow means no arrows at all. */
  const syncArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    // 1px slack so sub-pixel widths don't leave a permanently "enabled" arrow.
    const maxScroll = rail.scrollWidth - rail.clientWidth;
    setCanScrollLeft(rail.scrollLeft > 1);
    setCanScrollRight(maxScroll > 1 && rail.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    syncArrows();
    window.addEventListener("resize", syncArrows);
    return () => window.removeEventListener("resize", syncArrows);
  }, [syncArrows, category.items.length]);

  const scrollByCard = (direction: 1 | -1) => {
    railRef.current?.scrollBy({
      left: direction * (CARD_WIDTH + CARD_GAP),
      behavior: "smooth",
    });
  };

  const heading = (
    <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
      <h3 className="font-(family-name:--font-display) text-sm font-semibold text-ink">
        {category.name}
      </h3>
      <span className="shrink-0 text-[11px] text-ink-soft">
        {category.items.length} option{category.items.length === 1 ? "" : "s"}
      </span>
    </div>
  );

  // Results-page layout: a wrapping grid, cards fill their cell. Each category
  // reads as a labeled shelf; the whole page scrolls as one.
  if (layout === "grid") {
    return (
      <section aria-label={category.name} className="space-y-3">
        {heading}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {items.map((item) => (
            <BoardCard key={item.productId} item={item} onMoreLike={onMoreLike} busy={busy} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={category.name}>
      <div className="sticky top-0 z-10 -mx-1 bg-cream/95 px-1 py-2 backdrop-blur-sm">
        {heading}
      </div>

      <div className="relative mt-3">
        <div
          ref={railRef}
          onScroll={syncArrows}
          tabIndex={0}
          role="group"
          aria-label={`${category.name} options — scroll horizontally`}
          style={{ scrollbarWidth: "none" }}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <div key={item.productId} className="w-[200px] shrink-0 snap-start">
              <BoardCard item={item} onMoreLike={onMoreLike} busy={busy} />
            </div>
          ))}
        </div>

        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByCard(-1)}
            aria-label={`Scroll ${category.name} options left`}
            className={`${ARROW_CLASS} left-1`}
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByCard(1)}
            aria-label={`Scroll ${category.name} options right`}
            className={`${ARROW_CLASS} right-1`}
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

function BoardCard({
  item,
  onMoreLike,
  busy,
}: {
  item: VerifiedBoardItem;
  onMoreLike: (productId: string) => void;
  busy: boolean;
}) {
  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-xl border bg-white transition-shadow ${
        item.isPick ? "border-plum/45 shadow-(--shadow-card)" : "border-line"
      }`}
    >
      <div className="relative">
        {item.productUrl ? (
          <a
            href={item.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${item.title} on the merchant site (opens in a new tab)`}
            className="group block"
          >
            <ProductImage
              src={item.imageUrl}
              alt={item.title}
              className="aspect-square w-full transition-transform duration-300 group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition-all duration-200 group-hover:bg-ink/30 group-hover:opacity-100">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-ink shadow-(--shadow-card)">
                <ExternalLink size={10} aria-hidden />
                View
              </span>
            </span>
          </a>
        ) : (
          <ProductImage src={item.imageUrl} alt={item.title} className="aspect-square w-full" />
        )}
        {item.isPick && (
          <span
            title="Among the expert's top picks in this category"
            className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-plum px-2 py-0.5 text-[10px] font-semibold text-white"
          >
            <Sparkles size={10} aria-hidden />
            AI pick
          </span>
        )}
        {item.source === "mock" && (
          <span
            title="Demo catalog data — not a live listing"
            className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-warn/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            Demo data
          </span>
        )}
        <WishlistButton
          input={snapshotFromBoardItem(item)}
          className="absolute right-2 top-2 z-10 !h-8 !w-8"
        />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        {item.merchant && (
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-ink-soft">
            {item.merchant}
          </p>
        )}
        <h4 className="line-clamp-2 text-xs font-medium leading-snug text-ink">{item.title}</h4>
        <p className="text-sm font-bold text-ink">{formatMinor(item.priceMinor, item.currency)}</p>

        <p className="flex gap-1.5 rounded-lg bg-plum-wash px-2 py-1.5 text-[11px] leading-relaxed text-ink">
          <Sparkles size={11} className="mt-0.5 shrink-0 text-plum" aria-hidden />
          <span className="line-clamp-3">{item.insight}</span>
        </p>

        {item.tradeoff && (
          <p className="text-[11px] leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Trade-off:</span> {item.tradeoff}
          </p>
        )}

        <div className="mt-auto flex gap-1.5 pt-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onMoreLike(item.productId)}
            aria-label={`Show products similar to ${item.title}`}
            title="Find very similar options anchored on this one"
            className={ACTION_CLASS}
          >
            <Sparkles size={12} aria-hidden />
            Show Similar
          </button>
          <ShortlistButton
            item={snapshotFromBoardItem(item)}
            labeled
            className={ACTION_CLASS}
          />
        </div>
      </div>
    </article>
  );
}
