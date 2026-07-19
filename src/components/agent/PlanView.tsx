"use client";

import { Bookmark, BookmarkCheck, ExternalLink, Eye, Star } from "lucide-react";
import type { PlanResult, Pick } from "@/lib/modes/types";
import { formatMinorRange } from "@/lib/gift/currency";
import { ProductImage } from "@/components/catalog/ProductImage";

/** Renders a multi-component plan/bundle: grouped components, each with a primary + alternatives, and a running total. */
export function PlanView({
  plan,
  savedIds,
  onView,
  onToggleSave,
}: {
  plan: PlanResult;
  savedIds: string[];
  onView: (productId: string) => void;
  onToggleSave: (productId: string) => void;
}) {
  // Preserve component order, clustering consecutive same-group runs. Indices
  // (not labels/keys) drive React keys so a recurring group label or a
  // duplicate component key can't collide.
  const groups: Array<{ label: string | null; items: Array<{ c: (typeof plan.components)[number]; idx: number }> }> = [];
  plan.components.forEach((c, idx) => {
    const last = groups[groups.length - 1];
    if (last && last.label === c.group) last.items.push({ c, idx });
    else groups.push({ label: c.group, items: [{ c, idx }] });
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Your plan · {plan.components.length} components
        </h2>
        <span className="rounded-full bg-plum-wash px-3 py-1 text-sm font-semibold text-plum">
          {plan.totalMinor != null
            ? `Total ≈ ${formatMinorRange(plan.totalMinor, plan.totalMinor, plan.currency)}`
            : "Total unavailable (mixed currencies)"}
        </span>
      </div>

      {plan.limitation && (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink" role="status">
          {plan.limitation}
        </p>
      )}

      {groups.map((group, gi) => (
        <section key={`group-${gi}`} className="space-y-3">
          {group.label && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {group.label}
            </h3>
          )}
          <div className="space-y-3">
            {group.items.map(({ c, idx }) => {
              return (
                <div key={`comp-${idx}`} className="card p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 className="font-(family-name:--font-display) font-semibold">
                      {c.label}
                      {c.essential && (
                        <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft ring-1 ring-line">
                          essential
                        </span>
                      )}
                    </h4>
                  </div>
                  <p className="mb-3 text-sm text-ink-soft">{c.why}</p>

                  {c.primary ? (
                    <PlanProductRow
                      pick={c.primary}
                      primary
                      saved={savedIds.includes(c.primary.productId)}
                      onView={onView}
                      onToggleSave={onToggleSave}
                    />
                  ) : (
                    <p className="rounded-lg bg-sand/60 px-3 py-2 text-sm text-ink-soft">
                      {c.note ?? "No in-budget match found for this component."}
                    </p>
                  )}

                  {c.alternatives.length > 0 && (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                        Alternatives
                      </p>
                      <div className="space-y-2">
                        {c.alternatives.map((alt) => (
                          <PlanProductRow
                            key={alt.productId}
                            pick={alt}
                            saved={savedIds.includes(alt.productId)}
                            onView={onView}
                            onToggleSave={onToggleSave}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlanProductRow({
  pick,
  primary,
  saved,
  onView,
  onToggleSave,
}: {
  pick: Pick;
  primary?: boolean;
  saved: boolean;
  onView: (productId: string) => void;
  onToggleSave: (productId: string) => void;
}) {
  const p = pick.product;
  const variant =
    p.variants.find((v) => v.id === pick.variantId) ??
    p.variants.find((v) => v.available) ??
    p.variants[0];
  const buyUrl = variant?.checkoutUrl ?? variant?.url ?? variant?.seller?.url ?? p.url;
  const available = p.variants.some((v) => v.available === true);
  const price = formatMinorRange(p.priceRange.minMinor, p.priceRange.maxMinor, p.priceRange.currency);

  return (
    <div className={`flex gap-3 ${primary ? "" : "opacity-90"}`}>
      <ProductImage
        src={p.images[0]?.url}
        alt={p.images[0]?.altText ?? p.title}
        className="h-16 w-16 shrink-0 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</p>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
              pick.source === "live" ? "bg-ok/90 text-white" : "bg-warn/90 text-white"
            }`}
          >
            {pick.source === "live" ? "Live" : "Mock"}
          </span>
        </div>
        <p className="text-sm text-ink-soft">
          {price}
          {variant?.seller?.name ? ` · ${variant.seller.name}` : ""}
          {p.rating.value != null && (
            <span className="ml-1 inline-flex items-center gap-0.5">
              <Star size={11} className="fill-gold text-gold" aria-hidden />
              {p.rating.value}
            </span>
          )}
        </p>
        {primary && pick.reasons[0] && (
          <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">{pick.reasons[0]}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" className="inline-flex items-center gap-1 font-medium text-plum" onClick={() => onView(p.id)}>
            <Eye size={12} aria-hidden /> Details
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-ink-soft hover:text-plum"
            aria-pressed={saved}
            onClick={() => onToggleSave(p.id)}
          >
            {saved ? <BookmarkCheck size={12} className="text-plum" aria-hidden /> : <Bookmark size={12} aria-hidden />}
            {saved ? "Saved" : "Save"}
          </button>
          {buyUrl && available && (
            <a href={buyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-plum">
              <ExternalLink size={12} aria-hidden /> Buy
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
