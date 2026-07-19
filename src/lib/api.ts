import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { CatalogError, normalizeCatalogError } from "@/lib/catalog/errors";
import { AiConfigError, AiOutputError } from "@/lib/ai/client";
import { logger } from "@/lib/logger";
import { clientKey, rateLimit } from "@/lib/rate-limit";

/** Shared route-handler helpers: body parsing, limits, and user-safe errors. */

const MAX_BODY_BYTES = 8 * 1024 * 1024; // allows a 5 MB image as base64

export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<
  | { ok: true; data: z.infer<S> }
  | { ok: false; response: NextResponse }
> {
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Request body too large (max 8 MB)." },
        { status: 413 },
      ),
    };
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      ),
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: `Invalid request: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function guardRate(
  req: Request,
  route: string,
  limit: number,
): NextResponse | null {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req, route), limit);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many requests. Try again in ${retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }
  return null;
}

/** Map internal errors to user-safe responses — never leaks stack traces. */
export function errorResponse(err: unknown, route: string): NextResponse {
  if (err instanceof AiConfigError) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI is not configured on the server. Set OLLAMA_API_KEY (or ANTHROPIC_API_KEY) in .env.local (heuristic mode handles intent when no key is present, so this indicates an unexpected code path).",
      },
      { status: 503 },
    );
  }
  if (err instanceof AiOutputError) {
    return NextResponse.json(
      { ok: false, error: "The AI response could not be validated. Please retry." },
      { status: 502 },
    );
  }
  const catErr = err instanceof CatalogError ? err : normalizeCatalogError(err);
  logger.error(`route ${route} failed`, {
    code: catErr.code,
    message: catErr.message,
  });
  const status =
    catErr.code === "rate_limited"
      ? 429
      : catErr.code === "timeout"
        ? 504
        : catErr.code === "not_found"
          ? 404
          : 502;
  return NextResponse.json(
    { ok: false, error: catErr.userMessage, code: catErr.code },
    { status },
  );
}
