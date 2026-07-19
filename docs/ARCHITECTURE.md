# ShopLens Architecture

## One agent, ten lenses

ShopLens is a **single agent over a registry of mode "skills"** — a mode is data (schema + prompts + constraints + safety + presentation), not a fork of the app. `src/lib/modes/`:

```
engine.ts        runAgent(): route → getMode → extract intent → project to BaseIntent
                 → clarification gate → picks OR (blueprint-approval gate → plan)
                 → apply safety (disclaimer + red-flag gate + blocked-claim sanitizer)
router.ts        routeMessage(): LLM classifier + heuristic keyword fallback → mode id
registry.ts      getMode(id): lazy dynamic import() of skills/<id>.ts (loaded on demand)
intent.ts        extractModeIntent(): mode.extractPrompt → rawSchema → finalizeIntent; heuristic fallback
picks-pipeline   ranked products (Gift, Swap) — generalized from the gift concierge
plan-pipeline    multi-component bundle (the other 8): allocate budget → search per component
                 → constrain → rank → primary + ≤2 alternatives → get_product-verify primary → total
budget.ts        allocateBudget() integer minor-unit split (remainder to largest weight)
skills/*.ts      one ShoppingMode per lens; gift + skincare hand-tuned, the rest via factories
types.ts / meta.ts   the descriptor + client-safe display/routing metadata
```

The shared engine (`constraints`, `ranking`, `reranker`, `explanations`) was generalized from `GiftIntent` to a **`BaseIntent`** every mode projects onto via `toBaseIntent`; gift behavior is unchanged. Two result shapes: **picks** (`Pick[]`, spotlight trio + "more") and **plan** (`PlanResult`: components → primary + alternatives, running total). Unified endpoint: `POST /api/agent`; UI at `/shop`. The gift lens keeps its dedicated `/gift` concierge (merged intent+plan call, pasted-link + image search).

**Safety (skincare, nutrition):** an educational disclaimer, a `gate()` that defers red-flag inputs to a professional, a `blockedClaimPatterns` sanitizer that strips diagnose/cure/guarantee sentences from generated copy, and opt-in-only supplements. Product facts come only from the catalog.

## Overview (gift picks pipeline)

```
Browser (React, no secrets)
  │  JSON over /api/*
  ▼
Next.js route handlers (Node runtime)
  │
  ├── AI layer (src/lib/ai)          provider-agnostic, server-only
  │     Ollama Cloud (default) or Anthropic, chosen by which key is set
  │     concierge: intent+plan merged in ONE call → explanations
  │     every output Zod-validated, one repair pass, labeled
  │     deterministic heuristic fallback when no API key
  │
  ├── Gift engine (src/lib/gift)     deterministic
  │     hard constraints · ranking · diversity · currency
  │
  ├── GEO engine (src/lib/geo)       deterministic scoring + AI copy
  │     prompts · visibility suite · readiness score · recommendations
  │
  └── Catalog adapter (src/lib/catalog)   THE only Shopify boundary
        client.ts    searchCatalog / lookupCatalog / getProduct
        json-rpc.ts  JSON-RPC 2.0 envelope, retries, timeouts
        auth.ts      client_credentials token, JWT-exp cache
        normalize.ts raw UCP → NormalizedProduct
        mock-client.ts labeled fixtures (same interface)
        cache.ts     in-memory TTL cache (ephemeral by design)
```

**Rule: no raw Catalog fetches outside `src/lib/catalog`, no model calls outside `src/lib/ai`, no secrets outside the server.** UI components import only types and pure helpers (`currency.ts`, shared `types.ts` files).

## Shopper pipeline (`src/lib/gift/orchestration.ts`)

1. `extractIntentAndPlan` — ONE merged model call produces the Zod-validated `GiftIntent` **and** the three search strategies. Minor units are computed deterministically (`majorToMinor`), never by the model. (Refine/image paths reuse the same plan or call `planSearches`.)
2. Clarification gate — at most 2 rounds, only when materially useful.
3. Three strategies: **literal**, **adjacent**, **wildcard**.
4. Three `search_catalog` calls in parallel (`p-limit`, partial failures tolerated).
5. Merge + dedupe (product id → variant id → normalized title+merchant).
6. **Hard constraint engine** re-checks returned data: budget (same-currency only — no invented FX), availability, physicality, explicit exclusions.
7. Graceful expansion — one broadened search with softened wording; hard constraints are never silently relaxed.
8. Scoring: fast heuristic semantic sub-scores + deterministic logistics/quality/completeness → weighted total (35/20/20/10/10/5), ranked high-to-low. The model's judgment is reserved for the final explanations rather than a separate rerank round-trip.
9. Two-tier result set:
   - **Spotlight (top 3)** — diversity-aware roles (Best Match / Delight / Safe) with understudies; each leader re-validated with `get_product` (failures promote the next candidate) and explained by the model.
   - **"more" tier** — the next ranked matches (up to ~18 returned), taken straight from the constraint-checked search results with grounded heuristic reasons; no extra catalog or model calls. Re-validated with `get_product` when the shopper opens a card (same contract as a saved product). The UI reveals ~12 first and expands on request.
10. Fewer than 3 picks clear every hard constraint → honest limitation, never padding.
11. Evidence-grounded explanations for the spotlight (the second and final model call; every claim cites a source field). The "more" tier uses deterministic, evidence-grounded reasons.
12. Sanitized `TraceCollector` events returned for the judge-facing trace panel.

**Latency by design:** the concierge still makes ~2 model calls total (merged intent+plan, then spotlight explanations) regardless of how many matches are returned — the wider set adds no LLM or catalog round-trips — so first responses stay snappy and conversational.

## GEO pipeline (`src/lib/geo/orchestration.ts`)

URL validation (http/https or gid — the URL is passed to `lookup_catalog` as an identifier; GiftLens never fetches brand URLs itself, preventing SSRF) → `lookup_catalog` → `get_product` → 10 intent prompts (Claude-generated, template fallback, brand-editable) → `search_catalog` ×10 at concurrency 3 → readiness score → evidence-linked recommendations → before/after copy (never applied to Shopify).

Failed visibility searches are **excluded** from coverage — "test failed" is never "not visible".

## Modes & fallback

| CATALOG_MODE | Behavior |
|---|---|
| `live` | Live only. Failures surface as typed errors. Never mock. |
| `mock` | Fixtures only + permanent banner. |
| `auto` | Live first. Falls back to mock **only** when `ALLOW_MOCK_FALLBACK=true`, labeled `source: "mock"` end-to-end (banner + per-card badges + trace). |

AI availability is orthogonal: no `ANTHROPIC_API_KEY` → deterministic heuristic implementations of intent/planning/scoring/explanations, labeled "Heuristic AI mode" in the UI.

## Reliability

- AbortController timeouts (search 15s, lookup/get 12s, token 10s).
- Retries only for 429/5xx/network/timeout, exponential backoff with full jitter, max 2.
- Concurrency: 4 for shopper searches, 3 for GEO visibility.
- TTL caches: search 5 min, product/lookup 90 s; keys include query, filters, context, similarity seed, and catalog mode. **Serverless note:** the cache and rate-limit windows are per-instance, in-memory, and vanish on cold start — acceptable for this MVP, never used for secrets.
- Per-IP fixed-window rate limits on expensive endpoints (concierge 10/min, GEO audit 6/min).

## Security

- Secrets only in server modules guarded by `server-only`.
- Zod validation on every request body; 8 MB body cap; 5 MB image cap (JPEG/PNG/WebP only); images are used for one request, never persisted, never logged.
- Returned HTML → plain text (`htmlToPlainText`); no `dangerouslySetInnerHTML` anywhere.
- External links open with `rel="noopener noreferrer"`.
- Structured logger redacts secret-shaped keys and truncates long strings.

## Storage

No database. Browser `localStorage` holds saved product **ids** only — reopening always re-resolves via `lookup_catalog` so prices are never stale. Recent state lives in React memory.
