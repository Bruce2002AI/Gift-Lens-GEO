"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Sparkles, X } from "lucide-react";
import type { VerifiedBoardItem } from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { ProductFactsPanel, ProductFactsSummary } from "@/components/catalog/ProductFacts";
import { VariantSelector, pickDefaultVariant } from "@/components/expert/VariantSelector";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { ShortlistButton } from "@/components/shortlist/ShortlistButton";
import { snapshotFromBoardItem } from "@/lib/wishlist/snapshot";
import { formatMinor } from "@/lib/gift/currency";

/**
 * Full product detail in a modal — the reasoning (insight, trade-off) and the
 * complete catalog record that used to crowd the grid card live here, one tap
 * away. Layout: image carousel + core details up top, the full specification
 * panel spanning the width below so expanding it never distorts the columns.
 */
export function QuickViewModal({
  item,
  onClose,
  onOpenProduct,
}: {
  item: VerifiedBoardItem | null;
  onClose: () => void;
  onOpenProduct?: (item: VerifiedBoardItem) => void;
}) {
  const [active, setActive] = useState(0);
  const [variantId, setVariantId] = useState<string | null>(item ? pickDefaultVariant(item.facts) : null);
  const [activeFor, setActiveFor] = useState(item?.productId);

  // Reset carousel + variant when a different product opens — the render-time
  // "adjust state on prop change" pattern (no effect, no stale first frame).
  if (item && item.productId !== activeFor) {
    setActiveFor(item.productId);
    setActive(0);
    setVariantId(pickDefaultVariant(item.facts));
  }

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  // Gallery = the primary image followed by any catalog images (deduped),
  // limited to still images so a thumbnail click always swaps a real picture.
  const gallery = useMemo(() => {
    if (!item) return [] as Array<{ url: string; altText: string | null }>;
    const seen = new Set<string>();
    const out: Array<{ url: string; altText: string | null }> = [];
    const push = (url: string | null, altText: string | null) => {
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({ url, altText });
      }
    };
    push(item.imageUrl, item.title);
    for (const img of item.facts.images) {
      if (img.type == null || img.type === "image") push(img.url, img.altText);
    }
    for (const v of item.facts.variants) push(v.imageUrl, v.title);
    return out;
  }, [item]);

  if (!item) return null;

  const selectedVariant = item.facts.variants.find((v) => v.id === variantId) ?? null;
  const priceMinor = selectedVariant?.priceMinor ?? item.priceMinor;
  const currency = selectedVariant?.currency ?? item.currency;
  const mainImage = gallery[active]?.url ?? item.imageUrl;

  // Shortlist/wishlist against the CHOSEN variant, so the cart permalink and
  // price track the selection (keyed by productId, so it stays one cart line).
  const base = snapshotFromBoardItem(item);
  const snapshot = selectedVariant
    ? {
        ...base,
        url: selectedVariant.url ?? base.url,
        priceMinor: selectedVariant.priceMinor ?? base.priceMinor,
        priceMaxMinor: selectedVariant.priceMinor ?? base.priceMaxMinor,
        currency: selectedVariant.currency ?? base.currency,
      }
    : base;

  // Selecting a variant jumps the carousel to that variant's image when it has one.
  const selectVariant = (id: string) => {
    setVariantId(id);
    const url = item.facts.variants.find((v) => v.id === id)?.imageUrl;
    if (url) {
      const idx = gallery.findIndex((g) => g.url === url);
      if (idx >= 0) setActive(idx);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="animate-rise flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-(--shadow-lift) sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Quick view
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick view"
            className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-sand active:scale-90"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto">
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            {/* Image carousel */}
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-xl bg-sand/40">
                <ProductImage
                  src={mainImage}
                  alt={gallery[active]?.altText ?? item.title}
                  className="aspect-square w-full"
                />
                {item.isPick && (
                  <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-plum px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Sparkles size={11} aria-hidden />
                    AI pick
                  </span>
                )}
                <WishlistButton input={snapshot} className="absolute right-3 top-3 !h-9 !w-9" />
              </div>

              {gallery.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((img, i) => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => setActive(i)}
                      aria-label={`Show image ${i + 1}`}
                      aria-current={i === active}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                        i === active ? "border-plum" : "border-line hover:border-plum/40"
                      }`}
                    >
                      <ProductImage
                        src={img.url}
                        alt={img.altText ?? `${item.title} image ${i + 1}`}
                        className="h-full w-full"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Core details */}
            <div className="flex flex-col gap-3">
              {item.merchant && (
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                  {item.merchant}
                </p>
              )}
              <h2 className="font-(family-name:--font-display) text-xl font-semibold leading-snug">
                {item.title}
              </h2>
              <p className="text-2xl font-bold text-ink">{formatMinor(priceMinor, currency)}</p>

              <ProductFactsSummary facts={item.facts} />

              <VariantSelector
                facts={item.facts}
                selectedId={variantId}
                onSelect={selectVariant}
                mode="dropdown"
              />

              <div className="rounded-xl bg-butter-soft px-4 py-3 text-sm leading-relaxed text-ink">
                <span className="font-semibold">Why it fits: </span>
                {item.insight}
              </div>

              {item.tradeoff && (
                <p className="text-sm leading-relaxed text-ink-soft">
                  <span className="font-semibold text-ink">Worth knowing:</span> {item.tradeoff}
                </p>
              )}

              {item.source === "mock" && (
                <p className="text-xs text-warn">Demo catalog data — not a live listing.</p>
              )}

              <div className="mt-auto space-y-2 pt-2">
                <ShortlistButton item={snapshot} labeled className="btn-primary w-full !py-2.5" />
                {item.productUrl && (
                  <a
                    href={item.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOpenProduct?.(item)}
                    className="btn-secondary w-full !py-2.5 text-sm"
                  >
                    <ExternalLink size={14} aria-hidden />
                    View on merchant
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Full specifications — spans the width so expanding it never breaks
              the two-column layout above. */}
          <div className="border-t border-line px-5 py-4">
            <ProductFactsPanel
              facts={item.facts}
              productId={item.productId}
              source={item.source}
              hideMedia
            />
          </div>
        </div>
      </div>
    </div>
  );
}
