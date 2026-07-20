"use client";

import { useEffect } from "react";
import { ExternalLink, ShoppingCart, Trash2, X } from "lucide-react";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinorRange } from "@/lib/gift/currency";

/**
 * Slide-over shortlist ("cart"). Lists the session's shortlisted products.
 * Because the Catalog API only supports single-product checkout, each item
 * links to its own merchant checkout — there is no combined "buy all".
 */
export function ShortlistDrawer() {
  const { items, open, closeDrawer, remove, clear } = useShortlist();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-ink/40"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && closeDrawer()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your shortlist"
        className="flex h-full w-full max-w-md flex-col bg-white shadow-(--shadow-lift)"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-(family-name:--font-display) text-lg font-semibold">
            <ShoppingCart size={18} className="text-plum" aria-hidden />
            Your shortlist
            {items.length > 0 && (
              <span className="rounded-full bg-plum-wash px-2 py-0.5 text-sm font-medium text-plum">
                {items.length}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close shortlist"
            className="rounded-full p-2 text-ink-soft hover:bg-sand"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <p className="border-b border-line bg-cream-deep/50 px-5 py-2 text-xs text-ink-soft">
          Kept for this session only. Checkout is per product — each item goes to
          its own merchant.
        </p>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-ink-soft">
              <ShoppingCart size={28} aria-hidden className="text-line" />
              <p className="text-sm">
                Your shortlist is empty. Tap the bag icon on any recommendation to
                add it here.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={`${item.source}:${item.productId}`} className="card flex gap-3 p-3">
                  <ProductImage
                    src={item.imageUrl ?? undefined}
                    alt={item.title}
                    className="h-16 w-16 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {item.title}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {formatMinorRange(item.priceMinor, item.priceMaxMinor, item.currency)}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </p>
                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-plum hover:text-plum-dark"
                        >
                          <ExternalLink size={12} aria-hidden />
                          Checkout
                        </a>
                      ) : (
                        <span className="text-ink-soft/60">No checkout link</span>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(item.productId, item.source)}
                        className="inline-flex items-center gap-1 text-ink-soft hover:text-danger"
                      >
                        <Trash2 size={12} aria-hidden />
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={clear}
              className="text-sm font-medium text-ink-soft hover:text-danger"
            >
              Clear shortlist
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
