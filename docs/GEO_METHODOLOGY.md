# GEO Methodology — the GiftLens Agent Readiness Score

**GEO** (Generative Engine Optimization) here means: improving the product information and commerce signals that make a product *understandable and recommendable* to generative AI and shopping agents.

**What this score is not.** It is not Shopify's ranking algorithm (GiftLens has no access to Shopify's private ranking logic), not an official Shopify score, and not a guarantee of visibility. Every number below is computed from data returned by `lookup_catalog`, `get_product`, and `search_catalog` **during the audit**, and from nothing else.

## Score composition (0–100)

| Dimension | Max | What it checks (observable evidence only) |
|---|---|---|
| Naming & taxonomy | 25 | Title names the product type; descriptive length; specific description; use-case/occasion language; categories present |
| Attributes & variants | 20 | Options modeled; meaningful option names; default selection available; a purchasable combination exists; non-generic variant titles |
| Offer confidence | 20 | Price + currency present; available variant; seller identity; checkout URL; returned under the ships-to context |
| Media quality | 15 | Primary image; 3+ images; alt text on most images |
| Trust & policy signals | 10 | Rating present; review volume; seller identity; policy links |
| Prompt visibility | 10 | `coverage × 10` where coverage = appeared ÷ attempted tests |

Every check reports pass/fail, its points, and the exact evidence string (e.g. *“Current title: The Ritual”* → “Title does not clearly name a product type”). Missing data is described as **missing from the returned data** — e.g. a missing rating is “missing trust evidence”, never “proof of low quality”, and never “Shopify penalized this product”.

## Prompt visibility suite

Ten realistic shopper prompts covering the archetypes: literal, recipient, occasion, problem-to-solve, style, budget, destination, not-the-obvious-item, safe-choice, premium/unusual. Claude adapts them to the audited product when configured; a template suite is used otherwise; brands can edit the prompts and re-run.

Per prompt we record: appeared or not, observed position (“Appeared at position 4 **in this test**”), results inspected (first 20), top visible competitor, match type (product vs variant), timestamp, API warnings, and whether a hard filter (price cap, `available: true`) could have excluded the product.

Statuses are strictly separated:

- **Appeared** — the product or one of its variants was in the first 20 results.
- **Not observed** — it wasn't, in this test, at this moment. Results may vary with context and catalog changes.
- **Test failed** — the search errored. Excluded from the coverage denominator; failure is *never* counted as invisibility.
- **Unresolved / ineligible** — reported separately with diagnostic language.

## Audit confidence (high / medium / low)

Reflects how much the score should be trusted: identifier resolution, presence of price/variant/offer data, and the fraction of visibility tests that completed. A score built on sparse data is explicitly labeled less certain, with the reasons listed.

## Recommendations

Each one links issue → observed evidence → why it may affect agent comprehension → concrete suggested change → priority → confidence, and the UI carries a standing disclaimer that no change guarantees ranking. The before/after copy preview is labeled *“not yet applied to Shopify”* — GiftLens never modifies a merchant listing, and Claude-generated copy is constrained to facts present in the returned listing data.
