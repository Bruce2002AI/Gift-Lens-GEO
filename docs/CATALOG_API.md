# Shopify Global Catalog integration

Verified against shopify.dev agents docs on **2026-07-17** (UCP protocol `2026-04-08`) and confirmed empirically with live calls (`npm run catalog:smoke`).

## Transport

`POST https://catalog.shopify.com/api/ucp/mcp` — JSON-RPC 2.0, `tools/call`.

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": "<unique>",
  "params": {
    "name": "search_catalog | lookup_catalog | get_product",
    "arguments": {
      "meta": { "ucp-agent": { "profile": "<public profile URL>" } },
      "catalog": { "...tool parameters..." }
    }
  }
}
```

Key facts we verified (including empirically, where docs were ambiguous):

- The agent profile lives at `params.arguments.meta["ucp-agent"].profile` — **not** MCP-standard `params._meta`. Required on every request, all tiers.
- `tools/list` also requires the profile in the **same** `arguments.meta` placement (empirically confirmed; `params._meta` and header variants are rejected with `invalid_profile_url`).
- Responses arrive at `result.structuredContent`: `{ ucp, products[] | product, pagination, messages[] }`.
- `messages[]` entries are `{type, code, path, content}`; `lookup_catalog` reports unresolved ids as `code: "not_found"` messages — the call still succeeds.
- Prices are ISO 4217 **minor units** (`{"amount": 400000, "currency": "INR"}` = ₹4,000). Price filters use bare minor ints `{min, max}`.
- Live search can return offers in **multiple currencies** for one query — GiftLens only enforces budget within the intent currency and flags cross-currency prices rather than inventing FX rates.
- `lookup_catalog` accepts 1–50 identifiers on the Global Catalog (product UPID GIDs `gid://shopify/p/…`, variant GIDs, or product URLs).
- Pagination: cursor-based, `limit` 1–50 (default 10), up to 1,000 results.

## Tool responsibilities in GiftLens

| Tool | Shopper side | Brand side |
|---|---|---|
| `search_catalog` | 3 strategy searches; refinements; image/`like` similarity; alternatives to a pasted product | 10 buyer-intent visibility tests; competitor discovery |
| `lookup_catalog` | Pasted URLs; refreshing saved products (never trust cached prices) | First step of every audit — resolve the brand's URL |
| `get_product` | Validate the spotlight picks (and any card the shopper opens); variant selection with `selected` + `preferences` relaxation; checkout URLs | Deep variant/offer audit (option names, combination existence/availability, seller, checkout readiness) |

Parameters we send (all verified): `catalog.query`, `catalog.like` (product id / image), `catalog.context` (`address_country`, `address_region`, `postal_code`, `currency`, `language`, `intent`), `catalog.filters` (`available`, `ships_to {country}`, `price {min,max}`, `categories`), `catalog.pagination {limit}`, `catalog.ids`, `catalog.id`, `catalog.selected [{name,label}]`, `catalog.preferences [names]`.

## Authentication

| Tier | How | Notes |
|---|---|---|
| Anonymous | No `Authorization` header | Lowest rate limits; works with only the profile URL |
| Token (used by GiftLens when credentials are set) | `POST https://api.shopify.com/auth/access_token` with `{client_id, client_secret, grant_type: "client_credentials"}` → `{access_token}` (JWT) | No `expires_in` field — expiry read from the JWT `exp` claim (~60 min). GiftLens caches the token and refreshes 5 min early. Scope observed: `read_global_api_catalog_search`. |

The token and client secret never leave `src/lib/catalog/auth.ts` / `json-rpc.ts`. Auth failure downgrades gracefully to anonymous mode rather than failing the request.

## UCP agent profile

Hosted JSON with root `ucp` object — required fields `version`, `services`, `capabilities`, `payment_handlers` (may be `{}`). Ours is at [`public/ucp-profile.json`](../public/ucp-profile.json), declaring `dev.ucp.shopping.catalog.search` and `.lookup`.

Local development: `UCP_AGENT_PROFILE_URL` empty → GiftLens uses Shopify's officially hosted example profile (`https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json`), which the docs provide for connectivity testing (localhost URLs aren't reachable by Shopify). Production: deploy the app, set `UCP_AGENT_PROFILE_URL=https://YOUR_DOMAIN/ucp-profile.json`, verify with `npm run profile:verify`.

## Error handling

- HTTP 429 → typed `rate_limited`, retried with backoff (max 2), surfaced with a friendly message.
- 5xx / network / timeout → retried, then surfaced; in `auto` mode with `ALLOW_MOCK_FALLBACK=true` the request is served by labeled fixtures instead.
- JSON-RPC `error` objects → `json_rpc_error` (not retried).
- Responses failing Zod validation → `invalid_response` (schemas are `looseObject` — unknown fields pass through; only shape violations fail).
- `not_found` messages are data, not errors: the UI says *“GiftLens could not resolve this identifier in the selected catalog context.”*
