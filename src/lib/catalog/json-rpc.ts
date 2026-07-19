import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { backoffDelay, sleep, uniqueId } from "@/lib/utils";
import { getCatalogAccessToken } from "./auth";
import { CatalogError, normalizeCatalogError } from "./errors";
import { JsonRpcResponseSchema, type StructuredContent } from "./schemas";

/**
 * Generic JSON-RPC 2.0 caller for the Shopify Global Catalog MCP endpoint.
 *
 * Verified envelope (shopify.dev/docs/agents/catalog, UCP 2026-04-08):
 * {
 *   "jsonrpc": "2.0", "method": "tools/call", "id": <n>,
 *   "params": {
 *     "name": "<tool>",
 *     "arguments": {
 *       "meta": { "ucp-agent": { "profile": "<profile-url>" } },
 *       "catalog": { ...tool params }
 *     }
 *   }
 * }
 */

// Shopify's officially hosted example profile — documented for connectivity
// testing during development. Production deployments should host their own
// profile and set UCP_AGENT_PROFILE_URL.
export const EXAMPLE_PROFILE_URL =
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";

export function resolveProfileUrl(): string {
  return env.agentProfileUrl ?? EXAMPLE_PROFILE_URL;
}

export interface JsonRpcCallOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export type CatalogToolName =
  | "search_catalog"
  | "lookup_catalog"
  | "get_product";

export async function callCatalogTool(
  tool: CatalogToolName,
  catalogArgs: Record<string, unknown>,
  opts: JsonRpcCallOptions = {},
): Promise<StructuredContent> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 2;

  const body = {
    jsonrpc: "2.0",
    method: "tools/call",
    id: uniqueId("rpc"),
    params: {
      name: tool,
      arguments: {
        meta: { "ucp-agent": { profile: resolveProfileUrl() } },
        catalog: catalogArgs,
      },
    },
  };

  let lastError: CatalogError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(backoffDelay(attempt));
    try {
      return await executeOnce(tool, body, timeoutMs);
    } catch (err) {
      const catErr = normalizeCatalogError(err);
      lastError = catErr;
      // Retry only transient failures (429 / 5xx / network / timeout).
      if (!catErr.retryable || attempt === maxRetries) throw catErr;
      logger.warn("catalog rpc retrying", {
        tool,
        attempt: attempt + 1,
        code: catErr.code,
      });
    }
  }
  throw lastError ?? new CatalogError({ code: "unknown", message: "unreachable" });
}

async function executeOnce(
  tool: CatalogToolName,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<StructuredContent> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Authenticated mode when credentials exist; anonymous otherwise (no header).
  let token: string | null = null;
  try {
    token = await getCatalogAccessToken();
  } catch {
    // Auth failure → fall back to anonymous rather than failing the call.
    logger.warn("catalog rpc: proceeding anonymously after auth failure", { tool });
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(env.catalogEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new CatalogError({
        code: "rate_limited",
        message: "Catalog endpoint returned 429",
        status: 429,
        retryable: true,
      });
    }
    if (res.status >= 500) {
      throw new CatalogError({
        code: "http_error",
        message: `Catalog endpoint returned HTTP ${res.status}`,
        status: res.status,
        retryable: true,
      });
    }
    if (!res.ok) {
      throw new CatalogError({
        code: "http_error",
        message: `Catalog endpoint returned HTTP ${res.status}`,
        status: res.status,
      });
    }

    const json: unknown = await res.json();
    const parsed = JsonRpcResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new CatalogError({
        code: "invalid_response",
        message: `Catalog response failed validation: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => i.path.join("."))
          .join(", ")}`,
      });
    }
    if (parsed.data.error) {
      throw new CatalogError({
        code: "json_rpc_error",
        message: `JSON-RPC error ${parsed.data.error.code ?? ""}: ${
          parsed.data.error.message ?? "unknown"
        }`,
      });
    }
    const structured = parsed.data.result?.structuredContent;
    if (!structured) {
      // Tool-level failures arrive as HTTP 200 + isError + a text content item.
      // Surface that text — "missing structuredContent" hides the real cause.
      const textItem = (parsed.data.result?.content ?? []).find(
        (c): c is { type?: string; text: string } =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as { text?: unknown }).text === "string" &&
          ((c as { text: string }).text.length > 0),
      );
      throw new CatalogError({
        code: "invalid_response",
        message: textItem
          ? `Catalog tool error: ${textItem.text.slice(0, 300)}`
          : "Catalog response missing result.structuredContent",
      });
    }
    logger.debug("catalog rpc ok", {
      tool,
      durationMs: Date.now() - startedAt,
      productCount:
        structured.products?.length ?? (structured.product ? 1 : 0),
    });
    return structured;
  } finally {
    clearTimeout(timer);
  }
}

/** List negotiated tools from the MCP endpoint (used by the smoke script). */
export async function listCatalogTools(timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let token: string | null = null;
    try {
      token = await getCatalogAccessToken();
    } catch {
      // anonymous is fine for tools/list
    }
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(env.catalogEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: uniqueId("rpc"),
        // Verified empirically: tools/list also requires the agent profile,
        // in the same arguments.meta placement as tools/call.
        params: {
          arguments: { meta: { "ucp-agent": { profile: resolveProfileUrl() } } },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CatalogError({
        code: "http_error",
        message: `tools/list returned HTTP ${res.status}`,
        status: res.status,
      });
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
