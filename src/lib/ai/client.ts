import "server-only";
import type AnthropicTypes from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Server-only structured-output client. Provider-agnostic:
 *  - Ollama (preferred when OLLAMA_API_KEY is set) via its OpenAI-free native
 *    chat API with JSON output mode.
 *  - Anthropic (when ANTHROPIC_API_KEY is set) as an alternative.
 *  - Neither configured → callers fall back to the labeled deterministic
 *    heuristic implementations.
 *
 * Every model response is validated with Zod; one repair pass retries with the
 * validation errors before giving up. The model never invents product facts —
 * callers pass catalog evidence in and validate what comes out.
 */

export type AiProvider = "gemini" | "ollama" | "anthropic" | "none";

export function aiProvider(): AiProvider {
  if (env.geminiApiKeys.length > 0) return "gemini";
  if (env.ollamaApiKey) return "ollama";
  if (env.anthropicApiKey) return "anthropic";
  return "none";
}

export function aiAvailable(): boolean {
  return aiProvider() !== "none";
}

/** Which engine produced an AI-shaped result. Heuristic mode is always labeled in the UI. */
export type AiMode = "ai" | "heuristic";

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

/** Extract the first JSON object/array from model text (handles code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost {...} or [...] span.
    const first = candidate.search(/[[{]/);
    if (first === -1) throw new AiOutputError("No JSON found in model output");
    const open = candidate[first];
    const close = open === "{" ? "}" : "]";
    const last = candidate.lastIndexOf(close);
    if (last <= first) throw new AiOutputError("Unbalanced JSON in model output");
    return JSON.parse(candidate.slice(first, last + 1));
  }
}

export interface StructuredOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Extra image (base64) for multimodal calls, when the provider/model supports vision. */
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };
  /** Override the provider model for this call (e.g. the vision model). */
  model?: string;
}

/** True when a multimodal model is configured — gates every image affordance. */
export function visionAvailable(): boolean {
  const p = aiProvider();
  if (p === "gemini") return true; // Gemini models are natively multimodal.
  if (p === "ollama") return Boolean(env.ollamaVisionModel);
  return p === "anthropic";
}

export function visionModel(): string | null {
  const p = aiProvider();
  if (p === "gemini") return env.geminiVisionModel;
  if (p === "ollama") return env.ollamaVisionModel;
  if (p === "anthropic") return env.anthropicModel;
  return null;
}

/** HTTP statuses that mean "this key is spent — try another", not "the request is bad". */
function isKeyRotationStatus(status: number): boolean {
  return status === 429 || status === 401 || status === 403;
}

// ── Gemini (generateContent, JSON output mode, natively multimodal) ──────────

/** Sticky key index for the Gemini pool (same rotation discipline as Ollama). */
let geminiKeyIndex = 0;

/** Permissive safety thresholds: our content is benign educational/shopping
 *  guidance, and default filters occasionally false-block skin/body topics. */
const GEMINI_SAFETY = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

async function geminiFetchOnce(
  key: string,
  model: string,
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  const parts: unknown[] = [{ text: prompt }];
  if (opts.image) {
    parts.push({ inline_data: { mime_type: opts.image.mediaType, data: opts.image.base64 } });
  }
  const body = {
    system_instruction: {
      parts: [
        {
          text: `${system}\n\nRespond with ONLY a single valid JSON value matching the requested shape. No prose, no markdown fences.`,
        },
      ],
    },
    contents: [{ role: "user", parts }],
    safetySettings: GEMINI_SAFETY,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxTokens ?? 2000,
      // Disable "thinking" so we get the answer directly and fast (and so JSON
      // isn't preceded by a reasoning preamble that breaks parsing).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  try {
    return await fetch(`${env.geminiBaseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function geminiCall(
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<string> {
  const keys = env.geminiApiKeys;
  if (keys.length === 0) throw new AiConfigError("No Gemini API key is configured on the server.");
  const model = opts.model ?? env.geminiModel;

  let lastRotationErr: Error | null = null;
  for (let tries = 0; tries < keys.length; tries += 1) {
    const idx = geminiKeyIndex % keys.length;
    const res = await geminiFetchOnce(keys[idx], model, system, prompt, opts);

    if (isKeyRotationStatus(res.status)) {
      const body = await res.text().catch(() => "");
      lastRotationErr = new AiOutputError(
        `Gemini key #${idx} got HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
      logger.warn("gemini key rotating", { status: res.status, fromIndex: idx, poolSize: keys.length });
      geminiKeyIndex = (geminiKeyIndex + 1) % keys.length;
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiOutputError(`Gemini returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text)
      .filter((t): t is string => Boolean(t))
      .join("");
    if (!text) {
      const reason = cand?.finishReason ?? json.promptFeedback?.blockReason ?? "no content";
      throw new AiOutputError(`Gemini returned no text content (${reason})`);
    }
    return text;
  }
  throw lastRotationErr ?? new AiOutputError("All Gemini API keys are rate-limited or unavailable.");
}

// ── Ollama (native chat API, JSON output mode) ───────────────────────────────

/**
 * Which key in the pool to use next. Module-level and sticky: a working key
 * stays current, and we only advance past one that got rate-limited or rejected
 * — so we don't re-hit an exhausted key at the top of every request.
 */
let ollamaKeyIndex = 0;

/** One /api/chat POST with an explicit key. Rotation is handled by the caller. */
async function ollamaFetchOnce(
  key: string,
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    return await fetch(`${env.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model ?? env.ollamaModel,
        stream: false,
        // Disable chain-of-thought so we get the answer directly and fast.
        think: false,
        // Native JSON output mode: forces syntactically valid JSON.
        format: "json",
        messages: [
          {
            role: "system",
            content: `${system}\n\nRespond with ONLY a single valid JSON value matching the requested shape. No prose, no markdown fences.`,
          },
          {
            role: "user",
            content: prompt,
            ...(opts.image ? { images: [opts.image.base64] } : {}),
          },
        ],
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 2000,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaCall(
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<string> {
  const keys = env.ollamaApiKeys;
  if (keys.length === 0) throw new AiConfigError("No Ollama API key is configured on the server.");

  let lastRotationErr: Error | null = null;
  // Try each key at most once per call, starting from the last-known-good one.
  // Only rate-limit / auth failures rotate; genuine errors (5xx, timeout, bad
  // JSON) propagate so the caller's own retry handles them.
  for (let tries = 0; tries < keys.length; tries += 1) {
    const idx = ollamaKeyIndex % keys.length;
    const res = await ollamaFetchOnce(keys[idx], system, prompt, opts);

    if (isKeyRotationStatus(res.status)) {
      const body = await res.text().catch(() => "");
      lastRotationErr = new AiOutputError(
        `Ollama key #${idx} got HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
      logger.warn("ollama key rotating", {
        status: res.status,
        fromIndex: idx,
        poolSize: keys.length,
      });
      ollamaKeyIndex = (ollamaKeyIndex + 1) % keys.length;
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiOutputError(
        `Ollama returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    const json = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (json.error) throw new AiOutputError(`Ollama error: ${json.error}`);
    const content = json.message?.content;
    if (!content) throw new AiOutputError("Ollama returned no message content");
    return content;
  }
  // Every key in the pool was rate-limited or rejected.
  throw (
    lastRotationErr ??
    new AiOutputError("All Ollama API keys are rate-limited or unavailable.")
  );
}

// ── Anthropic (optional alternative) ─────────────────────────────────────────

async function anthropicCall(
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<string> {
  // Lazy import so the SDK is only loaded when actually used.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.anthropicApiKey! });
  const content: AnthropicTypes.MessageParam["content"] = opts.image
    ? [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: opts.image.mediaType,
            data: opts.image.base64,
          },
        },
        { type: "text", text: prompt },
      ]
    : prompt;
  const response = await client.messages.create(
    {
      model: opts.model ?? env.anthropicModel,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.2,
      system: `${system}\n\nRespond with ONLY a single valid JSON value matching the requested shape. No prose, no markdown fences.`,
      messages: [{ role: "user", content }],
    },
    { timeout: opts.timeoutMs ?? 45_000 },
  );
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new AiOutputError("Model returned no text content");
  }
  return block.text;
}

function callModel(
  system: string,
  prompt: string,
  opts: StructuredOptions,
): Promise<string> {
  switch (aiProvider()) {
    case "gemini":
      return geminiCall(system, prompt, opts);
    case "ollama":
      return ollamaCall(system, prompt, opts);
    case "anthropic":
      return anthropicCall(system, prompt, opts);
    default:
      throw new AiConfigError("No AI provider is configured on the server.");
  }
}

export async function structuredCompletion<S extends z.ZodTypeAny>(
  system: string,
  user: string,
  schema: S,
  opts: StructuredOptions = {},
): Promise<z.infer<S>> {
  const call = (prompt: string) => callModel(system, prompt, opts);

  // First attempt.
  let rawText = await call(user);
  let parsed: unknown;
  try {
    parsed = extractJson(rawText);
    const validated = schema.safeParse(parsed);
    if (validated.success) return validated.data;
    // Repair pass with validation errors.
    const issues = validated.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.warn("ai structured output failed validation, repairing", { issues });
    rawText = await call(
      `${user}\n\nYour previous JSON had validation errors: ${issues}\n\nPrevious output:\n${rawText.slice(0, 3000)}\n\nReturn corrected JSON only.`,
    );
    parsed = extractJson(rawText);
    return schema.parse(parsed);
  } catch (err) {
    if (err instanceof AiOutputError) {
      // JSON extraction failed — one repair attempt.
      rawText = await call(
        `${user}\n\nYour previous reply was not valid JSON. Return ONLY the JSON value, nothing else.`,
      );
      return schema.parse(extractJson(rawText));
    }
    throw err;
  }
}
