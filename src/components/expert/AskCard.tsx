"use client";

import { useState } from "react";
import type { Fork } from "@/lib/agent/types";

/**
 * A narrowing question in the chat rail — a card with a butter left edge, a
 * collapsible "Why this matters" rationale, and quick-reply chips. Shared by
 * standalone `ask` turns and the follow-up a presentation asks alongside picks.
 */
export function AskCard({
  text,
  fork,
  quickReplies,
  onReply,
}: {
  text: string;
  fork: Fork | null;
  quickReplies: string[];
  onReply: (reply: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-[95%] rounded-xl border border-l-[3px] border-line border-l-butter bg-white px-4 py-3.5">
      <p className="text-sm font-semibold leading-[1.5] text-ink">{text}</p>
      {fork && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1 block text-[12.5px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            Why this matters
          </button>
          {open && (
            <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-soft">
              {fork.ifA} → {fork.thenA} · {fork.ifB} → {fork.thenB}
            </p>
          )}
        </>
      )}
      {quickReplies.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-[7px]">
          {quickReplies.map((reply, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onReply(reply)}
              className="rounded-full border border-line bg-cream px-[13px] py-[7px] text-[13px] font-medium text-ink transition-colors hover:border-transparent hover:bg-butter-soft"
            >
              {reply}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
