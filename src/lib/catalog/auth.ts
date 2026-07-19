import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { CatalogError } from "./errors";
import { TokenResponseSchema } from "./schemas";

/**
 * Shopify Catalog bearer-token manager (client_credentials flow).
 * Docs: POST https://api.shopify.com/auth/access_token with
 * { client_id, client_secret, grant_type: "client_credentials" } → { access_token }.
 * The response is a JWT with no documented expires_in — expiry comes from the
 * token's `exp` claim (tokens last ~60 minutes). We refresh 5 minutes early.
 *
 * The token and client secret never leave the server.
 */

const TOKEN_ENDPOINT = "https://api.shopify.com/auth/access_token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<string | null> | null = null;

/** Decode a JWT payload without verifying (we only need `exp`). */
export function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
    if (typeof json.exp === "number") return json.exp * 1000;
    return null;
  } catch {
    return null;
  }
}

async function fetchToken(): Promise<string | null> {
  const clientId = env.catalogClientId;
  const clientSecret = env.catalogClientSecret;
  if (!clientId || !clientSecret) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CatalogError({
        code: "auth_failed",
        message: `Token endpoint returned HTTP ${res.status}`,
        status: res.status,
      });
    }
    const parsed = TokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new CatalogError({
        code: "auth_failed",
        message: "Token endpoint returned an unexpected shape",
      });
    }
    const token = parsed.data.access_token;
    const expFromJwt = decodeJwtExpMs(token);
    const expFromField = parsed.data.expires_in
      ? Date.now() + parsed.data.expires_in * 1000
      : null;
    // Prefer the JWT exp claim; fall back to expires_in, then a conservative 50 min.
    const expiresAtMs =
      expFromJwt ?? expFromField ?? Date.now() + 50 * 60 * 1000;
    cached = { token, expiresAtMs };
    logger.info("catalog auth: token acquired", {
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    return token;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a valid bearer token, refreshing before expiry.
 * Returns null when credentials are not configured (anonymous mode).
 */
export async function getCatalogAccessToken(): Promise<string | null> {
  if (!env.catalogClientId || !env.catalogClientSecret) return null;
  if (cached && Date.now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
    return cached.token;
  }
  if (!inflight) {
    inflight = fetchToken()
      .catch((err) => {
        logger.warn("catalog auth: token fetch failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test hook. */
export function _resetTokenCacheForTests(): void {
  cached = null;
  inflight = null;
}
