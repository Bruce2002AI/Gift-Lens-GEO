/**
 * Verify a UCP agent profile: fetches the configured (or local) profile and
 * checks the documented required fields (ucp.version, services, capabilities,
 * payment_handlers).
 *
 * Run: npm run profile:verify [-- <url>]
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

async function main() {
  const argUrl = process.argv[2];
  const url = argUrl || process.env.UCP_AGENT_PROFILE_URL;

  let profile: unknown;
  if (url) {
    console.log(`Fetching profile: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`✗ HTTP ${res.status} fetching profile`);
      process.exit(1);
    }
    profile = await res.json();
  } else {
    const local = resolve(process.cwd(), "public/ucp-profile.json");
    console.log(`No UCP_AGENT_PROFILE_URL set — validating local file: ${local}`);
    console.log(
      "(Local development uses Shopify's hosted example profile for live calls;",
    );
    console.log(
      " deploy this file and set UCP_AGENT_PROFILE_URL for production.)\n",
    );
    profile = JSON.parse(readFileSync(local, "utf8"));
  }

  const p = profile as { ucp?: Record<string, unknown> };
  const checks: Array<[string, boolean]> = [
    ["root `ucp` object", typeof p.ucp === "object" && p.ucp !== null],
    ["ucp.version (string)", typeof p.ucp?.version === "string"],
    ["ucp.services (object)", typeof p.ucp?.services === "object" && p.ucp?.services !== null],
    ["ucp.capabilities (object)", typeof p.ucp?.capabilities === "object" && p.ucp?.capabilities !== null],
    ["ucp.payment_handlers present", p.ucp !== undefined && "payment_handlers" in (p.ucp as object)],
  ];
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failed++;
  }
  if (p.ucp?.version && p.ucp.version !== "2026-04-08") {
    console.log(
      `  ⚠ version is "${p.ucp.version}" — current documented protocol version is 2026-04-08`,
    );
  }
  console.log(failed === 0 ? "\nProfile looks valid." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
