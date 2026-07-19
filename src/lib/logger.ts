/**
 * Minimal structured logger. Never log secrets, bearer tokens,
 * base64 image payloads, or full conversation text.
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN =
  /(secret|token|authorization|api[-_]?key|password|cookie|base64|imagedata)/i;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeForLog(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k)
        ? "[redacted]"
        : sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: sanitizeForLog(meta) } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    process.env.NODE_ENV !== "production" && emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
