"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { VerifiedBoardCategory, VerifiedBoardItem } from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { formatMinor } from "@/lib/gift/currency";

/**
 * "Swap a piece" — the composed look acts as a tab bar (one tab per piece);
 * picking a tab lists same-aisle alternatives with the price delta against the
 * current piece, and "Update look" applies the chosen swap. Purely client-side:
 * it re-points the look at another product already on the board.
 */
export function SwapModal({
  lookName,
  members,
  board,
  onClose,
  onApply,
}: {
  lookName: string;
  members: VerifiedBoardItem[];
  board: VerifiedBoardCategory[];
  onClose: () => void;
  onApply: (pieceIndex: number, next: VerifiedBoardItem) => void;
}) {
  const [selPiece, setSelPiece] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const piece = members[selPiece];
  const inLook = new Set(members.map((m) => m.productId));
  const category = board.find((c) => c.items.some((it) => it.productId === piece?.productId));
  const alts = (category?.items ?? []).filter(
    (it) => it.productId !== piece?.productId && !inLook.has(it.productId),
  );

  const currency = piece?.currency ?? null;
  const sameCurrency = members.every((m) => m.currency === currency);
  const baseTotal = members.reduce((t, m) => t + (m.priceMinor ?? 0), 0);
  const pendingAlt = pendingId ? alts.find((a) => a.productId === pendingId) ?? null : null;
  const liveTotal = members.reduce(
    (t, m, i) => t + ((i === selPiece && pendingAlt ? pendingAlt.priceMinor : m.priceMinor) ?? 0),
    0,
  );
  const totalDiff = liveTotal - baseTotal;

  /** A signed price delta chip ("−₹7,600" / "+₹2,100"), only when priceable. */
  const deltaChip = (altPrice: number | null) => {
    if (!sameCurrency || altPrice == null || piece?.priceMinor == null) return null;
    const d = altPrice - piece.priceMinor;
    if (d === 0) {
      return <span className="rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink-faint">even</span>;
    }
    const down = d < 0;
    return (
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          down ? "bg-ok/10 text-ok" : "bg-cream text-ink-soft"
        }`}
      >
        {down ? "−" : "+"}
        {formatMinor(Math.abs(d), currency)}
      </span>
    );
  };

  // Portaled to <body>: the look card has a hover transform, which would make
  // this modal's `position: fixed` relative to the card instead of the viewport.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Swap a piece"
        className="animate-pop flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-(--shadow-lift) sm:rounded-[28px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-7 pt-6">
          <div>
            <h3 className="font-(family-name:--font-display) text-[22px] font-semibold tracking-[-0.01em]">
              Swap a piece
            </h3>
            <p className="mt-1 text-[13.5px] text-ink-soft">{lookName} · pick the piece to change</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        {/* Piece tabs — the look itself */}
        <div className="flex gap-2.5 px-7 pt-[18px]">
          {members.map((m, i) => {
            const sel = i === selPiece;
            return (
              <button
                key={m.productId}
                type="button"
                onClick={() => {
                  setSelPiece(i);
                  setPendingId(null);
                }}
                className={`flex flex-1 items-center gap-3 rounded-2xl border-[1.5px] p-2.5 text-left transition-all ${
                  sel
                    ? "border-transparent bg-butter-soft shadow-[inset_0_0_0_1.5px_var(--color-butter)]"
                    : "border-line bg-cream hover:border-ink-faint"
                }`}
              >
                <ProductImage
                  src={m.imageUrl}
                  alt={m.title}
                  className="h-11 w-11 shrink-0 rounded-[9px]"
                />
                <span className="min-w-0">
                  <span className="line-clamp-1 text-[13px] font-semibold leading-tight">
                    {m.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {formatMinor(m.priceMinor, m.currency)}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.05em] text-plum">
                    {sel ? "Swapping this" : "Tap to swap"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Alternatives */}
        <div className="flex-1 overflow-y-auto px-7 pb-2.5 pt-[18px]">
          <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Swaps for {category?.name ?? "this piece"}
          </p>

          {/* Current piece (dashed) */}
          {piece && (
            <div className="mb-2.5 flex items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-line bg-cream px-3.5 py-3">
              <ProductImage
                src={piece.imageUrl}
                alt={piece.title}
                className="h-[58px] w-[58px] shrink-0 rounded-[10px]"
              />
              <div className="min-w-0 flex-1">
                {piece.merchant && (
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    {piece.merchant}
                  </p>
                )}
                <p className="mt-0.5 text-sm font-medium">{piece.title}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-soft">Currently in the look</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-semibold">{formatMinor(piece.priceMinor, piece.currency)}</p>
                <span className="mt-1 inline-block rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink-faint">
                  current
                </span>
              </div>
            </div>
          )}

          {alts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-3.5 py-6 text-center text-[13px] text-ink-soft">
              No other options in this aisle yet — ask the expert for more.
            </p>
          ) : (
            alts.map((a) => {
              const picked = pendingId === a.productId;
              return (
                <button
                  key={a.productId}
                  type="button"
                  onClick={() => setPendingId(picked ? null : a.productId)}
                  className={`mb-2.5 flex w-full items-center gap-3.5 rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-all ${
                    picked ? "border-plum bg-plum-wash" : "border-line hover:border-ink-faint"
                  }`}
                >
                  <ProductImage
                    src={a.imageUrl}
                    alt={a.title}
                    className="h-[58px] w-[58px] shrink-0 rounded-[10px]"
                  />
                  <div className="min-w-0 flex-1">
                    {a.merchant && (
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                        {a.merchant}
                      </p>
                    )}
                    <p className="mt-0.5 text-sm font-medium">{a.title}</p>
                    {a.insight && (
                      <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-soft">{a.insight}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-semibold">{formatMinor(a.priceMinor, a.currency)}</p>
                    <span className="mt-1 inline-block">{deltaChip(a.priceMinor)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-line px-7 py-4">
          <span className="text-sm text-ink-soft">
            Look total
            <strong className="ml-1.5 text-[17px] font-semibold text-ink">
              {formatMinor(liveTotal, currency)}
            </strong>
            {sameCurrency && totalDiff !== 0 && (
              <span
                className={`ml-2 text-[12.5px] font-semibold ${
                  totalDiff < 0 ? "text-ok" : "text-ink-soft"
                }`}
              >
                {totalDiff < 0 ? "−" : "+"}
                {formatMinor(Math.abs(totalDiff), currency)} vs current
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={!pendingAlt}
            onClick={() => {
              if (pendingAlt) onApply(selPiece, pendingAlt);
              onClose();
            }}
            className="rounded-full bg-plum px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-plum-dark disabled:cursor-default disabled:opacity-45"
          >
            Update look
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
