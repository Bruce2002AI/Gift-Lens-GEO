import { describe, expect, it, vi } from "vitest";
import { TtlCache, cacheKey } from "@/lib/catalog/cache";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeForLog } from "@/lib/logger";
import { htmlToPlainText, normalizeTitleKey, phraseInText, uniqueId } from "@/lib/utils";
import { decodeJwtExpMs } from "@/lib/catalog/auth";
import { TraceCollector } from "@/lib/catalog/trace";
import type { TraceEvent } from "@/lib/catalog/types";

describe("TtlCache", () => {
  it("stores and expires entries", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(10);
    cache.set("a", "value", 1000);
    expect(cache.get("a")).toBe("value");
    vi.advanceTimersByTime(1500);
    expect(cache.get("a")).toBeUndefined();
    vi.useRealTimers();
  });

  it("evicts the oldest entry at capacity", () => {
    const cache = new TtlCache<number>(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});

describe("cacheKey", () => {
  it("is stable regardless of key order", () => {
    expect(cacheKey({ a: 1, b: { x: 1, y: 2 } })).toBe(
      cacheKey({ b: { y: 2, x: 1 }, a: 1 }),
    );
  });

  it("differs for different values", () => {
    expect(cacheKey({ q: "coffee" })).not.toBe(cacheKey({ q: "tea" }));
  });
});

describe("rateLimit", () => {
  it("allows up to the limit then rejects within the window", () => {
    const key = `test-${uniqueId()}`;
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("sanitizeForLog", () => {
  it("redacts secret-looking keys", () => {
    const out = sanitizeForLog({
      client_secret: "shhh",
      authorization: "Bearer abc",
      apiKey: "k",
      imageData: "base64...",
      safe: "ok",
    }) as Record<string, unknown>;
    expect(out.client_secret).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.imageData).toBe("[redacted]");
    expect(out.safe).toBe("ok");
  });

  it("truncates very long strings (no base64 blobs in logs)", () => {
    const out = sanitizeForLog("x".repeat(2000)) as string;
    expect(out.length).toBeLessThan(600);
  });
});

describe("htmlToPlainText", () => {
  it("strips tags, scripts, and entities", () => {
    const out = htmlToPlainText(
      '<p>A &amp; B</p><script>alert("x")</script><b>C</b>',
    );
    // Block-level closes become newlines; no markup or script content survives.
    expect(out.replace(/\s+/g, " ")).toBe("A & B C");
    expect(out).not.toContain("<");
    expect(out).not.toContain("alert");
  });
});

describe("phraseInText (whole-word matching)", () => {
  it("matches whole words but not substrings inside other words", () => {
    expect(phraseInText("a cat toy", "cat")).toBe(true);
    expect(phraseInText("delicate gold necklace", "cat")).toBe(false);
    expect(phraseInText("scatter cushion", "cat")).toBe(false);
    expect(phraseInText("leather shoulder bag", "sho")).toBe(false);
    expect(phraseInText("skincare set", "car")).toBe(false);
  });

  it("matches multi-word phrases only when the words are contiguous", () => {
    expect(phraseInText("blue coffee mug", "coffee mug")).toBe(true);
    // A plural in the text is a different word — no match without inflection.
    expect(phraseInText("coffee mugs set", "coffee mug")).toBe(false);
    expect(phraseInText("coffee beans", "coffee mug")).toBe(false);
  });

  it("ignores punctuation and casing on both sides", () => {
    expect(phraseInText("Aromatherapy Candle — trio", "candle")).toBe(true);
    expect(phraseInText("", "candle")).toBe(false);
    expect(phraseInText("candle", "")).toBe(false);
  });

  it("folds singular/plural forms with stemPlurals, in both directions", () => {
    const s = { stemPlurals: true };
    expect(phraseInText("aromatherapy candle trio", "candles", s)).toBe(true);
    expect(phraseInText("scented candles", "candle", s)).toBe(true);
    expect(phraseInText("slim phone case", "phone cases", s)).toBe(true); // case, not "cas"
    expect(phraseInText("set of wine glasses", "glass", s)).toBe(true); // glass ⇄ glasses
    // Still whole-word — no substring false positives even when stemming.
    expect(phraseInText("delicate necklace", "cats", s)).toBe(false);
    expect(phraseInText("communicate clearly", "cat", s)).toBe(false);
  });
});

describe("normalizeTitleKey", () => {
  it("matches reordered titles", () => {
    expect(normalizeTitleKey("Ceramic Pour-Over Set")).toBe(
      normalizeTitleKey("pour over set, CERAMIC!"),
    );
  });
});

describe("TraceCollector.overallSource (honesty labeling)", () => {
  function evt(tool: TraceEvent["tool"], source: "live" | "mock") {
    return { tool, label: "x", durationMs: 1, source, ok: true };
  }

  it("labels all-live catalog calls as live", () => {
    const t = new TraceCollector();
    t.add(evt("search_catalog", "live"));
    t.add(evt("get_product", "live"));
    t.add(evt("ai", "live")); // non-catalog events ignored
    expect(t.overallSource()).toBe("live");
  });

  it("downgrades to mixed when any catalog call fell back to mock", () => {
    const t = new TraceCollector();
    t.add(evt("lookup_catalog", "live"));
    t.add(evt("search_catalog", "mock"));
    expect(t.overallSource()).toBe("mixed");
  });

  it("labels all-mock as mock", () => {
    const t = new TraceCollector();
    t.add(evt("search_catalog", "mock"));
    expect(t.overallSource()).toBe("mock");
  });

  it("uses the fallback when no catalog calls were made", () => {
    expect(new TraceCollector().overallSource("mock")).toBe("mock");
  });
});

describe("decodeJwtExpMs", () => {
  it("reads the exp claim from a JWT payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    const token = `header.${payload}.sig`;
    expect(decodeJwtExpMs(token)).toBe(exp * 1000);
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtExpMs("not-a-jwt")).toBeNull();
  });
});
