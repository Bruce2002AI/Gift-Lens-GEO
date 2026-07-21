"use client";

import { Award, ExternalLink, ShieldCheck, Sparkles, Star, type LucideIcon } from "lucide-react";
import type { VerifiedCard } from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import {
  ProductFactsPanel,
  ProductFactsSummary,
} from "@/components/catalog/ProductFacts";
import { formatMinor } from "@/lib/gift/currency";

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The role is free text from the agent — map it onto the house badge language
 * by intent rather than by an enum the contract doesn't have.
 */
function roleMeta(role: string): { Icon: LucideIcon; className: string } {
  if (/best|match/i.test(role)) return { Icon: Award, className: "bg-plum text-white" };
  if (/delight|surprise|never buy/i.test(role)) {
    return { Icon: Sparkles, className: "bg-gold text-white" };
  }
  if (/safe|budget|value/i.test(role)) return { Icon: ShieldCheck, className: "bg-ink text-white" };
  return { Icon: Star, className: "bg-white/90 text-ink ring-1 ring-line" };
}

/**
 * A server-notarized product card. The interpretive "Why I picked this"
 * stratum leads (it's the justification the shopper is here for); the
 * evidence-verified "From the listing" stratum stays available but secondary,
 * so the two never blur together.
 */
export function ExpertCard({
  card,
  onMoreLike,
}: {
  card: VerifiedCard;
  /** "More like this" → a similarity search anchored on this product. */
  onMoreLike: (productId: string) => void;
}) {
  const { Icon: RoleIcon, className: roleClass } = roleMeta(card.role ?? "");

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative">
        <ProductImage src={card.imageUrl} alt={card.title} className="h-44 w-full" />
        {card.role && (
          <span
            className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${roleClass}`}
          >
            <RoleIcon size={12} aria-hidden />
            {card.role}
          </span>
        )}
        <span
          className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            card.source === "live" ? "bg-ok/90 text-white" : "bg-warn/90 text-white"
          }`}
          title={
            card.source === "live"
              ? "Live catalog listing"
              : "Demo catalog data — not a live listing"
          }
        >
          {card.source === "live" ? "Live" : "Demo data"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h4 className="line-clamp-2 font-medium leading-snug">{card.title}</h4>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">{formatMinor(card.priceMinor, card.currency)}</span>
          {card.merchant && <span className="text-ink-soft">{card.merchant}</span>}
        </div>

        {/* Rating, stock and condition stay visible — never behind a disclosure. */}
        <ProductFactsSummary facts={card.facts} />

        {card.whyForYou.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-plum">
              Why I picked this
            </p>
            <ul className="mt-1.5 space-y-1.5 text-sm leading-snug text-ink">
              {card.whyForYou.map((why, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-plum"
                  />
                  {why}
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.tradeoff && (
          <p className="rounded-lg bg-sand/60 px-3 py-2 text-xs leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Trade-off:</span> {card.tradeoff}
          </p>
        )}

        {card.runnerUp && (
          <p className="text-xs leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">What it beat:</span> {card.runnerUp}
          </p>
        )}

        {card.claims.length > 0 && (
          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              From the listing ({card.claims.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {card.claims.map((claim, i) => (
                <li key={i}>
                  <details>
                    <summary
                      className="cursor-pointer text-sm leading-snug text-ink"
                      title="Expand to see the exact listing text behind this claim"
                    >
                      {claim.text}
                    </summary>
                    <p className="mt-1 rounded bg-sand/60 px-2 py-1 text-xs leading-relaxed text-ink-soft">
                      <span className="font-semibold text-ink">{claim.field}:</span> “{claim.quote}”
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        )}

        {card.droppedClaims > 0 && (
          <p className="text-[11px] italic leading-relaxed text-ink-soft">
            {card.droppedClaims} claim{card.droppedClaims === 1 ? "" : "s"} couldn&apos;t be verified
            against the listing and {card.droppedClaims === 1 ? "was" : "were"} dropped.
          </p>
        )}

        {/* Everything else UCP returned — collapsed so the card stays scannable. */}
        <ProductFactsPanel
          facts={card.facts}
          productId={card.productId}
          source={card.source}
        />

        <div className="mt-auto space-y-2 pt-1">
          <p className="text-[11px] leading-relaxed text-ink-soft">{card.logistics}</p>
          <p className="text-[10px] text-ink-soft">evidence as of {formatAsOf(card.asOf)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onMoreLike(card.productId)}
              aria-label={`Show more products like ${card.title}`}
              title="Find very similar picks anchored on this one"
              className="btn-secondary flex-1 !px-3 !py-2 text-sm"
            >
              <Sparkles size={14} aria-hidden />
              More like this
            </button>
            {card.productUrl && (
              <a
                href={card.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1 !px-3 !py-2 text-sm"
              >
                <ExternalLink size={14} aria-hidden />
                View on merchant
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
