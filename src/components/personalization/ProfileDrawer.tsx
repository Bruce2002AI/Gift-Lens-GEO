"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { X } from "lucide-react";
import { ProfilePanel, type ProfileFactWire } from "@/components/personalization/ProfilePanel";
import type { ProfileLens } from "@/lib/personalization/types";

const TITLES: Record<string, string> = {
  gift: "Gift details",
  skincare: "Skin profile",
  style: "Style profile",
  nutrition: "Nutrition profile",
};

/**
 * Right slide-over that houses the living profile. The profile itself
 * (ProfilePanel) auto-saves each field as it changes; "Save and refresh picks"
 * simply closes the drawer and re-shops with everything captured so far.
 */
export function ProfileDrawer({
  open,
  onClose,
  lens,
  learned,
  subjectId,
  onSaveRefresh,
}: {
  open: boolean;
  onClose: () => void;
  lens: ProfileLens | null;
  learned: ProfileFactWire[];
  subjectId: string;
  onSaveRefresh: () => void;
}) {
  const { status } = useSession();
  const authed = status === "authenticated";
  const title = (lens && TITLES[lens]) || "Details";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Scrim */}
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[80] bg-ink/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed inset-y-0 right-0 z-[81] flex w-[500px] max-w-[92vw] flex-col bg-white shadow-[-20px_0_60px_-20px_rgba(28,34,48,.3)] transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-[18px]">
          <div>
            <h3 className="font-(family-name:--font-display) text-[21px] font-semibold">{title}</h3>
            <p className="mt-1 text-[13.5px] leading-[1.5] text-ink-soft">
              Fills in as you chat. Add anything directly if that is faster.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {authed ? (
            <ProfilePanel bare lens={lens} learned={learned} subjectId={subjectId} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-paper p-6 text-center text-sm leading-relaxed text-ink-soft">
              <p className="font-medium text-ink">Sign in to build a profile</p>
              <p className="mt-1.5">
                Save who you are shopping for and what they like, so the picks get sharper every
                visit.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-plum-dark"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>

        <div className="border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onSaveRefresh}
            className="w-full rounded-full bg-plum py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-plum-dark"
          >
            Save and refresh picks
          </button>
        </div>
      </aside>
    </>
  );
}
