import "server-only";

/**
 * Lightweight in-memory rate limiter (fixed window per IP+route).
 * Serverless note: state is per-instance and resets on cold start — good
 * enough as abuse protection for a hackathon MVP, not billing-grade.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (w.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000),
    };
  }
  w.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientKey(req: Request, route: string): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${route}:${ip}`;
}
