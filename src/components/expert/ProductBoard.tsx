"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { VerifiedBoardCategory, VerifiedBoardItem } from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinor } from "@/lib/gift/currency";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { ShortlistButton } from "@/components/shortlist/ShortlistButton";
import { snapshotFromBoardItem } from "@/lib/wishlist/snapshot";
import { QuickViewModal } from "@/components/expert/QuickViewModal";
import { pickDefaultVariant } from "@/components/expert/VariantSelector";

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
  onOpenProduct,
  busy = false,
  layout = "rail",
  sort = "picks",
  showHeading = true,
}: {
  /** Accumulated across turns by the page — categories never vanish. */
  board: VerifiedBoardCategory[];
  /** "Show Similar" → a similarity search anchored on this product. */
  onMoreLike: (productId: string) => void;
  /** Fired when the shopper opens a listing — the moment worth learning from. */
  onOpenProduct?: (item: VerifiedBoardItem) => void;
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
  const [quickView, setQuickView] = useState<VerifiedBoardItem | null>(null);

  return (
    <section aria-label="Products found" className="space-y-3">
      <QuickViewModal
        item={quickView}
        onClose={() => setQuickView(null)}
        onOpenProduct={onOpenProduct}
      />
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
              onOpenProduct={onOpenProduct}
              onQuickView={setQuickView}
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
  onOpenProduct,
  onQuickView,
  busy,
  layout,
  sort,
}: {
  category: VerifiedBoardCategory;
  onMoreLike: (productId: string) => void;
  onOpenProduct?: (item: VerifiedBoardItem) => void;
  onQuickView: (item: VerifiedBoardItem) => void;
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
      <section aria-label={category.name} className="scroll-mt-20 space-y-3">
        <div className="sticky top-[3.75rem] z-20 -mx-1 bg-cream/92 px-1 py-2 backdrop-blur-sm">
          {heading}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item, i) => (
            <div
              key={item.productId}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(i * 40, 240)}ms` }}
            >
              <BoardCard
                item={item}
                onMoreLike={onMoreLike}
                onOpenProduct={onOpenProduct}
                onQuickView={onQuickView}
                busy={busy}
              />
            </div>
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
              <BoardCard
                item={item}
                onMoreLike={onMoreLike}
                onOpenProduct={onOpenProduct}
                onQuickView={onQuickView}
                busy={busy}
              />
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
  onOpenProduct,
  onQuickView,
  busy,
}: {
  item: VerifiedBoardItem;
  onMoreLike: (productId: string) => void;
  onOpenProduct?: (item: VerifiedBoardItem) => void;
  onQuickView: (item: VerifiedBoardItem) => void;
  busy: boolean;
}) {
  const open = () => {
    onOpenProduct?.(item);
    onQuickView(item);
  };

  // The card shows the default variant; the full variant picker lives in quick view.
  const defaultId = pickDefaultVariant(item.facts);
  const variant = item.facts.variants.find((v) => v.id === defaultId) ?? null;
  const priceMinor = variant?.priceMinor ?? item.priceMinor;
  const currency = variant?.currency ?? item.currency;
  const imageUrl = variant?.imageUrl ?? item.imageUrl;

  const base = snapshotFromBoardItem(item);
  const snapshot = variant
    ? {
        ...base,
        url: variant.url ?? base.url,
        priceMinor: variant.priceMinor ?? base.priceMinor,
        priceMaxMinor: variant.priceMinor ?? base.priceMaxMinor,
        currency: variant.currency ?? base.currency,
      }
    : base;

  // Stock + variant count read inline next to the price, like the prototype.
  const { totalVariants: total, inStockVariants: inStock, rating } = item.facts;
  const hasStockSignal = item.facts.variants.some((v) => v.available !== null);
  const outOfStock = hasStockSignal && inStock === 0;
  const stockLabel = !hasStockSignal
    ? null
    : inStock === 0
      ? "Out of stock"
      : total > 1
        ? `${inStock} of ${total} in stock`
        : "In stock";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[18px] border border-line bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-(--shadow-hover)">
      {/* Image opens the quick-view modal, where the full detail lives. */}
      <button
        type="button"
        onClick={open}
        aria-label={`Quick view ${item.title}`}
        className="relative block w-full"
      >
        <ProductImage
          src={imageUrl}
          alt={item.title}
          className="aspect-square w-full transition-transform duration-300 group-hover:scale-105"
        />
        {item.isPick && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-butter px-2.5 py-1 text-[11.5px] font-semibold text-ink">
            <Check size={11} strokeWidth={2.4} aria-hidden />
            Best match
          </span>
        )}
        {item.source === "mock" && (
          <span
            title="Demo catalog data — not a live listing"
            className="absolute bottom-3 left-3 rounded-full bg-warn/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            Demo
          </span>
        )}
      </button>
      <WishlistButton input={snapshot} className="absolute right-2.5 top-2.5 z-10 !h-8 !w-8" />

      <div className="flex flex-1 flex-col px-[15px] pb-[15px] pt-3">
        {item.merchant && (
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            {item.merchant}
          </p>
        )}
        <button
          type="button"
          onClick={open}
          className="mt-[3px] line-clamp-2 text-left text-sm font-medium leading-[1.4] text-ink transition-colors hover:text-plum"
        >
          {item.title}
          {total > 1 && <span className="text-ink-faint"> · {total} variants</span>}
        </button>

        <div className="mt-[7px] flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[15.5px] font-semibold text-ink">
            {formatMinor(priceMinor, currency)}
          </span>
          {rating.value != null && (
            <span className="text-[12.5px] font-medium text-ink-soft">
              {rating.value}
              {rating.count != null && (
                <span className="ml-0.5 font-normal text-ink-faint">({rating.count})</span>
              )}
            </span>
          )}
        </div>

        {stockLabel && (
          <span
            className={`mt-1.5 inline-flex items-center gap-1 text-[11.5px] ${
              outOfStock ? "text-warn" : "text-ok"
            }`}
          >
            {!outOfStock && <Check size={11} strokeWidth={2.4} aria-hidden />}
            {stockLabel}
          </span>
        )}

        {item.insight && (
          <p className="mt-[7px] line-clamp-2 text-[12.5px] leading-[1.5] text-ink-soft">
            {item.insight}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-3">
          <ShortlistButton
            item={snapshot}
            labeled
            className="flex-1 rounded-full bg-plum py-2 text-[13px] font-semibold text-white transition-colors hover:bg-plum-dark active:scale-[0.98] [&_svg]:hidden"
          />
          <button
            type="button"
            onClick={() => onMoreLike(item.productId)}
            disabled={busy}
            aria-label={`Show products similar to ${item.title}`}
            className="rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
          >
            Similar
          </button>
        </div>
      </div>
    </article>
  );
}
