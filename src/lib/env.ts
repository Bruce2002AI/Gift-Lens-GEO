import "server-only";

/**
 * Centralized, server-only environment access.
 * Secrets never leave this module except through server code paths.
 */

export type CatalogMode = "live" | "mock" | "auto";

function readString(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const env = {
  // Ollama Cloud is the primary AI provider.
  get ollamaApiKey(): string | null {
    return readString("OLLAMA_API_KEY") ?? env.ollamaApiKeys[0] ?? null;
  },
  /**
   * The full key pool for rate-limit failover. OLLAMA_API_KEYS (comma-separated)
   * takes ordering precedence so a fresh key leads; the single OLLAMA_API_KEY is
   * appended if it isn't already listed. Deduplicated. Empty when none are set.
   */
  get ollamaApiKeys(): string[] {
    const fromList = (readString("OLLAMA_API_KEYS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const primary = readString("OLLAMA_API_KEY");
    const all = [...fromList];
    if (primary && !all.includes(primary)) all.push(primary);
    return [...new Set(all)];
  },
  get ollamaModel(): string {
    return readString("OLLAMA_MODEL") ?? "gpt-oss:120b";
  },
  /**
   * Optional creative model used ONLY for the opening counsel (a simple say),
   * where warmer, better-structured prose matters most. The reliable default
   * model still handles every structured action (search/inspect/present),
   * because creative models fail the strict JSON envelope. Empty → the default
   * model writes the opener too.
   */
  get ollamaCreativeModel(): string | null {
    return readString("OLLAMA_CREATIVE_MODEL");
  },
  /**
   * Multimodal model used for image understanding (outfit reads, product-image
   * similarity). Empty → image analysis is structurally unavailable and the
   * agent says so rather than pretending to see.
   */
  get ollamaVisionModel(): string | null {
    return readString("OLLAMA_VISION_MODEL");
  },
  get ollamaBaseUrl(): string {
    return (readString("OLLAMA_BASE_URL") ?? "https://ollama.com").replace(
      /\/+$/,
      "",
    );
  },
  // Anthropic is supported as an alternative provider when its key is set.
  get anthropicApiKey(): string | null {
    return readString("ANTHROPIC_API_KEY");
  },
  get anthropicModel(): string {
    return readString("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
  },
  get catalogEndpoint(): string {
    return (
      readString("SHOPIFY_CATALOG_ENDPOINT") ??
      "https://catalog.shopify.com/api/ucp/mcp"
    );
  },
  get agentProfileUrl(): string | null {
    return readString("UCP_AGENT_PROFILE_URL");
  },
  get catalogClientId(): string | null {
    return readString("SHOPIFY_CATALOG_CLIENT_ID");
  },
  get catalogClientSecret(): string | null {
    return readString("SHOPIFY_CATALOG_CLIENT_SECRET");
  },
  get catalogMode(): CatalogMode {
    const raw = readString("CATALOG_MODE")?.toLowerCase();
    if (raw === "live" || raw === "mock" || raw === "auto") return raw;
    return "auto";
  },
  get allowMockFallback(): boolean {
    return readString("ALLOW_MOCK_FALLBACK")?.toLowerCase() === "true";
  },
  get appUrl(): string {
    return readString("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
} as const;

export interface EnvIssue {
  key: string;
  message: string;
  severity: "error" | "warning";
}

/** Validate environment for the requested capability; returns actionable issues. */
export function validateEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];
  if (!env.ollamaApiKey && !env.anthropicApiKey) {
    issues.push({
      key: "OLLAMA_API_KEY",
      message:
        "No AI provider is configured. Gift understanding falls back to the labeled deterministic heuristic; set OLLAMA_API_KEY (or ANTHROPIC_API_KEY) for LLM-powered intent extraction and explanations.",
      severity: "warning",
    });
  }
  if (env.catalogMode === "live" && !env.agentProfileUrl) {
    issues.push({
      key: "UCP_AGENT_PROFILE_URL",
      message:
        "CATALOG_MODE=live requires a publicly reachable UCP agent profile URL (UCP_AGENT_PROFILE_URL).",
      severity: "error",
    });
  }
  if (
    (env.catalogClientId && !env.catalogClientSecret) ||
    (!env.catalogClientId && env.catalogClientSecret)
  ) {
    issues.push({
      key: "SHOPIFY_CATALOG_CLIENT_ID",
      message:
        "Both SHOPIFY_CATALOG_CLIENT_ID and SHOPIFY_CATALOG_CLIENT_SECRET must be set together for authenticated Catalog mode.",
      severity: "error",
    });
  }
  return issues;
}
