"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ProductFacts, ProductFactsVariant } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";

/**
 * Variant picker for the quick-view modal.
 *
 * When the catalog exposes structured options (Color, Size…) it renders one
 * row of selectable label swatches per option. When it only exposes a flat
 * list of variants, it falls back to a modern popover dropdown (never a native
 * <select>). Either way, choosing resolves to a concrete variant via onSelect.
 */
export function VariantSelector({
  facts,
  selectedId,
  onSelect,
}: {
  facts: ProductFacts;
  selectedId: string | null;
  onSelect: (variantId: string) => void;
}) {
  const variants = facts.variants;
  if (variants.length <= 1) return null;

  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];
  const optionGroups = facts.options.filter((o) => o.values.length > 0);

  // Change one option → resolve the variant that best matches the new combo.
  const chooseOption = (optionName: string, label: string) => {
    const target = new Map(selected.options.map((o) => [o.name, o.label]));
    target.set(optionName, label);
    const exact = variants.find(
      (v) =>
        v.options.length > 0 && v.options.every((o) => target.get(o.name) === o.label),
    );
    const partial = variants.find((v) =>
      v.options.some((o) => o.name === optionName && o.label === label),
    );
    const next = exact ?? partial;
    if (next) onSelect(next.id);
  };

  if (optionGroups.length > 0) {
    return (
      <div className="space-y-3">
        {optionGroups.map((group) => {
          const current = selected.options.find((o) => o.name === group.name)?.label;
          return (
            <div key={group.name}>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">
                {group.name}
                {current && <span className="ml-1 font-semibold text-ink">{current}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.values.map((val) => {
                  const active = val.label === current;
                  const unavailable = val.available === false;
                  return (
                    <button
                      key={val.label}
                      type="button"
                      onClick={() => chooseOption(group.name, val.label)}
                      disabled={unavailable}
                      aria-pressed={active}
                      title={unavailable ? `${val.label} — unavailable` : val.label}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95 ${
                        active
                          ? "border-plum bg-plum text-white"
                          : "border-line bg-white text-ink hover:border-plum/50"
                      } ${
                        unavailable
                          ? "cursor-not-allowed text-ink-soft/50 line-through hover:border-line"
                          : ""
                      }`}
                    >
                      {val.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <VariantDropdown variants={variants} selected={selected} onSelect={onSelect} />;
}

/** Modern popover dropdown — a styled listbox, not a native <select>. */
function VariantDropdown({
  variants,
  selected,
  onSelect,
}: {
  variants: ProductFactsVariant[];
  selected: ProductFactsVariant;
  onSelect: (variantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <p className="mb-1.5 text-xs font-medium text-ink-soft">Variant</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink transition-colors hover:border-plum focus:border-plum focus:outline-none"
      >
        <span className="truncate">
          {selected.title}
          {selected.priceMinor != null && (
            <span className="ml-2 text-ink-soft">
              {formatMinor(selected.priceMinor, selected.currency)}
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="animate-rise absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-(--shadow-lift)"
        >
          {variants.map((v) => {
            const active = v.id === selected.id;
            const unavailable = v.available === false;
            return (
              <li key={v.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => {
                    onSelect(v.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    active ? "bg-plum-wash text-plum" : "text-ink hover:bg-sand"
                  } ${unavailable ? "cursor-not-allowed text-ink-soft/50" : ""}`}
                >
                  <span className="min-w-0 truncate">
                    {v.title}
                    {unavailable && <span className="ml-1.5 text-[11px]">· out of stock</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {v.priceMinor != null && (
                      <span className={active ? "text-plum" : "text-ink-soft"}>
                        {formatMinor(v.priceMinor, v.currency)}
                      </span>
                    )}
                    {active && <Check size={14} aria-hidden />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
