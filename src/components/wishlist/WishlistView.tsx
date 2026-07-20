"use client";

import Link from "next/link";
import { ExternalLink, Heart, Star, Trash2 } from "lucide-react";
import { useWishlist } from "@/components/wishlist/WishlistProvider";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinorRange } from "@/lib/gift/currency";
import type { WishlistItem } from "@/lib/wishlist/types";

export function WishlistView() {
  const { items, ready, remove } = useWishlist();

  if (!ready) {
    return (
      <p className="text-sm text-ink-soft" role="status">
        Loading your wishlist…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-plum-wash text-plum">
          <Heart size={22} aria-hidden />
        </span>
        <p className="font-(family-name:--font-display) text-xl text-ink">
          No saved products yet
        </p>
        <p className="max-w-sm text-sm text-ink-soft">
          Tap the heart on any recommendation to save it here — it stays on your
          account across devices.
        </p>
        <Link href="/shop" className="btn-primary mt-1 text-sm">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <WishlistCard
          key={`${item.source}:${item.productId}`}
          item={item}
          onRemove={() => remove(item.productId, item.source)}
        />
      ))}
    </div>
  );
}

function WishlistCard({
  item,
  onRemove,
}: {
  item: WishlistItem;
  onRemove: () => void;
}) {
  const price = formatMinorRange(item.priceMinor, item.priceMaxMinor, item.currency);
  const availability =
    item.available == null
      ? null
      : item.available
        ? "Available"
        : "Availability unconfirmed";

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative">
        <ProductImage
          src={item.imageUrl ?? undefined}
          alt={item.title}
          className="h-44 w-full"
        />
        <span
          className={`absolute bottom-3 left-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            item.source === "live" ? "bg-ok/90 text-white" : "bg-warn/90 text-white"
          }`}
        >
          {item.source === "live" ? "Live" : "Mock"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-medium leading-snug">{item.title}</h3>

        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <dd className="font-semibold">{price}</dd>
          {item.brand && <dd className="text-ink-soft">{item.brand}</dd>}
          {item.rating?.value != null && (
            <dd className="inline-flex items-center gap-1 text-ink-soft">
              <Star size={13} className="fill-gold text-gold" aria-hidden />
              {item.rating.value}
              {item.rating.count != null && (
                <span className="text-xs">({item.rating.count})</span>
              )}
            </dd>
          )}
        </dl>

        <p className="text-xs">
          {availability ? (
            <span className={item.available ? "text-ok" : "text-danger"}>
              {availability}
            </span>
          ) : (
            <span className="text-ink-soft">Availability —</span>
          )}
        </p>

        <div className="mt-auto flex gap-2 pt-2">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary flex-1 !px-3 !py-2 text-sm"
            >
              <ExternalLink size={14} aria-hidden />
              View Product
            </a>
          ) : (
            <span className="btn-secondary flex-1 cursor-not-allowed !px-3 !py-2 text-sm opacity-50">
              No link
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.title} from wishlist`}
            className="btn-secondary !px-3 !py-2 text-sm hover:!border-danger hover:!text-danger"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}
