import { uniqueId } from "@/lib/utils";
import type { TraceEvent } from "./types";

/**
 * Per-request trace collector. Produces the sanitized "Catalog API trace"
 * shown to hackathon judges. Never receives secrets, tokens, image payloads,
 * or full conversation text.
 */
export class TraceCollector {
  private events: TraceEvent[] = [];

  add(event: Omit<TraceEvent, "id" | "startedAt"> & { startedAt?: string }): void {
    this.events.push({
      id: uniqueId("trace"),
      startedAt: event.startedAt ?? new Date().toISOString(),
      ...event,
    });
  }

  async time<T>(
    meta: {
      tool: TraceEvent["tool"];
      label: string;
      detail?: string;
      source: TraceEvent["source"];
    },
    fn: () => Promise<T>,
    resultCount?: (result: T) => number | undefined,
    cacheHit?: boolean,
  ): Promise<T> {
    const start = Date.now();
    const startedAt = new Date().toISOString();
    try {
      const result = await fn();
      this.add({
        ...meta,
        durationMs: Date.now() - start,
        resultCount: resultCount ? resultCount(result) : undefined,
        cacheHit,
        ok: true,
        startedAt,
      });
      return result;
    } catch (err) {
      this.add({
        ...meta,
        durationMs: Date.now() - start,
        ok: false,
        cacheHit,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
        startedAt,
      });
      throw err;
    }
  }

  list(): TraceEvent[] {
    return [...this.events];
  }

  /**
   * The honest source label for everything produced this request, derived from
   * the actual catalog calls made: any fixture data in the mix downgrades the
   * label so the UI banner can never present mock competitors/results as live.
   */
  overallSource(fallback: "live" | "mock" = "live"): "live" | "mock" | "mixed" {
    const catalogTools = new Set(["search_catalog", "lookup_catalog", "get_product"]);
    const sources = new Set(
      this.events
        .filter((e) => catalogTools.has(e.tool))
        .map((e) => e.source),
    );
    if (sources.size === 0) return fallback;
    if (sources.size > 1) return "mixed";
    return [...sources][0];
  }
}
