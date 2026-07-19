"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import type {
  CatalogSource,
  NormalizedProduct,
  NormalizedVariant,
  TraceEvent,
} from "@/lib/catalog/types";
import { formatMinor, formatMinorRange } from "@/lib/gift/currency";
import { ProductImage } from "@/components/catalog/ProductImage";

interface DetailResponse {
  ok: boolean;
  product: NormalizedProduct | null;
  selectedVariant: NormalizedVariant | null;
  relaxedOptions: string[];
  source: CatalogSource;
  trace: TraceEvent[];
  error?: string;
}

/**
 * Product detail dialog: full get_product experience with option selectors,
 * relaxation display, and merchant handoff for available variants only.
 */
export function ProductDetail({
  productId,
  country,
  onClose,
  onTrace,
}: {
  productId: string;
  country: string;
  onClose: () => void;
  onTrace: (events: TraceEvent[]) => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [imageIndex, setImageIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Monotonic request id: rapid option clicks fire overlapping get_product
  // calls, so only the most recent one is allowed to update the UI.
  const requestSeq = useRef(0);

  const load = useCallback(
    async (selections: Record<string, string>) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/gift/product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            selected: Object.keys(selections).length > 0 ? selections : null,
            preferenceOrder: Object.keys(selections),
            context: { country },
          }),
        });
        const json = (await res.json()) as DetailResponse;
        if (seq !== requestSeq.current) return; // a newer selection superseded this
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Could not load product details.");
        } else {
          setData(json);
          onTrace(json.trace ?? []);
        }
      } catch {
        if (seq === requestSeq.current) {
          setError("Could not reach the server. Please retry.");
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [productId, country, onTrace],
  );

  useEffect(() => {
    // Deferred a tick so the effect body stays free of synchronous setState.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load({});
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectOption = (name: string, label: string) => {
    const next = { ...selected, [name]: label };
    setSelected(next);
    load(next);
  };

  const p = data?.product;
  const variant = data?.selectedVariant ?? null;
  const available = variant?.available === true;
  const buyUrl = variant?.checkoutUrl ?? variant?.url ?? variant?.seller?.url ?? p?.url ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={p?.title ?? "Product details"}
        tabIndex={-1}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-(--shadow-lift) sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <h2 className="line-clamp-1 pr-4 font-(family-name:--font-display) text-lg font-semibold">
            {p?.title ?? "Product details"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="rounded-full p-2 text-ink-soft hover:bg-sand"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {loading && !p && (
          <div className="flex items-center justify-center gap-2 p-16 text-ink-soft" role="status">
            <Loader2 className="animate-spin" size={18} aria-hidden />
            Retrieving current product data…
          </div>
        )}
        {error && (
          <div className="p-8 text-center" role="alert">
            <p className="text-danger">{error}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => load(selected)}>
              Retry
            </button>
          </div>
        )}

        {p && (
          <div className="grid gap-6 p-5 sm:grid-cols-2">
            <div>
              <ProductImage
                src={p.images[imageIndex]?.url ?? p.images[0]?.url}
                alt={p.images[imageIndex]?.altText ?? p.title}
                className="h-72 w-full rounded-xl"
              />
              {p.images.length > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto" role="listbox" aria-label="Product images">
                  {p.images.slice(0, 6).map((img, i) => (
                    <button
                      key={`${img.url}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === imageIndex}
                      aria-label={`Image ${i + 1}`}
                      onClick={() => setImageIndex(i)}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                        i === imageIndex ? "border-plum" : "border-transparent"
                      }`}
                    >
                      <ProductImage src={img.url} alt="" className="h-full w-full" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <p className="text-2xl font-semibold">
                  {variant?.priceMinor != null
                    ? formatMinor(variant.priceMinor, variant.currency)
                    : formatMinorRange(
                        p.priceRange.minMinor,
                        p.priceRange.maxMinor,
                        p.priceRange.currency,
                      )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  {variant?.seller?.name && <span>Sold by {variant.seller.name}</span>}
                  {p.rating.value != null && (
                    <span>
                      · {p.rating.value}/{p.rating.scaleMax ?? 5}
                      {p.rating.count != null && ` (${p.rating.count} reviews)`}
                    </span>
                  )}
                </div>
                <p
                  className={`mt-1 text-sm font-medium ${available ? "text-ok" : "text-danger"}`}
                  aria-live="polite"
                >
                  {available
                    ? variant?.runningLow
                      ? "Available — running low per catalog data"
                      : "Available"
                    : "This combination is currently unavailable"}
                </p>
              </div>

              {data?.relaxedOptions && data.relaxedOptions.length > 0 && (
                <p className="rounded-lg bg-gold-wash px-3 py-2 text-xs text-ink" role="status">
                  Your exact selection wasn&apos;t available. ShopLens relaxed{" "}
                  <strong>{data.relaxedOptions.join(", ")}</strong> to find the
                  closest available option.
                </p>
              )}

              {p.options.map((option) => (
                <fieldset key={option.name}>
                  <legend className="field-label">{option.name}</legend>
                  <div className="flex flex-wrap gap-2">
                    {option.values.map((value) => {
                      const isSelected = selected[option.name] === value.label;
                      const exists = value.exists !== false;
                      const optAvailable = value.available !== false;
                      return (
                        <button
                          key={value.label}
                          type="button"
                          disabled={!exists}
                          aria-pressed={isSelected}
                          title={
                            !exists
                              ? "This combination does not exist"
                              : !optAvailable
                                ? "Exists but currently unavailable"
                                : undefined
                          }
                          onClick={() => selectOption(option.name, value.label)}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            isSelected
                              ? "border-plum bg-plum-wash font-medium text-plum"
                              : exists
                                ? optAvailable
                                  ? "border-line hover:border-plum"
                                  : "border-dashed border-line text-ink-soft line-through"
                                : "cursor-not-allowed border-line opacity-40"
                          }`}
                        >
                          {value.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              {loading && p && (
                <p className="flex items-center gap-2 text-xs text-ink-soft" role="status">
                  <Loader2 className="animate-spin" size={12} aria-hidden />
                  Rechecking selected variant…
                </p>
              )}

              {p.description && (
                <p className="max-h-40 overflow-y-auto text-sm leading-relaxed text-ink-soft">
                  {p.description}
                </p>
              )}

              {variant?.seller?.policyLinks && variant.seller.policyLinks.length > 0 && (
                <div className="flex flex-wrap gap-3 text-xs">
                  {variant.seller.policyLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-plum underline-offset-2 hover:underline"
                    >
                      {link.type} policy
                    </a>
                  ))}
                </div>
              )}

              <div className="mt-auto flex flex-col gap-2">
                {buyUrl && available ? (
                  <a
                    href={buyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary"
                  >
                    <ExternalLink size={16} aria-hidden />
                    {variant?.checkoutUrl ? "Continue to checkout" : "Buy on merchant"}
                  </a>
                ) : (
                  <p className="rounded-lg bg-sand px-3 py-2 text-center text-sm text-ink-soft">
                    Select an available combination to continue to the merchant.
                  </p>
                )}
                <p className="text-center text-[11px] text-ink-soft">
                  Purchase completes on the merchant&apos;s site — ShopLens hands off,
                  it never charges you.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
