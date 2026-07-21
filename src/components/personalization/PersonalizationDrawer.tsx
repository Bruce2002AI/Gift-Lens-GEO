"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { PersonalizationCenter } from "@/components/personalization/PersonalizationCenter";

/**
 * The Personalization Center in a right slide-over — opened from the nav so the
 * shopper can review/edit what the agent remembers without leaving the page.
 */
export function PersonalizationDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[80] bg-ink/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Personalization Center"
        className={`fixed inset-y-0 right-0 z-[81] flex w-[600px] max-w-[94vw] flex-col bg-cream shadow-[-20px_0_60px_-20px_rgba(28,34,48,.3)] transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-white px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Your profile
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {open && <PersonalizationCenter embedded />}
        </div>
      </aside>
    </>
  );
}
