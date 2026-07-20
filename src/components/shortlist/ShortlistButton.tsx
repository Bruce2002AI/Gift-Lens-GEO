"use client";

import { Check, ShoppingCart } from "lucide-react";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";
import type { ShortlistItem } from "@/lib/shortlist/types";

/**
 * Add/remove toggle for the session shortlist. Self-contained via context, so
 * parents only supply the product snapshot and positioning.
 */
export function ShortlistButton({
  item,
  className = "",
}: {
  item: ShortlistItem;
  className?: string;
}) {
  const { isShortlisted, toggle } = useShortlist();
  const inList = isShortlisted(item.productId, item.source);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(item);
      }}
      aria-pressed={inList}
      aria-label={inList ? "Remove from shortlist" : "Add to shortlist"}
      title={inList ? "Remove from shortlist" : "Add to shortlist"}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-(--shadow-card) backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 ${
        inList ? "text-plum" : "text-ink-soft"
      } ${className}`}
    >
      {inList ? (
        <Check size={17} aria-hidden />
      ) : (
        <ShoppingCart size={16} aria-hidden />
      )}
    </button>
  );
}
