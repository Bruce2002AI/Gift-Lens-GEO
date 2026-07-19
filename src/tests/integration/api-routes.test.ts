import { describe, expect, it } from "vitest";
import { GET as healthGet } from "@/app/api/health/route";
import { POST as conciergePost } from "@/app/api/gift/concierge/route";
import { POST as lookupPost } from "@/app/api/catalog/lookup/route";
import { POST as getProductPost } from "@/app/api/catalog/get-product/route";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/health", () => {
  it("reports catalog and AI configuration", async () => {
    const res = await healthGet();
    const json = await res.json();
    expect(json.app).toBe("ShopLens");
    expect(json.catalog.mode).toBe("mock");
    expect(json.ai.configured).toBe(false);
    expect(json.ai.fallback).toMatch(/heuristic/i);
  });
});

describe("POST /api/gift/concierge", () => {
  it("returns a spotlight trio plus more matches for the demo conversation", async () => {
    const res = await conciergePost(
      jsonRequest("http://localhost/api/gift/concierge", {
        conversation: [
          {
            role: "user",
            content:
              "Housewarming gift for my sister in Bengaluru. She loves coffee and Scandinavian design, hates clutter, and my budget is ₹4,000.",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.stage).toBe("recommendations");
    expect(json.recommendations.length).toBeGreaterThan(3);
    expect(
      new Set(
        json.recommendations
          .slice(0, 3)
          .map((r: { role: string }) => r.role),
      ),
    ).toEqual(new Set(["best_match", "delight_pick", "safe_pick"]));
    expect(json.source).toBe("mock");
    expect(json.trace.length).toBeGreaterThan(0);
  });

  it("rejects invalid bodies with 400", async () => {
    const res = await conciergePost(
      jsonRequest("http://localhost/api/gift/concierge", { conversation: [] }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects oversized images with 413", async () => {
    const res = await conciergePost(
      jsonRequest("http://localhost/api/gift/concierge", {
        conversation: [{ role: "user", content: "gift" }],
        image: { mediaType: "image/png", base64: "A".repeat(7_100_000) },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects unsupported image formats", async () => {
    const res = await conciergePost(
      jsonRequest("http://localhost/api/gift/concierge", {
        conversation: [{ role: "user", content: "gift" }],
        image: { mediaType: "image/gif", base64: "aGVsbG8gd29ybGQhIQ==" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/catalog/lookup", () => {
  it("resolves known ids and reports not_found for unknown ones", async () => {
    const res = await lookupPost(
      jsonRequest("http://localhost/api/catalog/lookup", {
        ids: ["mock:nordhem-pourover-set", "mock:does-not-exist"],
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.products).toHaveLength(1);
    expect(json.notFound).toContain("mock:does-not-exist");
    expect(json.source).toBe("mock");
  });

  it("validates the ids array", async () => {
    const res = await lookupPost(
      jsonRequest("http://localhost/api/catalog/lookup", { ids: [] }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/catalog/get-product", () => {
  it("returns the product with a relaxed variant selection", async () => {
    const res = await getProductPost(
      jsonRequest("http://localhost/api/catalog/get-product", {
        productId: "mock:nordhem-pourover-set",
        selected: { Color: "Charcoal" },
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.product.id).toBe("mock:nordhem-pourover-set");
    expect(json.selectedVariant.options).toEqual([
      { name: "Color", label: "Charcoal" },
    ]);
  });
});
