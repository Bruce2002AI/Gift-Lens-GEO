/**
 * Catalog smoke test — verifies the negotiated tools and runs a basic search
 * against the Shopify Global Catalog MCP endpoint.
 *
 * Standalone on purpose (doesn't import app modules, which are guarded by
 * `server-only`). Reads .env.local / .env itself.
 *
 * Run: npm run catalog:smoke
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

const ENDPOINT =
  process.env.SHOPIFY_CATALOG_ENDPOINT ??
  "https://catalog.shopify.com/api/ucp/mcp";
const PROFILE =
  process.env.UCP_AGENT_PROFILE_URL ||
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const TOKEN_ENDPOINT = "https://api.shopify.com/auth/access_token";

async function getToken(): Promise<string | null> {
  const clientId = process.env.SHOPIFY_CATALOG_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CATALOG_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log("• No credentials set — using ANONYMOUS mode (lowest rate limits).");
    return null;
  }
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) {
      console.log(`• Token endpoint returned HTTP ${res.status} — falling back to anonymous mode.`);
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      console.log("• Token response missing access_token — anonymous mode.");
      return null;
    }
    const [, payload] = json.access_token.split(".");
    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
      console.log(
        `• AUTHENTICATED mode. Token exp: ${new Date(decoded.exp * 1000).toISOString()}${
          decoded.scopes ? `, scopes: ${JSON.stringify(decoded.scopes)}` : ""
        }`,
      );
    } catch {
      console.log("• AUTHENTICATED mode (JWT payload not decodable).");
    }
    return json.access_token;
  } catch (err) {
    console.log(`• Token fetch failed (${(err as Error).message}) — anonymous mode.`);
    return null;
  }
}

async function rpc(
  token: string | null,
  method: string,
  params: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, id: Date.now(), params }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function main() {
  console.log(`GiftLens catalog smoke test`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Agent profile: ${PROFILE}`);
  const token = await getToken();

  // 1. tools/list — verify negotiated tools.
  console.log("\n[1/2] tools/list …");
  try {
    const tools = (await rpc(token, "tools/list", {
      arguments: { meta: { "ucp-agent": { profile: PROFILE } } },
    })) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = tools.result?.tools?.map((t) => t.name) ?? [];
    console.log(`  Tools negotiated: ${names.join(", ") || "(none reported)"}`);
    const expected = ["search_catalog", "lookup_catalog", "get_product"];
    for (const e of expected) {
      console.log(`  ${names.includes(e) ? "✓" : "✗"} ${e}`);
    }
  } catch (err) {
    console.log(`  tools/list failed: ${(err as Error).message}`);
  }

  // 2. Basic search.
  console.log('\n[2/2] search_catalog "minimalist coffee gift" (ships_to IN, max ₹4,000) …');
  try {
    const search = (await rpc(token, "tools/call", {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: PROFILE } },
        catalog: {
          query: "minimalist coffee gift",
          context: { address_country: "IN", currency: "INR" },
          filters: {
            available: true,
            ships_to: { country: "IN" },
            price: { max: 400000 },
          },
          pagination: { limit: 5 },
        },
      },
    })) as {
      result?: {
        structuredContent?: {
          products?: Array<{ title?: string; price_range?: { min?: { amount?: number; currency?: string } } }>;
          messages?: unknown[];
        };
      };
      error?: { code?: number; message?: string };
    };
    if (search.error) {
      console.log(`  JSON-RPC error ${search.error.code}: ${search.error.message}`);
      process.exitCode = 1;
      return;
    }
    const products = search.result?.structuredContent?.products ?? [];
    console.log(`  ✓ ${products.length} products returned`);
    for (const p of products.slice(0, 5)) {
      const price = p.price_range?.min;
      console.log(
        `    - ${p.title ?? "(untitled)"}${price ? ` — ${price.amount} ${price.currency} (minor units)` : ""}`,
      );
    }
    if (products.length === 0) {
      console.log(
        "  Note: zero results is not necessarily an error — try a broader query.",
      );
    }
    console.log("\nSmoke test PASSED — live Catalog reachable.");
  } catch (err) {
    console.log(`  search failed: ${(err as Error).message}`);
    console.log(
      "\nSmoke test FAILED — the app will use the labeled mock fallback when CATALOG_MODE=auto and ALLOW_MOCK_FALLBACK=true.",
    );
    process.exitCode = 1;
  }
}

main();
