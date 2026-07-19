import { FlaskConical, Radio } from "lucide-react";

/**
 * Persistent source labeling. Mock/demo data is never presented as live —
 * this banner stays visible whenever any fixture data is on screen.
 */
export function SourceBanner({
  source,
  aiMode,
}: {
  source: "live" | "mock" | "mixed" | null;
  aiMode?: "ai" | "heuristic" | null;
}) {
  if (!source) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="status">
      {source === "live" ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-3 py-1 text-xs font-medium text-ok">
          <Radio size={12} aria-hidden />
          Live Shopify Global Catalog
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/10 px-3 py-1 text-xs font-medium text-warn">
          <FlaskConical size={12} aria-hidden />
          {source === "mixed"
            ? "Partially demo data — some live Catalog calls failed"
            : "Demo catalog data — connect Shopify Global Catalog for live products"}
        </span>
      )}
      {aiMode === "heuristic" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-3 py-1 text-xs font-medium text-ink-soft">
          Heuristic mode — set OLLAMA_API_KEY for LLM-powered understanding
        </span>
      )}
    </div>
  );
}
