/**
 * Small in-memory TTL cache for repeated Catalog calls.
 * NOTE: serverless memory is ephemeral — each instance has its own cache and
 * it disappears on cold starts. That is acceptable for this MVP; never store
 * secrets here.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(
    private readonly maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries) {
      // Drop the oldest entry (Map preserves insertion order).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/** Stable cache key from any JSON-serializable parts (sorted keys). */
export function cacheKey(parts: Record<string, unknown>): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(stable(parts));
}

export const CACHE_TTL = {
  search: 5 * 60 * 1000,
  product: 90 * 1000,
  lookup: 90 * 1000,
} as const;
