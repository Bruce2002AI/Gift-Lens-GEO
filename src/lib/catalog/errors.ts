/** Typed catalog errors with user-safe messages. */

export type CatalogErrorCode =
  | "timeout"
  | "rate_limited"
  | "http_error"
  | "json_rpc_error"
  | "invalid_response"
  | "auth_failed"
  | "profile_missing"
  | "not_found"
  | "network_error"
  | "mock_disabled"
  | "unknown";

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  /** Safe to show to end users — never includes tokens/stack details. */
  readonly userMessage: string;

  constructor(opts: {
    code: CatalogErrorCode;
    message: string;
    userMessage?: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(opts.message);
    this.name = "CatalogError";
    this.code = opts.code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.userMessage = opts.userMessage ?? defaultUserMessage(opts.code);
  }
}

function defaultUserMessage(code: CatalogErrorCode): string {
  switch (code) {
    case "timeout":
      return "The Shopify Catalog took too long to respond. Please try again.";
    case "rate_limited":
      return "The Shopify Catalog is rate-limiting requests right now. Please wait a moment and retry.";
    case "auth_failed":
      return "Catalog authentication failed. Check the Shopify Catalog credentials on the server.";
    case "profile_missing":
      return "The UCP agent profile is not configured. Set UCP_AGENT_PROFILE_URL to a publicly reachable profile.";
    case "not_found":
      return "GiftLens could not resolve this identifier in the selected catalog context.";
    case "mock_disabled":
      return "Live catalog is unavailable and mock fallback is disabled (ALLOW_MOCK_FALLBACK=false).";
    case "network_error":
      return "Could not reach the Shopify Catalog service. Check your network connection.";
    default:
      return "The catalog request failed. Please try again.";
  }
}

export function normalizeCatalogError(err: unknown): CatalogError {
  if (err instanceof CatalogError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new CatalogError({
      code: "timeout",
      message: "Catalog request aborted (timeout)",
      retryable: true,
    });
  }
  if (err instanceof Error) {
    const msg = err.message || "Unknown catalog error";
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(msg)) {
      return new CatalogError({
        code: "network_error",
        message: msg,
        retryable: true,
      });
    }
    return new CatalogError({ code: "unknown", message: msg });
  }
  return new CatalogError({ code: "unknown", message: String(err) });
}
