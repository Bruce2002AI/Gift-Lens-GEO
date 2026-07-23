"use client";

import { useState } from "react";
import { Check, Layers, Repeat2, ShoppingCart } from "lucide-react";
import type {
  VerifiedBoardCategory,
  VerifiedBoardItem,
  VerifiedComposition,
} from "@/lib/agent/types";
import { ProductImage } from "@/components/catalog/ProductImage";
import { SwapModal } from "@/components/expert/SwapModal";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";
import { snapshotFromBoardItem } from "@/lib/wishlist/snapshot";
import { formatMinor } from "@/lib/gift/currency";

/**
 * The composed "looks" (outfits / routines / duos) shown in the RIGHT results
 * column, above the individual products — each buyable as a whole set. Members
 * are resolved out of the accumulated board; an id the board doesn't (yet)
 * carry is dropped rather than rendered blank. When nothing resolves the whole
 * section renders nothing.
 */
export function LooksBoard({
  compositions,
  boardIndex,
  board,
}: {
  compositions: VerifiedComposition[];
  /** productId → board item, accumulated across turns by the page. */
  boardIndex: Map<string, VerifiedBoardItem>;
  /** Full board (grouped by category) — the swap modal's source of alternatives. */
  board: VerifiedBoardCategory[];
}) {
  const resolved = compositions.filter((composition) =>
    composition.productIds.some((id) => boardIndex.has(id)),
  );

  if (resolved.length === 0) return null;

  return (
    <section aria-label="Ways to put it together" className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h3 className="inline-flex items-center gap-1.5 font-(family-name:--font-display) text-xl font-semibold">
          <Layers size={17} className="text-plum" aria-hidden />
          Ways to put it together
        </h3>
        <span className="text-xs text-ink-faint">
          {resolved.length} option{resolved.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="max-w-[620px] text-[13.5px] leading-relaxed text-ink-soft">
        Each one is buyable as a set — shortlist the whole thing, or swap a piece.
      </p>

      <div className="grid gap-3.5 sm:grid-cols-2">
        {resolved.map((composition) => (
          // Keyed by a STABLE composition identity, not the array index: a
          // board_prune can drop an earlier look and shift indices, and an
          // index key would then feed a surviving look the pruned one's swapped
          // member state. Identity keys keep each card's state with its look.
          <LookCard
            key={`${composition.name}::${composition.productIds.join(",")}`}
            composition={composition}
            boardIndex={boardIndex}
            board={board}
          />
        ))}
      </div>
    </section>
  );
}

function LookCard({
  composition,
  boardIndex,
  board,
}: {
  composition: VerifiedComposition;
  boardIndex: Map<string, VerifiedBoardItem>;
  board: VerifiedBoardCategory[];
}) {
  const { add, remove, isShortlisted } = useShortlist();
  const [swapOpen, setSwapOpen] = useState(false);
  // The look's live pieces — a swap re-points one id at another board product.
  const [memberIds, setMemberIds] = useState<string[]>(() =>
    composition.productIds.filter((id) => boardIndex.has(id)),
  );
  const members = memberIds
    .map((id) => boardIndex.get(id))
    .filter((m): m is VerifiedBoardItem => m != null);

  const currency = members[0]?.currency ?? null;
  const priced = members.every((m) => m.priceMinor != null && m.currency === currency);
  const totalMinor = priced ? members.reduce((sum, m) => sum + (m.priceMinor ?? 0), 0) : null;

  const snaps = members.map(snapshotFromBoardItem);
  const allShortlisted = snaps.every((s) => isShortlisted(s.productId, s.source));

  const toggleLook = () => {
    if (allShortlisted) {
      snaps.forEach((s) => remove(s.productId, s.source));
    } else {
      snaps.forEach((s) => {
        if (!isShortlisted(s.productId, s.source)) add(s);
      });
    }
  };

  return (
    <article className="rounded-2xl border border-line bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-(--shadow-hover)">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-(family-name:--font-display) text-[17px] font-semibold text-ink">
          {composition.name}
        </h4>
        {totalMinor != null && (
          <span className="shrink-0 text-[15px] font-semibold text-ink">
            {formatMinor(totalMinor, currency)}
          </span>
        )}
      </div>

      {composition.rationale && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{composition.rationale}</p>
      )}

      <ul className="mt-3.5 flex gap-2.5 overflow-x-auto pb-1">
        {members.map((member) => (
          <li key={member.productId} className="w-[68px] shrink-0">
            <ProductImage
              src={member.imageUrl}
              alt={member.title}
              className="aspect-square w-full rounded-[10px]"
            />
            <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-snug text-ink-soft">
              {member.title}
            </p>
            {member.priceMinor != null && (
              <p className="text-[10.5px] font-semibold text-ink">
                {formatMinor(member.priceMinor, member.currency)}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleLook}
          aria-pressed={allShortlisted}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-plum px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-plum-dark"
        >
          {allShortlisted ? (
            <>
              <Check size={14} aria-hidden />
              Look shortlisted
            </>
          ) : (
            <>
              <ShoppingCart size={14} aria-hidden />
              Shortlist look
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSwapOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
        >
          <Repeat2 size={14} aria-hidden />
          Swap a piece
        </button>
      </div>

      {swapOpen && (
        <SwapModal
          lookName={composition.name}
          members={members}
          board={board}
          onClose={() => setSwapOpen(false)}
          onApply={(pieceIndex, next) =>
            setMemberIds((prev) =>
              prev.map((id, i) => (i === pieceIndex ? next.productId : id)),
            )
          }
        />
      )}
    </article>
  );
}
