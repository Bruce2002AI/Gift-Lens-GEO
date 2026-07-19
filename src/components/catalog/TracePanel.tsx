"use client";

import { useState } from "react";
import { ChevronDown, TerminalSquare } from "lucide-react";
import type { TraceEvent } from "@/lib/catalog/types";

/**
 * Collapsible, sanitized Catalog API trace — the judge-facing proof that
 * the Catalog API is genuinely being exercised. Never contains secrets,
 * tokens, images, or conversation text.
 */
export function TracePanel({ trace }: { trace: TraceEvent[] }) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;
  return (
    <section className="card overflow-hidden" aria-label="Catalog API trace">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink hover:bg-sand/50"
      >
        <span className="inline-flex items-center gap-2">
          <TerminalSquare size={16} className="text-plum" aria-hidden />
          Catalog API trace
          <span className="rounded-full bg-sand px-2 py-0.5 text-xs text-ink-soft">
            {trace.length} events
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="divide-y divide-line border-t border-line bg-cream-deep/40 font-mono text-xs">
          {trace.map((event) => (
            <li key={event.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={`font-semibold ${event.ok ? "text-plum" : "text-danger"}`}
                >
                  {event.tool}
                </span>
                <span className="text-ink">{event.label}</span>
                <span className="ml-auto flex items-center gap-2 text-ink-soft">
                  {event.cacheHit && (
                    <span className="rounded bg-gold-wash px-1.5 py-0.5 text-gold">
                      cache hit
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      event.source === "live"
                        ? "bg-ok/10 text-ok"
                        : "bg-warn/10 text-warn"
                    }`}
                  >
                    {event.source}
                  </span>
                  {event.resultCount !== undefined && (
                    <span>{event.resultCount} results</span>
                  )}
                  <span>{(event.durationMs / 1000).toFixed(1)}s</span>
                </span>
              </div>
              {event.detail && (
                <p className="mt-1 break-words text-ink-soft">{event.detail}</p>
              )}
              {event.error && (
                <p className="mt-1 break-words text-danger">{event.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
