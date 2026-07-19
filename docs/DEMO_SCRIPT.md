# GiftLens — 3-minute demo script

**Setup (before you present):** `npm run dev`, open http://localhost:3000, and run `npm run catalog:smoke` once to confirm live Catalog connectivity. If the venue network is hostile, the app auto-falls back to the labeled demo catalog — the banner makes that honest, and the whole flow still works.

---

## Beat 1 — The problem (20s)

> “In traditional search, a weak product listing lands on page two. In agentic commerce, it may never enter the conversation. GiftLens tackles both sides of that: it helps shoppers find the right gift, and helps brands become recommendable to AI agents.”

## Beat 2 — Shopper: the Gift Concierge (75s)

1. Click **Find a gift**. Click the first sample chip:
   *“Housewarming gift for a minimalist coffee lover under ₹4,000”* — or type the full sister/Bengaluru version for the richer brief.
2. Narrate the loading stages: *“It extracts a structured intent, plans three deliberately different searches — literal, adjacent, wildcard — and runs them in parallel against Shopify's Global Catalog with hard filters for price, availability, and ships-to-India.”*
3. When the three cards land: point at **Best Match / Delight Pick / Safe Pick**. *“Three meaningfully different gifts — different merchants, categories, price points. Every card explains why it fits, cites the catalog field the claim came from, and names one honest trade-off. No invented facts: if the catalog didn't say it, GiftLens can't claim it.”*
4. **Open the Catalog API trace** (the judge moment): *“Here's the proof — every search_catalog and get_product call, durations, result counts, live vs cache.”*
5. Quick refinement: click **More unique** → new picks. *“Conversational refinement re-plans the search; hard constraints stay hard.”*
6. Open one product's **Details**: flip a Color/Size option — *“get_product re-validates the exact variant, disables combinations that don't exist, and only an available variant gets the merchant checkout handoff. GiftLens never claims to complete the purchase.”*

## Beat 3 — Brand: the GEO Lens (60s)

1. Go to **GEO Lens**, click *“Use the demo product”* → **Run audit**.
2. While it runs: *“Same three Catalog tools, pointed the other way: resolve the product with lookup_catalog, deep-audit variants with get_product, then run ten realistic buyer searches and see whether this product ever shows up.”*
3. Results: point at the **Agent Readiness Score** and the failing naming checks. *“This product is called ‘The Ritual’. A human gets the vibe. An agent has no idea it's a pour-over coffee set — and the visibility table shows it: shoppers searching ‘coffee gift’ get its competitors instead.”*
4. Show **before/after copy**: *“Evidence-linked fixes and a suggested rewrite — clearly labeled as not applied, and we never claim it guarantees a ranking. We don't know Shopify's algorithm; we measure what agents can observe.”*

## Beat 4 — Close (15s)

> “One catalog, two lenses. The shopper starts with intent and no product; the brand starts with a product and no visibility. GiftLens closes the loop between them — honestly, with every API call on screen.”

---

**Fallback drills:** offline → banner reads “Demo catalog data”, say so proudly and continue; rate-limited → wait for the retry message or switch to the demo product; a pasted URL that doesn't resolve → show the diagnostic not-found message (that's a feature, not a bug).
