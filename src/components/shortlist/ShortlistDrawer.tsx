"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingCart, Store, Trash2, X } from "lucide-react";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";
import { useToast } from "@/components/ui/ToastProvider";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinor } from "@/lib/gift/currency";
import { groupByShop } from "@/lib/shortlist/checkout";

/**
 * Slide-over cart. Shortlisted products are grouped by store, each line has a
 * quantity stepper and a delete control, and one Checkout button turns the
 * shortlist into Shopify cart permalinks (one per store) and opens them.
 */
export function ShortlistDrawer() {
  const { items, open, closeDrawer, remove, setQuantity, clear } = useShortlist();
  const { toast } = useToast();

  // Keep the drawer mounted through its exit animation. `render` controls
  // mount/unmount; `shown` drives the enter/leave transition classes.
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      // Mount synchronously so the off-screen state can paint before the rAF
      // flip below animates it in — the transition needs both frames.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRender(true);
      // Double rAF: the first frame lets the browser paint the off-screen
      // state (translate-x-full / opacity-0); the second flips to the visible
      // state so the transition actually runs. A single frame paints too late
      // and the enter animation gets skipped.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const t = setTimeout(() => setRender(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer]);

  const groups = useMemo(() => groupByShop(items), [items]);

  // Checkout is per store: a Shopify cart permalink is scoped to a single
  // domain, so each store gets its own button that builds its cart permalink
  // (`…/cart/{variantId}:{qty},…`) and redirects there.
  const checkoutStore = (group: (typeof groups)[number]) => {
    if (!group.cartUrl) {
      toast("No checkout link available for this store");
      return;
    }
    window.open(group.cartUrl, "_blank", "noopener,noreferrer");
  };

  if (!render) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-end bg-ink/40 transition-opacity duration-300 ease-out ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && closeDrawer()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        className={`flex h-full w-full max-w-md flex-col bg-cream shadow-(--shadow-lift) transition-transform duration-300 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4">
          <h2 className="flex items-center gap-2 font-(family-name:--font-display) text-lg font-semibold">
            <ShoppingCart size={18} className="text-plum" aria-hidden />
            Your cart
            {items.length > 0 && (
              <span className="rounded-full bg-plum-wash px-2 py-0.5 text-sm font-medium text-plum">
                {items.length}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close cart"
            className="rounded-full p-2 text-ink-soft transition-colors hover:bg-sand active:scale-90"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-fade p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-ink-soft">
              <ShoppingCart size={28} aria-hidden className="text-line" />
              <p className="text-sm">
                Your cart is empty. Tap the bag icon on any recommendation to add it here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section
                  key={group.shop}
                  aria-label={group.shop}
                  className="overflow-hidden rounded-2xl border border-line bg-white"
                >
                  <div className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5">
                    <Store size={12} className="shrink-0 text-plum" aria-hidden />
                    <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      {group.shop}
                    </h3>
                  </div>

                  <ul className="divide-y divide-line">
                    {group.entries.map((item) => (
                      <li
                        key={`${item.source}:${item.productId}`}
                        className="flex gap-3 p-3"
                      >
                        <ProductImage
                          src={item.imageUrl ?? undefined}
                          alt={item.title}
                          className="h-16 w-16 shrink-0 rounded-lg"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <p className="line-clamp-2 text-sm font-medium leading-snug">
                            {item.title}
                          </p>
                          <p className="text-sm font-semibold text-ink">
                            {formatMinor(item.priceMinor, item.currency)}
                          </p>

                          <div className="mt-auto flex items-center justify-between gap-2">
                            {/* Quantity stepper */}
                            <div className="inline-flex items-center rounded-full border border-line bg-white">
                              <button
                                type="button"
                                onClick={() => setQuantity(item.productId, item.source, -1)}
                                disabled={item.quantity <= 1}
                                aria-label={`Decrease quantity of ${item.title}`}
                                className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition-colors hover:text-plum active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Minus size={13} aria-hidden />
                              </button>
                              <span className="w-6 text-center text-sm font-medium tabular-nums text-ink">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => setQuantity(item.productId, item.source, 1)}
                                aria-label={`Increase quantity of ${item.title}`}
                                className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition-colors hover:text-plum active:scale-90"
                              >
                                <Plus size={13} aria-hidden />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => remove(item.productId, item.source)}
                              aria-label={`Remove ${item.title}`}
                              className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-danger/10 hover:text-danger active:scale-90"
                            >
                              <Trash2 size={15} aria-hidden />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between gap-3 border-t border-line bg-cream-deep/40 px-3.5 py-3">
                    <div className="min-w-0 text-sm">
                      <span className="text-ink-soft">Subtotal</span>{" "}
                      <span className="font-semibold text-ink">
                        {group.subtotalMinor != null
                          ? formatMinor(group.subtotalMinor, group.currency)
                          : "—"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => checkoutStore(group)}
                      disabled={!group.cartUrl}
                      aria-label={`Add ${group.shop} items to cart`}
                      className="btn-primary shrink-0 !px-4 !py-2 text-sm active:scale-[0.98]"
                    >
                      Add to cart
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="flex items-center justify-between border-t border-line bg-white px-5 py-3">
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-ink-soft transition-colors hover:text-danger"
            >
              Clear cart
            </button>
            <span className="text-[11px] text-ink-soft/70">
              Checkout is per store · secure on Shopify
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
