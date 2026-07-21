"use client";

import {
  Award,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { GiftRecommendation } from "@/lib/gift/types";
import type { ModeBadge } from "@/lib/modes/types";
import { formatMinorRange } from "@/lib/gift/currency";
import { ProductImage } from "@/components/catalog/ProductImage";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { ShortlistButton } from "@/components/shortlist/ShortlistButton";
import { snapshotFromProduct } from "@/lib/wishlist/snapshot";

const ROLE_META = {
  best_match: {
    label: "Best Match",
    icon: Award,
    className: "bg-plum text-white",
    blurb: "Highest overall fit",
  },
  delight_pick: {
    label: "Delight Pick",
    icon: Sparkles,
    className: "bg-gold text-white",
    blurb: "Surprising but defensible",
  },
  safe_pick: {
    label: "Safe Pick",
    icon: ShieldCheck,
    className: "bg-ink text-white",
    blurb: "Broadly appealing, low-risk",
  },
  more: {
    label: "Great match",
    icon: Star,
    className: "bg-white/90 text-ink ring-1 ring-line",
    blurb: "Strong overall fit",
  },
} as const;

export function RecommendationCard({
  rec,
  badges,
}: {
  rec: GiftRecommendation;
  /** Mode-supplied badge labels; falls back to the gift role labels. */
  badges?: ModeBadge[];
}) {
  const roleMeta = ROLE_META[rec.role as keyof typeof ROLE_META] ?? ROLE_META.more;
  const modeBadge = badges?.find((b) => b.key === rec.role);
  const meta = {
    ...roleMeta,
    label: modeBadge?.label ?? roleMeta.label,
    blurb: modeBadge?.blurb ?? roleMeta.blurb,
  };
  const RoleIcon = meta.icon;
  const p = rec.product;
  const variant =
    p.variants.find((v) => v.id === rec.variantId) ??
    p.variants.find((v) => v.available) ??
    p.variants[0];
  const buyUrl = variant?.checkoutUrl ?? variant?.url ?? variant?.seller?.url ?? p.url;
  const buyLabel = variant?.checkoutUrl ? "Continue to checkout" : "View on store";
  // Prefer the product page (not checkout) for the image-click redirect.
  const viewUrl = variant?.url ?? p.url ?? variant?.seller?.url ?? variant?.checkoutUrl ?? null;
  const available = p.variants.some((v) => v.available === true);
  const price = formatMinorRange(
    p.priceRange.minMinor,
    p.priceRange.maxMinor,
    p.priceRange.currency,
  );

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative">
        {viewUrl ? (
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${p.title} on the merchant site (opens in a new tab)`}
            className="group block"
          >
            <ProductImage
              src={p.images[0]?.url}
              alt={p.images[0]?.altText ?? p.title}
              className="h-44 w-full transition-transform duration-300 group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition-all duration-200 group-hover:bg-ink/30 group-hover:opacity-100">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-ink shadow-(--shadow-card)">
                <ExternalLink size={12} aria-hidden />
                View product
              </span>
            </span>
          </a>
        ) : (
          <ProductImage
            src={p.images[0]?.url}
            alt={p.images[0]?.altText ?? p.title}
            className="h-44 w-full"
          />
        )}
        <span
          className={`pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.className}`}
        >
          <RoleIcon size={12} aria-hidden />
          {meta.label}
        </span>
        <span
          className={`pointer-events-none absolute bottom-3 left-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            rec.source === "live" ? "bg-ok/90 text-white" : "bg-warn/90 text-white"
          }`}
        >
          {rec.source === "live" ? "Live" : "Mock"}
        </span>
        <WishlistButton
          input={snapshotFromProduct(rec)}
          className="absolute right-3 top-3 z-10"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-xs text-ink-soft">{meta.blurb}</p>
          <h3 className="mt-0.5 line-clamp-2 font-medium leading-snug">{p.title}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">{price}</span>
          {variant?.seller?.name && (
            <span className="text-ink-soft">{variant.seller.name}</span>
          )}
          {p.rating.value != null && (
            <span className="inline-flex items-center gap-1 text-ink-soft">
              <Star size={13} className="fill-gold text-gold" aria-hidden />
              {p.rating.value}
              {p.rating.count != null && (
                <span className="text-xs">({p.rating.count})</span>
              )}
            </span>
          )}
          <span
            className={`text-xs font-medium ${available ? "text-ok" : "text-danger"}`}
          >
            {available ? "Available" : "Availability unconfirmed"}
          </span>
        </div>

        <ul className="space-y-1.5 text-sm leading-snug text-ink">
          {rec.reasons.slice(0, 3).map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-plum" />
              {reason}
            </li>
          ))}
        </ul>

        <p className="rounded-lg bg-sand/60 px-3 py-2 text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Trade-off:</span> {rec.tradeoff}
        </p>

        {rec.evidence.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Evidence sources">
            {rec.evidence.slice(0, 4).map((e) => (
              <span
                key={`${e.sourceField}-${e.claim}`}
                title={e.claim}
                className="rounded-full border border-line bg-white px-2 py-0.5 text-[10px] text-ink-soft"
              >
                {e.sourceField}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span>
              Confidence:{" "}
              <span
                className={
                  rec.confidence === "high"
                    ? "font-semibold text-ok"
                    : rec.confidence === "medium"
                      ? "font-semibold text-warn"
                      : "font-semibold text-danger"
                }
              >
                {rec.confidence}
              </span>
            </span>
            <span>Score {(rec.totalScore * 100).toFixed(0)}/100</span>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-soft">{rec.logisticsMessage}</p>
          <div className="flex gap-2">
            <ShortlistButton
              item={snapshotFromProduct(rec)}
              labeled
              className="btn-secondary flex-1 !px-3 !py-2 text-sm"
            />
            {buyUrl && available && (
              <a
                href={buyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1 !px-3 !py-2 text-sm"
              >
                <ExternalLink size={14} aria-hidden />
                {buyLabel}
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
