"use client";

import { Heart } from "lucide-react";
import { useWishlist } from "@/components/wishlist/WishlistProvider";
import type { WishlistItemInput } from "@/lib/wishlist/types";

/**
 * Heart toggle for a recommendation card. Self-contained: reads/writes the
 * wishlist context, so parents only supply the product snapshot and positioning.
 */
export function WishlistButton({
  input,
  className = "",
}: {
  input: WishlistItemInput;
  className?: string;
}) {
  const { isWishlisted, toggle } = useWishlist();
  const saved = isWishlisted(input.productId, input.source);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(input);
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Add to wishlist"}
      title={saved ? "Remove from wishlist" : "Add to wishlist"}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-(--shadow-card) backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 ${className}`}
    >
      <Heart
        size={17}
        aria-hidden
        className={saved ? "fill-plum text-plum" : "text-ink-soft"}
      />
    </button>
  );
}
