"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useHistory } from "@/components/history/HistoryProvider";
import type { HistoryEntry } from "@/lib/history/types";

/** Compact "12h" / "3d" / "just now" relative label. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then) || diff < 0) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  return wk < 5 ? `${wk}w` : `${Math.floor(day / 30)}mo`;
}

/**
 * Navbar search-history control: a "new search" (+) button and a clock button
 * that drops down a searchable list of past searches. Clicking an entry reopens
 * it on the shop page; hovering reveals rename/delete.
 */
export function HistoryMenu() {
  const { entries, refresh, rename, remove, clear, requestRestore, requestNewSearch } =
    useHistory();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [clearing, setClearing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Wipe EVERYTHING that could steer the assistant: the saved searches AND the
   * remembered profile (facts/subjects/records + any live server session), then
   * drop into a blank conversation. History-restore reuses a past session id, so
   * clearing the memory alone isn't enough — both must go.
   */
  const clearAll = async () => {
    const ok = window.confirm(
      "Clear all saved searches and everything the assistant remembers about you (profiles, preferences, past chats)? This can't be undone.",
    );
    if (!ok) return;
    setClearing(true);
    try {
      clear(); // saved searches: DB + localStorage
      // Remembered profile + live sessions (signed-in only; a 401 for guests is
      // harmless — they have no stored memory beyond the cleared history).
      await fetch("/api/personalization/reset", { method: "POST" }).catch(() => {});
    } finally {
      setClearing(false);
      setOpen(false);
      requestNewSearch(); // blank conversation under a fresh id
    }
  };

  const toggleOpen = () => {
    if (!open) refresh(); // re-sync from the backing store when opening
    setOpen((v) => !v);
  };

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = entries.filter((e) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return e.title.toLowerCase().includes(q) || e.subtitle.toLowerCase().includes(q);
  });

  const openEntry = (id: string) => {
    setOpen(false);
    requestRestore(id);
  };

  const startRename = (entry: HistoryEntry) => {
    setEditingId(entry.id);
    setDraftTitle(entry.title);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) rename(editingId, draftTitle.trim());
    setEditingId(null);
    setDraftTitle("");
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Search history"
        aria-expanded={open}
        title="Search history"
        className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-sand hover:text-plum ${
          open ? "bg-plum-wash text-plum" : "text-ink-soft"
        }`}
      >
        <Clock size={18} aria-hidden />
      </button>
      <button
        type="button"
        onClick={requestNewSearch}
        aria-label="New search"
        title="New search"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-plum"
      >
        <Plus size={18} aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-(--shadow-lift)">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 transition-colors focus-within:border-plum">
            <Search size={14} className="shrink-0 text-ink-soft" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
              autoFocus
              className="w-full bg-transparent text-sm text-ink placeholder:text-ink-soft/50 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 rounded-full p-0.5 text-ink-soft hover:text-ink"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>

          <ul className="max-h-96 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-ink-soft">
                {entries.length === 0 ? "No past searches yet." : "No matches."}
              </li>
            ) : (
              filtered.map((entry) => (
                <li key={entry.id} className="group relative">
                  {editingId === entry.id ? (
                    <div className="px-3 py-2">
                      <input
                        type="text"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setDraftTitle("");
                          }
                        }}
                        onBlur={commitRename}
                        autoFocus
                        className="w-full rounded-lg border border-plum bg-white px-2 py-1 text-sm focus:outline-none"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openEntry(entry.id)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-sand"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{entry.title}</p>
                        <p className="truncate text-xs text-ink-soft">{entry.subtitle}</p>
                      </div>
                      <span className="mt-0.5 shrink-0 text-[11px] text-ink-soft/70 group-hover:opacity-0">
                        {relativeTime(entry.updatedAt)}
                      </span>
                    </button>
                  )}

                  {editingId !== entry.id && (
                    <div className="absolute right-2 top-1.5 hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        onClick={() => startRename(entry)}
                        aria-label={`Rename ${entry.title}`}
                        className="rounded-md p-1 text-ink-soft hover:bg-white hover:text-plum"
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={`Delete ${entry.title}`}
                        className="rounded-md p-1 text-ink-soft hover:bg-white hover:text-danger"
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={clearing}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-default disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden />
              {clearing ? "Clearing…" : "Clear all history & memory"}
            </button>
            <p className="mt-1 px-1 text-center text-[11px] leading-snug text-ink-soft/70">
              Erases saved searches and everything the assistant remembers about you.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
