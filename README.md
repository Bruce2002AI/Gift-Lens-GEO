# ShopLens

**One AI shopping agent, many lenses.**

In traditional search, a weak product listing lands on page two. In agentic commerce, it may never enter the conversation. ShopLens helps shoppers get exactly what they need — however they describe it — and helps brands become recommendable.

ShopLens is **one flexible agent** that routes a plain-language message to the right **lens** and turns it into live, buyable results from **Shopify's Global Catalog**. Ten lenses, one shared engine (intent → plan → constrained search → verify → explain → refine):

| Lens | What it does | Result |
|---|---|---|
| **GiftLens** | Describe a person → thoughtful gifts | ranked picks |
| **SwapLens** | Paste a product → a better-fitting alternative | ranked picks |
| **RoutineLens** | A simple, educational skincare routine | plan |
| **StyleLens** | A coordinated outfit for an occasion | plan |
| **FuelLens** | A goal-based grocery basket | plan |
| **SpaceLens** | A room-mood shopping bundle | plan |
| **TripLens** | A compact trip packing kit | plan |
| **StartLens** | A beginner hobby starter kit | plan |
| **NewChapter** | A phased life-transition plan | plan |
| **ReadyLens** | A complete "get ready for X" plan | plan |

It then gives brands a **GEO Lens**: an audit (the **Commerce Agent Readiness Score**) of which catalog signals make a product discoverable to AI shopping agents, and which missing signals may hold it back.

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:3000** and go to **`/shop`**. `.env.local` ships preconfigured with Shopify Catalog credentials for authenticated live mode (with a clearly-labeled demo-catalog fallback) and an **Ollama Cloud** key for the AI. Without any AI key, ShopLens runs in a clearly-labeled deterministic heuristic mode — routing, constraints, ranking, and GEO scoring still work end to end.

**AI provider:** Ollama Cloud, model `gpt-oss:120b` by default (best quality on the free tier). Set `OLLAMA_MODEL` to `gpt-oss:20b` or `gemma4:31b` to trade some quality for speed.

## The experiences

| | Shopper: ShopLens agent (`/shop`) | Brand: GEO Lens (`/geo`) |
|---|---|---|
| Starts with | Known intent, unknown product | Known product, unknown discoverability |
| Flow | route → intent → (blueprint approval for plans) → `search_catalog` per component → `get_product` verify → explain → merchant handoff | `lookup_catalog` → `get_product` → `search_catalog` ×10 visibility tests → GEO report |
| Output | **Picks** modes: a ranked set (~12, led by Best/Delight/Safe). **Plan** modes: a multi-component bundle with a primary + alternatives per part and a running total | Commerce Agent Readiness Score (0–100), prompt-visibility table, competitor view, prioritized fixes, before/after copy |

Try it on `/shop`:

- *"Anniversary gift for my partner who loves coffee and pottery, dislikes clutter, ₹5,000"* → GiftLens picks.
- *"A simple skincare routine for dry sensitive skin, no fragrance, under ₹3,000"* → RoutineLens proposes a routine to approve, then finds real products per step.
- *"Smart-casual first-date outfit under ₹12,000"* → StyleLens outfit plan.
- *"I like this lamp — find something similar and cheaper that ships to IN"* → SwapLens alternatives.

Skincare and nutrition are **educational** lenses: they carry a persistent disclaimer, defer to professionals on red-flag inputs, never diagnose or claim to cure, and treat supplements as opt-in. Product facts always come only from the catalog.

The gift lens is also available on its own at **`/gift`** (with pasted-link evaluation and inspiration-image search); the GEO Lens is at **`/geo`**.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest unit + integration suite (runs fully offline in mock mode) |
| `npm run lint` / `npm run typecheck` | ESLint / strict TypeScript |
| `npm run catalog:smoke` | Verify negotiated tools (`tools/list`) + run a live `search_catalog` |
| `npm run profile:verify` | Validate the UCP agent profile (local file or deployed URL) |

## Configuration (`.env.local`)

| Variable | Purpose |
|---|---|
| `SHOPIFY_CATALOG_CLIENT_ID` / `_SECRET` | Dev Dashboard credentials → authenticated Catalog mode (higher rate limits). Empty → anonymous mode. |
| `UCP_AGENT_PROFILE_URL` | Public URL of your UCP agent profile. Empty in dev → uses Shopify's hosted example profile (documented for connectivity testing). For production, deploy `public/ucp-profile.json` and set `https://YOUR_DOMAIN/ucp-profile.json`. |
| `CATALOG_MODE` | `live` (never mock), `mock` (fixtures + permanent banner), `auto` (live first; labeled mock fallback only when `ALLOW_MOCK_FALLBACK=true`) |
| `OLLAMA_API_KEY` / `OLLAMA_MODEL` / `OLLAMA_BASE_URL` | Ollama Cloud provider (server-only). Default model `gpt-oss:120b`, base URL `https://ollama.com`. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional alternative provider, used only when `OLLAMA_API_KEY` is empty (server-only). |

All secrets are server-only. The browser never talks to Shopify or the AI provider directly.

## Honesty guarantees

- Product facts come **only** from Catalog API responses — the model cannot invent price, availability, materials, ratings, or policies.
- Hard constraints (budget, destination, availability, exclusions) are enforced deterministically; cross-currency prices are flagged, never silently converted.
- Shipping eligibility is never presented as a delivery date.
- Mock data always carries a persistent banner; live failures are never silently mocked.
- The GEO score is a transparent heuristic over observable evidence — GiftLens has no access to Shopify's private ranking logic and guarantees no visibility outcome.
- A collapsible **Catalog API trace** on both pages shows every `search_catalog` / `lookup_catalog` / `get_product` call (sanitized — no secrets, no tokens, no images).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and data flow
- [docs/CATALOG_API.md](docs/CATALOG_API.md) — verified UCP schemas, auth, and how each tool is used
- [docs/GEO_METHODOLOGY.md](docs/GEO_METHODOLOGY.md) — Agent Readiness Score methodology and limitations
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — 3-minute demo walkthrough
- [docs/HACKATHON_PITCH.md](docs/HACKATHON_PITCH.md) — the pitch
