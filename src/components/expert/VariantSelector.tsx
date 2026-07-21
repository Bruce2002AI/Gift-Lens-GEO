"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { ProductFacts, ProductFactsVariant } from "@/lib/agent/types";
import { formatMinor } from "@/lib/gift/currency";

/** The variant to pre-select: designated selection, else first in stock, else first. */
export function pickDefaultVariant(facts: ProductFacts): string | null {
  const v = facts.variants;
  return (
    v.find((x) => x.isSelected)?.id ??
    v.find((x) => x.available !== false)?.id ??
    v[0]?.id ??
    null
  );
}

/**
 * Variant picker.
 *
 * - `mode="dropdown"` (used on the grid card): a modern popover listbox — never
 *   a native <select> — showing every variant.
 * - `mode="swatch"` (used in the quick-view modal): one row of label swatches
 *   per catalog option (Color, Size…). Products with only a flat variant list
 *   render the variants themselves as label swatches.
 */
export function VariantSelector({
  facts,
  selectedId,
  onSelect,
  mode,
  compact = false,
}: {
  facts: ProductFacts;
  selectedId: string | null;
  onSelect: (variantId: string) => void;
  mode: "dropdown" | "swatch";
  compact?: boolean;
}) {
  const variants = facts.variants;
  if (variants.length <= 1) return null;

  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];

  if (mode === "dropdown") {
    return (
      <VariantDropdown
        variants={variants}
        selected={selected}
        onSelect={onSelect}
        compact={compact}
      />
    );
  }

  return <SwatchSelector facts={facts} variants={variants} selected={selected} onSelect={onSelect} />;
}

/** Swatch rows — one per option group, or the flat variant list when there are none. */
function SwatchSelector({
  facts,
  variants,
  selected,
  onSelect,
}: {
  facts: ProductFacts;
  variants: ProductFactsVariant[];
  selected: ProductFactsVariant;
  onSelect: (variantId: string) => void;
}) {
  const optionGroups = facts.options.filter((o) => o.values.length > 0);

  const chooseOption = (optionName: string, label: string) => {
    const target = new Map(selected.options.map((o) => [o.name, o.label]));
    target.set(optionName, label);
    const exact = variants.find(
      (v) => v.options.length > 0 && v.options.every((o) => target.get(o.name) === o.label),
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
                {group.values.map((val) => (
                  <Swatch
                    key={val.label}
                    label={val.label}
                    active={val.label === current}
                    unavailable={val.available === false}
                    onClick={() => chooseOption(group.name, val.label)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // No structured options — show the variants themselves as swatches. When every
  // variant shares a title, fall back to price (then index) so labels stay distinct.
  const titles = variants.map((v) => v.title);
  const allSameTitle = titles.every((t) => t === titles[0]);
  const labelFor = (v: ProductFactsVariant, i: number) =>
    !allSameTitle && v.title
      ? v.title
      : v.priceMinor != null
        ? formatMinor(v.priceMinor, v.currency)
        : `Option ${i + 1}`;

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-soft">Options</p>
      <div className="flex flex-wrap gap-2">
        {variants.map((v, i) => (
          <Swatch
            key={v.id}
            label={labelFor(v, i)}
            active={v.id === selected.id}
            unavailable={v.available === false}
            onClick={() => onSelect(v.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** A single label swatch — filled when selected, struck-through when unavailable. */
function Swatch({
  label,
  active,
  unavailable,
  onClick,
}: {
  label: string;
  active: boolean;
  unavailable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      aria-pressed={active}
      title={unavailable ? `${label} — unavailable` : label}
      className={`rounded-lg border px-3 py-1.5 text-sm transition-all active:scale-95 ${
        active
          ? "border-ink bg-ink text-white"
          : "border-line bg-white text-ink hover:border-plum/50"
      } ${unavailable ? "cursor-not-allowed text-ink-soft/50 line-through hover:border-line" : ""}`}
    >
      {label}
    </button>
  );
}

/** Where the portaled listbox sits, in viewport (fixed) coordinates. */
interface PopoverPos {
  left: number;
  width: number;
  /** Set when opening downward. */
  top?: number;
  /** Set when flipped upward (anchored to the viewport bottom). */
  bottom?: number;
  maxHeight: number;
}

/** Modern popover dropdown — a styled listbox, not a native <select>. */
function VariantDropdown({
  variants,
  selected,
  onSelect,
  compact,
}: {
  variants: ProductFactsVariant[];
  selected: ProductFactsVariant;
  onSelect: (variantId: string) => void;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  // Position the popover in fixed/viewport coordinates so it escapes the card's
  // overflow-hidden. Flip above the trigger when there isn't room below.
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;
    const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      ...(flipUp
        ? { bottom: window.innerHeight - r.top + gap, maxHeight: Math.min(256, spaceAbove) }
        : { top: r.bottom + gap, maxHeight: Math.min(256, spaceBelow) }),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // `capture` so we reposition when any ancestor (the results column) scrolls.
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <div ref={anchorRef} className="relative">
      {!compact && <p className="mb-1.5 text-xs font-medium text-ink-soft">Variant</p>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-white text-ink transition-colors hover:border-plum focus:border-plum focus:outline-none ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm"
        }`}
      >
        <span className="min-w-0 truncate">
          {selected.title}
          {selected.priceMinor != null && (
            <span className="ml-1.5 text-ink-soft">
              {formatMinor(selected.priceMinor, selected.currency)}
            </span>
          )}
        </span>
        <ChevronDown
          size={compact ? 13 : 16}
          aria-hidden
          className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            className="animate-rise z-50 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-(--shadow-lift)"
          >
            {variants.map((v) => {
              const active = v.id === selected.id;
              const unavailable = v.available === false;
              return (
                <li key={v.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    disabled={unavailable}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(v.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
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
                      {active && <Check size={13} aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
