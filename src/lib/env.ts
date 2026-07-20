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
  // Google Gemini is the primary AI provider (creative + reliable structured
  // output + natively multimodal). Falls back to Ollama, then Anthropic.
  get geminiApiKeys(): string[] {
    const fromList = (readString("GEMINI_API_KEYS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const primary = readString("GEMINI_API_KEY");
    const all = [...fromList];
    if (primary && !all.includes(primary)) all.push(primary);
    return [...new Set(all)];
  },
  get geminiModel(): string {
    return readString("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
  },
  /** Gemini is multimodal, so image analysis uses the same model unless overridden. */
  get geminiVisionModel(): string {
    return readString("GEMINI_VISION_MODEL") ?? env.geminiModel;
  },
  get geminiBaseUrl(): string {
    return (readString("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/+$/,
      "",
    );
  },
  // Ollama Cloud (secondary provider, used only when no Gemini key is set).
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

  // ── Authentication (server-only) ─────────────────────────────────
  /** NextAuth JWT signing secret; also keys the OTP HMAC. Auth is disabled without it. */
  get authSecret(): string | null {
    return readString("AUTH_SECRET");
  },
  /** Google OAuth client id (from Google Cloud console). */
  get googleClientId(): string | null {
    return readString("AUTH_GOOGLE_ID");
  },
  /** Google OAuth client secret. */
  get googleClientSecret(): string | null {
    return readString("AUTH_GOOGLE_SECRET");
  },
  get mongoUri(): string | null {
    return readString("MONGODB_URI");
  },
  get mongoDbName(): string {
    return readString("MONGODB_DB") ?? "shoplens";
  },
  /** OTP lifetime in seconds (default 5 minutes). */
  get otpTtlSeconds(): number {
    const raw = Number(readString("OTP_TTL_SECONDS"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300;
  },
  /** OTP code length in digits (default 6, clamped 4–10). */
  get otpLength(): number {
    const raw = Number(readString("OTP_LENGTH"));
    if (!Number.isFinite(raw)) return 6;
    return Math.min(10, Math.max(4, Math.floor(raw)));
  },
  /** Session lifetime in days (default 7). */
  get sessionMaxAgeDays(): number {
    const raw = Number(readString("SESSION_MAX_AGE_DAYS"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
  },
  /** True when the auth core (secret + database) is configured. */
  get authConfigured(): boolean {
    return Boolean(env.authSecret && env.mongoUri);
  },

  // ── Email delivery (server-only) ─────────────────────────────────
  /** Postmark server token (Server API token). Empty → OTP falls back to the console stub. */
  get postmarkServerToken(): string | null {
    return readString("POSTMARK_SERVER_TOKEN");
  },
  /** Verified Postmark sender, e.g. `ShopLens <login@yourdomain.com>` (or a bare address). */
  get emailFrom(): string | null {
    return readString("EMAIL_FROM");
  },
  /** Postmark message stream id; transactional mail uses "outbound". */
  get postmarkMessageStream(): string {
    return readString("POSTMARK_MESSAGE_STREAM") ?? "outbound";
  },
  /** True when real email delivery (Postmark) is configured. */
  get emailConfigured(): boolean {
    return Boolean(env.postmarkServerToken && env.emailFrom);
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
  if (env.geminiApiKeys.length === 0 && !env.ollamaApiKey && !env.anthropicApiKey) {
    issues.push({
      key: "GEMINI_API_KEY",
      message:
        "No AI provider is configured. Gift understanding falls back to the labeled deterministic heuristic; set GEMINI_API_KEY (or OLLAMA_API_KEY / ANTHROPIC_API_KEY) for LLM-powered intent extraction and explanations.",
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
  if (!env.authSecret || !env.mongoUri) {
    issues.push({
      key: "AUTH_SECRET",
      message:
        "Authentication is disabled: set AUTH_SECRET and MONGODB_URI to enable email-OTP and Google sign-in.",
      severity: "warning",
    });
  }
  if (
    (env.googleClientId && !env.googleClientSecret) ||
    (!env.googleClientId && env.googleClientSecret)
  ) {
    issues.push({
      key: "AUTH_GOOGLE_ID",
      message:
        "Both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set together to enable Google sign-in.",
      severity: "error",
    });
  }
  if (
    (env.postmarkServerToken && !env.emailFrom) ||
    (!env.postmarkServerToken && env.emailFrom)
  ) {
    issues.push({
      key: "POSTMARK_SERVER_TOKEN",
      message:
        "Both POSTMARK_SERVER_TOKEN and EMAIL_FROM must be set together to send real OTP emails via Postmark; otherwise the code is logged to the server console.",
      severity: "warning",
    });
  }
  return issues;
}
