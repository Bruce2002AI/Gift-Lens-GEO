# GiftLens — hackathon pitch

**Tagline:** Find the right gift. See why AI chose it.

## The insight

Agentic commerce has two sides that never talk to each other:

- The **shopper** starts with known intent and an unknown product.
- The **brand** starts with a known product and unknown discoverability.

GiftLens is one app that serves both with the same three Shopify Global Catalog tools, pointed in opposite directions:

```
Shopper:  search_catalog → get_product → merchant checkout handoff
Brand:    lookup_catalog → get_product → search_catalog ×10 → GEO report
```

## Why gifting

Gifting is the hardest retrieval problem in commerce: the buyer isn't the user, the query is a person description, and the cost of a bad answer is emotional. It shows off cross-merchant catalog discovery, natural-language + image search, and constraint satisfaction better than any “find me X” demo — with zero medical/compliance baggage.

## What we built

**AI Gift Concierge** — messy human context (“my sister in Bengaluru, loves coffee and Scandinavian design, hates clutter, ₹4,000”) becomes a Zod-validated GiftIntent, three deliberately different search strategies (literal/adjacent/wildcard), parallel live catalog searches, a deterministic hard-constraint engine, explainable weighted ranking, get_product re-validation, and exactly three diverse picks — Best Match, Delight, Safe — each with evidence-cited reasons and one honest trade-off. Plus: paste-a-URL evaluation, image-similarity search, refinement chips, and saved products that re-resolve fresh on open.

**GEO Lens** — a brand pastes its product URL and gets the **GiftLens Agent Readiness Score**: six transparent dimensions over observable catalog evidence, a ten-prompt visibility suite with observed positions and visible competitors, audit confidence, prioritized evidence-linked fixes, and a before/after copy preview. The demo product “The Ritual” (a beautiful listing only a human could love) scores badly for exactly the right reasons.

## Why judges should trust it

- A collapsible **Catalog API trace** on every result — each search_catalog / lookup_catalog / get_product call with timing, counts, and live/mock source.
- **Honesty as architecture:** the model cannot invent product facts; hard constraints are code, not vibes; cross-currency prices are flagged, never converted by guesswork; shipping eligibility is never a delivery promise; mock data is always labeled; unresolved lookups are diagnostics, not accusations; and no GEO recommendation claims a ranking guarantee.
- **Resilience:** authenticated live Catalog mode with token caching from the JWT exp claim, anonymous fallback, retries with jitter, concurrency caps, and a clearly-labeled demo-catalog fallback so the demo survives any network.
- 93 passing unit + integration tests; strict TypeScript; the full pipeline runs offline in labeled mock mode.

## The bigger story

Today GiftLens explains *one* agent's choices. But the GEO Lens generalizes: as commerce shifts from page-two rankings to agent conversations, every brand will need to know what the agents can and cannot see in their catalog record. That audit loop — observe, explain, fix, re-test — is a product in itself, and it runs on nothing but the public Catalog API.
