/**
 * UCP field inventory — discovers EVERY field the live Global Catalog returns
 * for products/variants, so the UI can surface all of it instead of guessing.
 *
 * Standalone (no app imports — those are `server-only`). Reads .env.local.
 * Run: npx tsx scripts/ucp-field-dump.ts
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
  process.env.SHOPIFY_CATALOG_ENDPOINT ?? "https://catalog.shopify.com/api/ucp/mcp";
const PROFILE =
  process.env.UCP_AGENT_PROFILE_URL ||
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const TOKEN_ENDPOINT = "https://api.shopify.com/auth/access_token";

async function getToken(): Promise<string | null> {
  const clientId = process.env.SHOPIFY_CATALOG_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CATALOG_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

async function rpc(token: string | null, name: string, catalog: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: Date.now(),
      params: { name, arguments: { meta: { "ucp-agent": { profile: PROFILE } }, catalog } },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Recursively collect dotted key paths with a sample of each leaf's type. */
function collectPaths(
  value: unknown,
  prefix: string,
  out: Map<string, Set<string>>,
): void {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 4)) collectPaths(item, `${prefix}[]`, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  const t =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!out.has(prefix)) out.set(prefix, new Set());
  const set = out.get(prefix)!;
  set.add(t);
  if (set.size < 3 && typeof value === "string" && value.length < 60) {
    set.add(`e.g. ${JSON.stringify(value)}`);
  }
}

async function main() {
  const token = await getToken();
  console.log(`Mode: ${token ? "AUTHENTICATED" : "ANONYMOUS"}\n`);

  const search = await rpc(token, "search_catalog", {
    query: "vitamin c serum",
    context: { address_country: "IN", currency: "INR" },
    filters: { available: true },
    pagination: { limit: 3 },
  });

  const structured = search?.result?.structuredContent;
  const products = structured?.products ?? [];
  console.log(`search_catalog → ${products.length} products`);
  console.log(`structuredContent top-level keys: ${Object.keys(structured ?? {}).join(", ")}\n`);

  const searchPaths = new Map<string, Set<string>>();
  for (const p of products) collectPaths(p, "", searchPaths);

  console.log("=== FIELDS FROM search_catalog (per product) ===");
  for (const key of [...searchPaths.keys()].sort()) {
    console.log(`  ${key}  ::  ${[...searchPaths.get(key)!].join(" | ")}`);
  }

  // get_product on the first result — usually richer than search results.
  const firstId = products[0]?.id;
  const detailPaths = new Map<string, Set<string>>();
  let detail: unknown = null;
  if (firstId) {
    console.log(`\n=== get_product("${firstId}") ===`);
    try {
      const got = await rpc(token, "get_product", {
        product_id: firstId,
        context: { address_country: "IN", currency: "INR" },
      });
      detail = got?.result?.structuredContent;
      const prod = (detail as { product?: unknown })?.product;
      collectPaths(prod, "", detailPaths);
      console.log(
        `structuredContent keys: ${Object.keys((detail ?? {}) as object).join(", ")}\n`,
      );
      for (const key of [...detailPaths.keys()].sort()) {
        console.log(`  ${key}  ::  ${[...detailPaths.get(key)!].join(" | ")}`);
      }
    } catch (e) {
      console.log(`  get_product failed: ${(e as Error).message}`);
    }
  }

  // Fields present in get_product but absent from search results.
  const extra = [...detailPaths.keys()].filter((k) => !searchPaths.has(k));
  if (extra.length) {
    console.log(`\n=== ONLY in get_product (${extra.length}) ===`);
    for (const k of extra.sort()) console.log(`  ${k}`);
  }

  const outFile = resolve(process.cwd(), "docs/ucp-field-inventory.json");
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        searchFields: Object.fromEntries(
          [...searchPaths].map(([k, v]) => [k, [...v]]),
        ),
        detailFields: Object.fromEntries(
          [...detailPaths].map(([k, v]) => [k, [...v]]),
        ),
        sampleSearchProduct: products[0] ?? null,
        sampleDetail: detail,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull inventory + raw samples written to ${outFile}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
