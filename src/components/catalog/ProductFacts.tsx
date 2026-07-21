"use client";

import {
  BadgeCheck,
  Boxes,
  FileText,
  Images,
  Info,
  ListChecks,
  Package,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tags,
} from "lucide-react";
import type { ProductFacts, ProductFactsVariant } from "@/lib/agent/types";
import type { CatalogSource, NormalizedRating } from "@/lib/catalog/types";
import { formatMinor } from "@/lib/gift/currency";

/**
 * Renders the COMPLETE catalog record for a product.
 *
 * Two strata, deliberately kept apart:
 *  - the agent's interpretation ("Why I picked this") lives on the card, and
 *  - everything here is raw catalog data with no model involvement, which is
 *    exactly why it can be shown verbatim.
 *
 * High-signal facts (rating, stock, condition) render ALWAYS; the long tail
 * (specs, variants, policies, media) sits behind a collapsed disclosure so a
 * dense card stays scannable.
 */

/** A 0–scaleMax star meter. Shows the scale so "4.7" is never context-free. */
export function StarRating({
  rating,
  size = 13,
  showCount = true,
}: {
  rating: NormalizedRating;
  size?: number;
  showCount?: boolean;
}) {
  if (rating.value == null) return null;
  const max = rating.scaleMax ?? 5;
  const stars = Math.max(1, Math.min(10, Math.round(max)));
  const pct = Math.max(0, Math.min(1, rating.value / max)) * 100;
  const label = `Rated ${rating.value} out of ${max}${
    rating.count != null ? ` from ${rating.count.toLocaleString()} reviews` : ""
  }`;

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Two stacked star rows, the gold one clipped to the score — exact fractions. */}
      <span className="relative inline-block leading-none" aria-hidden>
        <span className="flex text-line">
          {Array.from({ length: stars }, (_, i) => (
            <Star key={i} size={size} fill="currentColor" strokeWidth={0} />
          ))}
        </span>
        <span
          className="absolute inset-0 flex overflow-hidden text-gold"
          style={{ width: `${pct}%` }}
        >
          {Array.from({ length: stars }, (_, i) => (
            <Star key={i} size={size} fill="currentColor" strokeWidth={0} />
          ))}
        </span>
      </span>
      {/* The visible numerals are decorative: the sr-only label below carries
          the full meaning, so hiding them prevents "4.7/5 (1,284) Rated 4.7
          out of 5 from 1,284 reviews" being announced for every product. */}
      <span className="text-xs font-semibold text-ink" aria-hidden>
        {rating.value}
        <span className="font-normal text-ink-soft">/{max}</span>
      </span>
      {showCount && rating.count != null && (
        <span className="text-xs text-ink-soft" aria-hidden>
          ({rating.count.toLocaleString()})
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Small pill used for stock / condition / shipping signals. */
function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "bg-ok/10 text-ok ring-ok/20"
      : tone === "warn"
        ? "bg-warn/10 text-warn ring-warn/20"
        : "bg-sand text-ink-soft ring-line";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${toneClass}`}
    >
      {children}
    </span>
  );
}

/**
 * Always-visible high-signal facts: rating, stock, condition, variant count.
 * Terse by design — this sits directly under the title/price.
 */
export function ProductFactsSummary({ facts }: { facts: ProductFacts }) {
  const selected = facts.variants.find((v) => v.isSelected) ?? facts.variants[0] ?? null;
  const condition = selected?.condition ?? [];
  const hasStockSignal = facts.variants.some((v) => v.available !== null);
  const anyInStock = facts.inStockVariants > 0;

  const nothingToShow =
    facts.rating.value == null &&
    !hasStockSignal &&
    condition.length === 0 &&
    facts.totalVariants <= 1;
  if (nothingToShow) return null;

  const hasTags =
    hasStockSignal ||
    selected?.runningLow === true ||
    condition.length > 0 ||
    facts.totalVariants > 1;

  return (
    // Rating and tag pills sit on their own rows — a star meter and pills don't
    // share a baseline cleanly, so keep them stacked rather than inline.
    <div className="space-y-1.5">
      {facts.rating.value != null && <StarRating rating={facts.rating} />}

      {hasTags && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasStockSignal &&
            (anyInStock ? (
              <Pill tone="ok">
                <BadgeCheck size={11} aria-hidden />
                {facts.totalVariants > 1
                  ? `${facts.inStockVariants} of ${facts.totalVariants} in stock`
                  : "In stock"}
              </Pill>
            ) : (
              <Pill tone="warn">Out of stock</Pill>
            ))}

          {selected?.runningLow === true && <Pill tone="warn">Running low</Pill>}

          {condition.map((c) => (
            <Pill key={c}>{c === "new" ? "New" : c}</Pill>
          ))}

          {facts.totalVariants > 1 && (
            <Pill>
              <Boxes size={11} aria-hidden />
              {facts.totalVariants} variants
            </Pill>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Info;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h5 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
        <Icon size={12} aria-hidden />
        {title}
        {count != null && <span className="font-normal normal-case">({count})</span>}
      </h5>
      {children}
    </section>
  );
}

function VariantRow({ v }: { v: ProductFactsVariant }) {
  const optionLabel =
    v.options.length > 0
      ? v.options.map((o) => `${o.name}: ${o.label}`).join(" · ")
      : v.title || "Variant";

  return (
    <li
      className={`rounded-lg border px-2.5 py-2 ${
        v.isSelected ? "border-plum bg-plum-wash" : "border-line bg-white"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-ink">
          {optionLabel}
          {v.isSelected && (
            <span className="ml-1.5 text-[10px] font-semibold text-plum uppercase">
              priced above
            </span>
          )}
        </span>
        {v.priceMinor != null && (
          <span className="text-xs font-semibold text-ink">
            {formatMinor(v.priceMinor, v.currency)}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {v.available === true && <Pill tone="ok">In stock</Pill>}
        {v.available === false && <Pill tone="warn">Out of stock</Pill>}
        {v.runningLow === true && <Pill tone="warn">Low stock</Pill>}
        {v.condition.map((c) => (
          <Pill key={c}>{c === "new" ? "New" : c}</Pill>
        ))}
        {v.rating.value != null && <StarRating rating={v.rating} size={11} />}
        {v.nativeCheckoutEligible === true && <Pill>Instant checkout</Pill>}
        {v.requiresShipping === false && <Pill>No shipping needed</Pill>}
        {v.sku && (
          <span className="text-[10px] text-ink-soft">
            SKU <code className="font-mono">{v.sku}</code>
          </span>
        )}
      </div>

      {v.description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">{v.description}</p>
      )}
    </li>
  );
}

/** Human labels for UCP policy link types (`refund_policy` → "Refund policy"). */
function policyLabel(type: string): string {
  const cleaned = type.replace(/[_-]+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * The full catalog record, collapsed by default.
 *
 * `<details>` gives us native keyboard/screen-reader disclosure semantics and
 * matches the existing "From the listing" pattern on the card.
 */
export function ProductFactsPanel({
  facts,
  productId,
  source,
  className = "",
  hideMedia = false,
}: {
  facts: ProductFacts;
  productId: string;
  /**
   * Where this record came from. REQUIRED (no default) so a new call site
   * cannot silently inherit live-catalog wording for demo fixtures — the
   * provenance footer below is an explicit claim and must match reality.
   */
  source: CatalogSource;
  className?: string;
  /** When the caller already shows the images (e.g. a carousel), skip Media here. */
  hideMedia?: boolean;
}) {
  const {
    specs,
    topFeatures,
    uniqueSellingPoints,
    description,
    variants,
    options,
    images,
    seller,
    categories,
    handle,
    rating,
  } = facts;

  // Count only the sections that will actually render, so the summary never
  // promises detail that isn't there.
  const sectionCount = [
    specs.length > 0,
    topFeatures.length > 0,
    uniqueSellingPoints.length > 0,
    description.trim().length > 0,
    variants.length > 0,
    options.length > 0,
    !hideMedia && images.length > 0,
    seller != null,
    categories.length > 0,
  ].filter(Boolean).length;

  if (sectionCount === 0) {
    return (
      <p className={`text-[11px] italic text-ink-soft ${className}`}>
        The catalog returned no additional detail for this product.
      </p>
    );
  }

  return (
    <details className={`group rounded-lg border border-line bg-white ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-soft uppercase hover:text-plum">
        <span className="flex items-center gap-1.5">
          <Info size={12} aria-hidden />
          Full catalog details
        </span>
        <span className="flex items-center gap-1.5 normal-case">
          <span className="font-normal text-ink-soft">{sectionCount} sections</span>
          <svg
            className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>

      <div className="space-y-3 border-t border-line px-3 py-3">
        {specs.length > 0 && (
          <Section icon={ListChecks} title="Specifications" count={specs.length}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {specs.map((s, i) => (
                <div key={i} className="flex flex-col">
                  <dt className="text-[10px] font-medium tracking-wide text-ink-soft uppercase">
                    {s.label}
                  </dt>
                  <dd className="text-xs leading-snug text-ink">{s.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {topFeatures.length > 0 && (
          <Section icon={Sparkles} title="Key features" count={topFeatures.length}>
            <ul className="space-y-1">
              {topFeatures.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-plum"
                  />
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {uniqueSellingPoints.length > 0 && (
          <Section icon={Star} title="What sets it apart" count={uniqueSellingPoints.length}>
            <ul className="space-y-1">
              {uniqueSellingPoints.map((u, i) => (
                <li
                  key={i}
                  className="rounded bg-gold-wash px-2 py-1 text-xs leading-relaxed text-ink"
                >
                  {u}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {description.trim().length > 0 && (
          <Section icon={FileText} title="Description">
            <p className="text-xs leading-relaxed whitespace-pre-line text-ink-soft">
              {description}
            </p>
          </Section>
        )}

        {variants.length > 0 && (
          <Section icon={Package} title="Variants & availability" count={variants.length}>
            <ul className="space-y-1.5">
              {variants.map((v) => (
                <VariantRow key={v.id} v={v} />
              ))}
            </ul>
          </Section>
        )}

        {options.length > 0 && (
          <Section icon={Boxes} title="Options">
            <div className="space-y-2">
              {options.map((o) => (
                <div key={o.name}>
                  <p className="text-[10px] font-medium tracking-wide text-ink-soft uppercase">
                    {o.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.values.map((val, i) => (
                      <span
                        key={`${val.label}-${i}`}
                        className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                          val.available === false
                            ? "text-ink-soft/60 line-through ring-line"
                            : "bg-sand text-ink ring-line"
                        }`}
                        title={
                          val.available === false
                            ? `${val.label} — unavailable`
                            : val.label
                        }
                      >
                        {val.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {!hideMedia && images.length > 0 && (
          <Section icon={Images} title="Media" count={images.length}>
            <div className="flex flex-wrap gap-1.5">
              {images.slice(0, 8).map((img, i) => (
                <a
                  key={i}
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/img relative block h-14 w-14 overflow-hidden rounded border border-line bg-sand"
                  title={img.altText ?? `Media ${i + 1}${img.type ? ` (${img.type})` : ""}`}
                >
                  {/* Catalog CDN images: plain <img> keeps this component host-agnostic. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.altText ?? `Product media ${i + 1}`}
                    className="h-full w-full object-cover transition-transform group-hover/img:scale-105"
                    loading="lazy"
                  />
                  {img.type && img.type !== "image" && (
                    <span className="absolute right-0 bottom-0 bg-ink/80 px-1 text-[9px] text-white">
                      {img.type}
                    </span>
                  )}
                </a>
              ))}
              {images.length > 8 && (
                <span className="self-center text-[11px] text-ink-soft">
                  +{images.length - 8} more
                </span>
              )}
            </div>
          </Section>
        )}

        {seller && (
          <Section icon={Store} title="Seller & policies">
            <div className="space-y-1.5">
              <p className="text-xs text-ink">
                {seller.url ? (
                  <a
                    href={seller.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-plum hover:underline"
                  >
                    {seller.name ?? seller.domain ?? "Merchant"}
                  </a>
                ) : (
                  <span className="font-medium">{seller.name ?? "Merchant"}</span>
                )}
                {seller.domain && (
                  <span className="ml-1.5 text-ink-soft">{seller.domain}</span>
                )}
              </p>
              {seller.policyLinks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {seller.policyLinks.map((p, i) => (
                    <a
                      key={`${p.type}-${i}`}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-line hover:text-plum"
                    >
                      <ShieldCheck size={10} aria-hidden />
                      {policyLabel(p.type)}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] italic text-ink-soft">
                  This merchant published no policy links to the catalog.
                </p>
              )}
            </div>
          </Section>
        )}

        {categories.length > 0 && (
          <Section icon={Tags} title="Categories">
            <div className="flex flex-wrap gap-1">
              {categories.map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  className="rounded-full bg-sand px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-line"
                >
                  {c}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Provenance footer — makes the data's origin checkable, not assumed.
            Demo fixtures must never borrow the live catalog's authority, and a
            fabricated review count is the most misleading thing here, so it is
            suppressed entirely for mock data. */}
        <p className="border-t border-line pt-2 text-[10px] leading-relaxed text-ink-soft">
          {source === "live" ? (
            <>
              Straight from the Shopify Global Catalog — no AI in this section.
              {rating.count != null &&
                ` Rating reflects ${rating.count.toLocaleString()} reviews.`}
            </>
          ) : (
            <>
              <span className="font-semibold text-warn">Demo catalog data</span> — a
              fixture, not a live listing. Prices, stock and ratings are illustrative.
            </>
          )}{" "}
          <code className="font-mono break-all">{handle ?? productId}</code>
        </p>
      </div>
    </details>
  );
}
