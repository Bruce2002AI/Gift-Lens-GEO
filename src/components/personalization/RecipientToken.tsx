"use client";

import { useEffect, useRef, useState } from "react";
import { User } from "lucide-react";
import type { SubjectSummary } from "@/lib/agent/types";

/** A pending recipient chosen on the home screen — an existing subject or a new person. */
export interface HeroRecipient {
  id: string | null;
  name: string;
  relationship?: string | null;
}

/**
 * The "For someone?" token that sits inside the home search bar for the gift
 * lens. Picking a person seeds the search's subject; nothing is sent until the
 * shopper actually searches.
 */
export function RecipientToken({
  subjects,
  value,
  onSelect,
  onNew,
}: {
  subjects: SubjectSummary[];
  value: HeroRecipient | null;
  onSelect: (recipient: HeroRecipient | null) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const people = subjects.filter((s) => s.kind === "person");

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

  const set = value != null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2.5 text-[13.5px] font-medium transition-all ${
          set
            ? "border border-transparent bg-butter-soft font-semibold text-ink"
            : "border border-dashed border-line text-ink-soft hover:border-ink-faint hover:text-ink"
        }`}
      >
        {!set && <User size={15} aria-hidden />}
        <span>{set ? value!.name : "For someone?"}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[46px] z-30 w-[230px] rounded-[18px] border border-line bg-white p-1.5 text-left shadow-[0_16px_40px_-12px_rgba(28,34,48,.22)]">
          {set && (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[14px] text-ink-soft hover:bg-paper"
            >
              Just me
            </button>
          )}
          {people.map((p) => (
            <button
              key={p.subjectId}
              type="button"
              onClick={() => {
                onSelect({ id: p.subjectId, name: p.name, relationship: p.relationship });
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[14px] text-ink hover:bg-paper"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-plum-wash text-[11px] font-semibold text-plum-dark">
                {p.name.charAt(0).toUpperCase()}
              </span>
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
            className="mt-1 block w-full border-t border-line px-2.5 pb-[7px] pt-[11px] text-left text-[14px] font-medium text-plum hover:text-plum-dark"
          >
            + Someone new
          </button>
        </div>
      )}
    </div>
  );
}
