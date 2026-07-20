"use client";

import { Check, ShoppingCart } from "lucide-react";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";
import type { ShortlistItem } from "@/lib/shortlist/types";

/**
 * Add/remove toggle for the session shortlist. Self-contained via context, so
 * parents only supply the product snapshot and positioning.
 *
 * - `labeled` renders a full text button (icon + "Shortlist"/"Shortlisted"),
 *   styled entirely by the passed `className` (e.g. `btn-secondary`).
 * - default renders a compact round icon button.
 */
export function ShortlistButton({
  item,
  className = "",
  labeled = false,
}: {
  item: ShortlistItem;
  className?: string;
  labeled?: boolean;
}) {
  const { isShortlisted, toggle } = useShortlist();
  const inList = isShortlisted(item.productId, item.source);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(item);
  };

  if (labeled) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={inList}
        aria-label={inList ? "Remove from shortlist" : "Add to shortlist"}
        className={className}
      >
        {inList ? (
          <Check size={14} aria-hidden className="text-plum" />
        ) : (
          <ShoppingCart size={14} aria-hidden />
        )}
        {inList ? "Shortlisted" : "Shortlist"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={inList}
      aria-label={inList ? "Remove from shortlist" : "Add to shortlist"}
      title={inList ? "Remove from shortlist" : "Add to shortlist"}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-(--shadow-card) backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 ${
        inList ? "text-plum" : "text-ink-soft"
      } ${className}`}
    >
      {inList ? <Check size={17} aria-hidden /> : <ShoppingCart size={16} aria-hidden />}
    </button>
  );
}
