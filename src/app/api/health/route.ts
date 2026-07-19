import { NextResponse } from "next/server";
import { aiAvailable, aiProvider } from "@/lib/ai/client";
import { catalogModeInfo } from "@/lib/catalog/client";
import { env, validateEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const issues = validateEnv();
  const mode = catalogModeInfo();
  return NextResponse.json({
    ok: issues.every((i) => i.severity !== "error"),
    app: "ShopLens",
    catalog: {
      mode: mode.mode,
      authenticated: mode.authenticated,
      allowMockFallback: mode.allowMockFallback,
      endpoint: env.catalogEndpoint,
      profileConfigured: Boolean(env.agentProfileUrl),
    },
    ai: {
      configured: aiAvailable(),
      provider: aiProvider(),
      model:
        aiProvider() === "ollama"
          ? env.ollamaModel
          : aiProvider() === "anthropic"
            ? env.anthropicModel
            : null,
      fallback: aiAvailable() ? null : "deterministic heuristic (labeled in UI)",
    },
    issues,
    timestamp: new Date().toISOString(),
  });
}
