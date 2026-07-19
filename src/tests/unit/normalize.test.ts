import { describe, expect, it } from "vitest";
import {
  extractNotFound,
  normalizeCatalogProduct,
  normalizeMessages,
} from "@/lib/catalog/normalize";
import { RawProductSchema } from "@/lib/catalog/schemas";

describe("normalizeCatalogProduct", () => {
  it("normalizes the documented UCP product shape", () => {
    const raw = RawProductSchema.parse({
      id: "gid://shopify/p/abc123",
      title: "Professional Chef Knife Set",
      description: { plain: "Complete professional knife collection." },
      price_range: {
        min: { amount: 29900, currency: "USD" },
        max: { amount: 29900, currency: "USD" },
      },
      media: [{ url: "https://cdn.example.com/img.jpg", alt: "Knife set" }],
      options: [{ name: "Size", values: [{ label: "12-piece", available: true, exists: true }] }],
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "12-piece Set",
          price: { amount: 29900, currency: "USD" },
          availability: { available: true, status: "in_stock" },
          checkout_url: "https://merchant.example.com/cart/1",
          options: [{ name: "Size", label: "12-piece" }],
        },
      ],
      rating: { value: 4.5, count: 120 },
    });
    const p = normalizeCatalogProduct(raw);
    expect(p.id).toBe("gid://shopify/p/abc123");
    expect(p.description).toBe("Complete professional knife collection.");
    expect(p.priceRange).toEqual({ minMinor: 29900, maxMinor: 29900, currency: "USD" });
    expect(p.images[0]).toEqual({ url: "https://cdn.example.com/img.jpg", altText: "Knife set" });
    expect(p.variants[0].available).toBe(true);
    expect(p.variants[0].checkoutUrl).toBe("https://merchant.example.com/cart/1");
    expect(p.variants[0].options).toEqual([{ name: "Size", label: "12-piece" }]);
    expect(p.rating).toEqual({ value: 4.5, scaleMax: 5, count: 120 });
  });

  it("converts HTML descriptions to plain text (no markup survives)", () => {
    const raw = RawProductSchema.parse({
      id: "x",
      description: { html: "<p>Hello <b>world</b></p><script>alert(1)</script>" },
    });
    const p = normalizeCatalogProduct(raw);
    expect(p.description).toBe("Hello world");
    expect(p.description).not.toContain("<");
  });

  it("tolerates missing optional fields", () => {
    const p = normalizeCatalogProduct(RawProductSchema.parse({ id: 42 }));
    expect(p.id).toBe("42");
    expect(p.title).toBe("");
    expect(p.variants).toEqual([]);
    expect(p.priceRange.currency).toBeNull();
    expect(p.rating.value).toBeNull();
  });

  it("falls back to variant currency when price_range is absent", () => {
    const raw = RawProductSchema.parse({
      id: "x",
      variants: [{ id: "v1", price: { amount: 500, currency: "EUR" } }],
    });
    expect(normalizeCatalogProduct(raw).priceRange.currency).toBe("EUR");
  });
});

describe("messages / not_found", () => {
  it("normalizes documented message shape and extracts not_found entries", () => {
    const messages = normalizeMessages([
      {
        type: "error",
        code: "not_found",
        path: "$.products[0]",
        content: "Identifier not resolved: gid://shopify/p/nope",
      },
      { type: "warning", code: "delayed_fulfillment", content: "Backordered" },
    ]);
    expect(messages).toHaveLength(2);
    const notFound = extractNotFound(messages);
    expect(notFound).toHaveLength(1);
    expect(notFound[0]).toContain("nope");
  });
});
