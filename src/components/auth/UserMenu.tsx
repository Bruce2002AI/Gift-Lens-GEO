"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, UserCog } from "lucide-react";

interface UserMenuProps {
  name?: string | null;
  email?: string | null;
}

/** Derive a single uppercase initial from the name, falling back to the email. */
function initialOf(name?: string | null, email?: string | null): string {
  const source = (name?.trim() || email?.trim() || "").replace(/[^\p{L}\p{N}]/gu, "");
  const first = [...source][0];
  return first ? first.toUpperCase() : "?";
}

export function UserMenu({ name, email }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = initialOf(name, email);
  const label = name || email || "Account";

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-plum text-sm font-semibold text-white transition-colors hover:bg-plum-dark focus-visible:outline-2"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="card absolute right-0 z-50 mt-2 w-60 overflow-hidden p-0"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-plum text-sm font-semibold text-white">
              {initial}
            </span>
            <div className="min-w-0">
              {name && (
                <p className="truncate text-sm font-medium text-ink" title={name}>
                  {name}
                </p>
              )}
              {email && (
                <p className="truncate text-xs text-ink-soft" title={email}>
                  {email}
                </p>
              )}
            </div>
          </div>
          <Link
            href="/personalization"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-sand"
          >
            <UserCog size={15} aria-hidden />
            Edit profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: "/" });
            }}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-sand"
          >
            <LogOut size={15} aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
