"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Radar,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import type {
  DimensionScore,
  GeoAuditResponse,
  VisibilityTest,
} from "@/lib/geo/types";
import { SourceBanner } from "@/components/catalog/SourceBanner";
import { TracePanel } from "@/components/catalog/TracePanel";
import { ProductImage } from "@/components/catalog/ProductImage";

const AUDIT_STAGES = [
  "Resolving product",
  "Retrieving variants",
  "Testing buyer prompts",
  "Comparing visible competitors",
  "Generating recommendations",
];

const DEMO_URL = "mock:ritual-pourover";

export default function GeoPage() {
  const [form, setForm] = useState({
    productUrl: "",
    country: "IN",
    currency: "INR",
    audience: "",
    occasion: "",
    budgetMax: "",
  });
  const [customPrompts, setCustomPrompts] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeoAuditResponse | null>(null);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(
      () => setStage((s) => Math.min(s + 1, AUDIT_STAGES.length - 1)),
      2200,
    );
    return () => clearInterval(t);
  }, [loading]);

  const runAudit = async (promptsOverride?: string[] | null) => {
    if (!form.productUrl.trim() || loading) return;
    setStage(0);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/geo/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl: form.productUrl.trim(),
          country: form.country.trim().toUpperCase() || "IN",
          currency: form.currency.trim().toUpperCase() || "INR",
          audience: form.audience || null,
          occasion: form.occasion || null,
          budgetMax: form.budgetMax ? Number(form.budgetMax) : null,
          customPrompts: promptsOverride ?? customPrompts,
        }),
      });
      const json = (await res.json()) as GeoAuditResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Audit failed. Please retry.");
      } else {
        setResult(json);
        if (json.error) setError(json.error);
      }
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-(family-name:--font-display) text-3xl font-semibold">
          GEO Lens
        </h1>
        <p className="mt-1 max-w-2xl text-ink-soft">
          See how AI shopping agents understand your product — and which
          catalog signals may be holding it back.
        </p>
      </header>

      {/* Input card */}
      <section className="card mb-6 p-5" aria-label="Audit input">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setCustomPrompts(null);
            runAudit(null);
          }}
        >
          <div className="sm:col-span-2">
            <label htmlFor="g-url" className="field-label">
              Shopify product URL or identifier
            </label>
            <input
              id="g-url"
              className="field-input"
              placeholder="https://your-store.myshopify.com/products/…"
              value={form.productUrl}
              onChange={(e) => setForm({ ...form, productUrl: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="g-country" className="field-label">Target country</label>
            <input
              id="g-country"
              maxLength={2}
              className="field-input uppercase"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="g-currency" className="field-label">Currency</label>
            <input
              id="g-currency"
              maxLength={3}
              className="field-input uppercase"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="g-audience" className="field-label">Audience (optional)</label>
            <input
              id="g-audience"
              className="field-input"
              placeholder="design-loving coffee drinkers"
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="g-occasion" className="field-label">Occasion (optional)</label>
            <input
              id="g-occasion"
              className="field-input"
              placeholder="housewarming"
              value={form.occasion}
              onChange={(e) => setForm({ ...form, occasion: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="g-budget" className="field-label">Target budget (optional)</label>
            <input
              id="g-budget"
              type="number"
              min="0"
              className="field-input"
              placeholder="4000"
              value={form.budgetMax}
              onChange={(e) => setForm({ ...form, budgetMax: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading || !form.productUrl.trim()} className="btn-primary w-full">
              {loading ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Radar size={16} aria-hidden />
              )}
              Run audit
            </button>
          </div>
        </form>
        <button
          type="button"
          className="mt-3 text-xs font-medium text-plum hover:text-plum-dark"
          onClick={() => setForm({ ...form, productUrl: DEMO_URL })}
        >
          No URL handy? Use the demo product (“The Ritual” — a deliberately weak
          listing)
        </button>
      </section>

      {loading && (
        <div className="card mb-6 p-5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 size={15} className="animate-spin text-plum" aria-hidden />
            {AUDIT_STAGES[stage]}…
          </p>
          <ol className="mt-3 grid grid-cols-5 gap-1" aria-hidden>
            {AUDIT_STAGES.map((s, i) => (
              <li key={s} className={`h-1.5 rounded-full ${i <= stage ? "bg-plum" : "bg-line"}`} />
            ))}
          </ol>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-6 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {result && !result.resolved && result.notFoundMessage && (
        <div className="card mb-6 border-warn/40 p-5" role="status">
          <p className="flex items-start gap-2 text-sm leading-relaxed">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            {result.notFoundMessage}
          </p>
        </div>
      )}

      {result?.resolved && result.product && (
        <div className="space-y-6">
          <SourceBanner source={result.source} aiMode={result.aiMode} />

          {/* Score header */}
          <section className="card grid gap-6 p-6 md:grid-cols-[auto_1fr]" aria-label="Agent readiness score">
            <div className="flex items-center gap-5">
              <ScoreRing score={result.totalScore} />
              <div>
                <h2 className="font-(family-name:--font-display) text-xl font-semibold">
                  Commerce Agent Readiness Score
                </h2>
                <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-soft">
                  A transparent heuristic from observable catalog evidence.
                  Visibility reflects these observed test searches and may
                  change. ShopLens does not have access to Shopify&apos;s
                  private ranking logic.
                </p>
                <p className="mt-2 text-sm">
                  Audit confidence:{" "}
                  <span
                    className={`font-semibold ${
                      result.confidence === "high"
                        ? "text-ok"
                        : result.confidence === "medium"
                          ? "text-warn"
                          : "text-danger"
                    }`}
                  >
                    {result.confidence}
                  </span>
                  <span className="text-ink-soft">
                    {" "}
                    — {result.confidenceReasons[0]}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <ProductImage
                src={result.product.images[0]?.url}
                alt={result.product.images[0]?.altText ?? result.product.title}
                className="h-20 w-20 shrink-0 rounded-xl"
              />
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium">{result.product.title}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Resolved via lookup_catalog · Last refreshed{" "}
                  {new Date(result.lastRefreshed).toLocaleString()}
                </p>
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-plum"
                  onClick={() => runAudit(null)}
                >
                  <RefreshCcw size={12} aria-hidden /> Re-run audit
                </button>
              </div>
            </div>
          </section>

          {/* Dimensions — at-a-glance chart, then expandable detail */}
          <DimensionChart dimensions={result.dimensions} />
          <section aria-label="Score dimension detail" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.dimensions.map((dim) => (
              <DimensionCard key={dim.key} dim={dim} />
            ))}
          </section>

          {/* Visibility table */}
          {result.visibility && (
            <VisibilitySection
              tests={result.visibility.tests}
              coverage={result.visibility.coverage}
              topThree={result.visibility.topThreeCount}
              avgPosition={result.visibility.averagePosition}
              failed={result.visibility.failedCount}
              onEditPrompts={(prompts) => {
                setCustomPrompts(prompts);
                runAudit(prompts);
              }}
            />
          )}

          {/* Competitors */}
          {result.competitors.length > 0 && (
            <section className="card p-5" aria-label="Visible competitors">
              <h2 className="font-(family-name:--font-display) text-lg font-semibold">
                Products agents saw instead
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                Top results across the test prompts (excluding the audited product).
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.competitors.map((c) => (
                  <li key={c.id} className="flex gap-3 rounded-xl border border-line p-3">
                    <ProductImage src={c.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg" />
                    <div className="min-w-0 text-sm">
                      <p className="line-clamp-2 font-medium leading-snug">{c.title}</p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {c.seller ?? "Unknown seller"}
                        {c.priceLabel ? ` · ${c.priceLabel}` : ""}
                      </p>
                      <p className="text-xs text-ink-soft">
                        Seen in {c.appearances} test{c.appearances === 1 ? "" : "s"}
                        {c.bestPosition ? `, best position ${c.bestPosition}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <section className="card p-5" aria-label="Prioritized recommendations">
              <h2 className="font-(family-name:--font-display) text-lg font-semibold">
                Prioritized improvements
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                Evidence-linked suggestions. None of these guarantee ranking or
                visibility — they make the listing easier for agents to understand.
              </p>
              <ul className="mt-4 space-y-3">
                {result.recommendations.map((rec, i) => (
                  <li key={`${rec.issue}-${i}`} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          rec.priority === "high"
                            ? "bg-danger/10 text-danger"
                            : rec.priority === "medium"
                              ? "bg-warn/10 text-warn"
                              : "bg-sand text-ink-soft"
                        }`}
                      >
                        {rec.priority}
                      </span>
                      <span className="text-xs text-ink-soft">{rec.category}</span>
                    </div>
                    <p className="mt-2 font-medium">{rec.issue}</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      <span className="font-medium text-ink">Observed:</span> {rec.evidence}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      <span className="font-medium text-ink">Why it matters:</span> {rec.why}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium">Suggested change:</span> {rec.suggestion}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Before / After */}
          {result.beforeAfter && (
            <section className="card p-5" aria-label="Suggested copy preview">
              <h2 className="font-(family-name:--font-display) text-lg font-semibold">
                Suggested copy preview
              </h2>
              <p className="mt-1 text-xs font-medium text-warn">
                Suggested copy preview — not yet applied to Shopify. ShopLens
                never modifies your listing.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-line bg-cream-deep/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Before (observed)</p>
                  <p className="mt-2 font-medium">{result.beforeAfter.beforeTitle}</p>
                  <p className="mt-2 text-sm text-ink-soft">{result.beforeAfter.beforeDescription}</p>
                </div>
                <div className="rounded-xl border border-plum/30 bg-plum-wash/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-plum">After (suggested)</p>
                  <p className="mt-2 font-medium">{result.beforeAfter.afterTitle}</p>
                  <p className="mt-2 text-sm text-ink-soft">{result.beforeAfter.afterDescription}</p>
                </div>
              </div>
            </section>
          )}

          {/* Methodology */}
          <section className="card p-5 text-sm leading-relaxed text-ink-soft" aria-label="Methodology and limitations">
            <h2 className="font-(family-name:--font-display) text-lg font-semibold text-ink">
              Methodology & limitations
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Score = naming/taxonomy (25) + attributes/variants (20) + offer
                confidence (20) + media (15) + trust signals (10) + prompt
                visibility (10). Visibility = observed coverage × 10.
              </li>
              <li>
                Every check is computed from data returned by lookup_catalog,
                get_product, and search_catalog for this audit — nothing else.
              </li>
              <li>
                “Not observed” means not in the first 20 returned results for
                that test at that moment; failed searches are excluded, not
                counted against visibility.
              </li>
              <li>
                Shipping eligibility does not imply delivery timing, and no
                recommendation guarantees ranking.
              </li>
            </ul>
          </section>

          <TracePanel trace={result.trace} />
        </div>
      )}
    </div>
  );
}

/** Map a 0–100 percentage to a point on the sequential score ramp. */
function scoreRampColor(pct: number): string {
  if (pct >= 75) return "var(--color-score-strong)";
  if (pct >= 55) return "var(--color-score-good)";
  if (pct >= 40) return "var(--color-score-fair)";
  return "var(--color-score-poor)";
}

/**
 * A consolidated, point-weighted read of all six dimensions in one frame —
 * the "briefing" view. Each bar is scaled to its own max, coloured by the
 * sequential ramp, and marked at the 50% line so partial credit is legible
 * at a glance (rather than six separate boxes).
 */
function DimensionChart({ dimensions }: { dimensions: DimensionScore[] }) {
  return (
    <section className="card p-5" aria-label="Score breakdown at a glance">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-(family-name:--font-display) text-lg font-semibold">
          Score breakdown
        </h2>
        <p className="text-xs text-ink-soft">Each bar is scaled to its own point budget</p>
      </div>
      <ul className="mt-4 space-y-3.5">
        {dimensions.map((dim) => {
          const pct = dim.max > 0 ? Math.round((dim.score / dim.max) * 100) : 0;
          return (
            <li key={dim.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-ink">{dim.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                  {dim.score} / {dim.max}
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-score-track">
                {/* 50% reference line */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px bg-line"
                  style={{ mixBlendMode: "multiply" }}
                />
                <div
                  className="h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none"
                  style={{ width: `${pct}%`, backgroundColor: scoreRampColor(pct) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const tone = score >= 70 ? "text-ok" : score >= 45 ? "text-warn" : "text-danger";
  return (
    <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`Agent readiness score ${score} out of 100`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${tone} stroke-current transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-(family-name:--font-display) text-3xl font-semibold">{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-soft">/ 100</span>
      </div>
    </div>
  );
}

function DimensionCard({ dim }: { dim: DimensionScore }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round((dim.score / dim.max) * 100);
  return (
    <div className="card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <h3 className="text-sm font-semibold">{dim.label}</h3>
          <p className="text-xs text-ink-soft">
            {dim.score} / {dim.max} points
          </p>
        </div>
        <ChevronDown size={15} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-score-track" aria-hidden>
        <span className="absolute inset-y-0 left-1/2 w-px bg-line" style={{ mixBlendMode: "multiply" }} />
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: scoreRampColor(pct) }}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{dim.summary}</p>
      {open && (
        <ul className="mt-3 space-y-2 border-t border-line pt-3">
          {dim.findings.map((f) => (
            <li key={f.check} className="flex gap-2 text-xs leading-relaxed">
              {f.passed ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" aria-hidden />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
              )}
              <span>
                <span className="font-medium text-ink">{f.check}</span>{" "}
                <span className="text-ink-soft">({f.points}/{f.maxPoints})</span>
                <br />
                <span className="text-ink-soft">{f.evidence}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VisibilitySection({
  tests,
  coverage,
  topThree,
  avgPosition,
  failed,
  onEditPrompts,
}: {
  tests: VisibilityTest[];
  coverage: number;
  topThree: number;
  avgPosition: number | null;
  failed: number;
  onEditPrompts: (prompts: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section className="card p-5" aria-label="Prompt visibility">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-(family-name:--font-display) text-lg font-semibold">
          Prompt visibility
        </h2>
        <button
          type="button"
          className="text-xs font-medium text-plum"
          onClick={() => {
            setDraft(tests.map((t) => t.prompt).join("\n"));
            setEditing((e) => !e);
          }}
        >
          {editing ? "Cancel editing" : "Edit prompts & re-run"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Coverage {Math.round(coverage * 100)}% · {topThree} top-3 appearances
        {avgPosition != null ? ` · average observed position ${avgPosition}` : ""}
        {failed > 0 ? ` · ${failed} test(s) failed (excluded from coverage)` : ""}
      </p>

      {editing && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const prompts = draft
              .split("\n")
              .map((p) => p.trim())
              .filter((p) => p.length >= 4)
              .slice(0, 12);
            if (prompts.length > 0) onEditPrompts(prompts);
            setEditing(false);
          }}
        >
          <label htmlFor="prompt-editor" className="field-label">
            One prompt per line (max 12)
          </label>
          <textarea
            id="prompt-editor"
            rows={6}
            className="field-input font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary mt-2 !py-2 text-sm">
            Re-run with these prompts
          </button>
        </form>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
              <th scope="col" className="py-2 pr-4 font-medium">Shopper prompt</th>
              <th scope="col" className="py-2 pr-4 font-medium">Result</th>
              <th scope="col" className="py-2 pr-4 font-medium">Top visible competitor</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.prompt} className="border-b border-line/60 align-top">
                <td className="py-2.5 pr-4">{t.prompt}</td>
                <td className="py-2.5 pr-4">
                  {t.status === "appeared" && (
                    <span className="font-medium text-ok">
                      Appeared at position {t.position} in this test
                    </span>
                  )}
                  {t.status === "not_observed" && (
                    <span className="text-ink-soft">
                      Not observed in the first {t.resultsInspected || 20} returned results
                      {t.hardFilterRisk && (
                        <span className="mt-0.5 block text-xs text-warn">
                          Possible hard-filter exclusion: {t.hardFilterRisk}
                        </span>
                      )}
                    </span>
                  )}
                  {t.status === "failed" && (
                    <span className="text-danger">Test failed — not counted</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-ink-soft">
                  {t.topCompetitor ? (
                    <>
                      <span className="line-clamp-1">{t.topCompetitor.title}</span>
                      {t.topCompetitor.seller && (
                        <span className="text-xs">({t.topCompetitor.seller})</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        Results may vary with context and catalog changes — these are observed
        test searches, not absolute global ranks.
      </p>
    </section>
  );
}
