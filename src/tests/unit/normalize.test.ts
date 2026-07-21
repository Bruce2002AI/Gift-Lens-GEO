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
    expect(p.images[0]).toEqual({
      url: "https://cdn.example.com/img.jpg",
      altText: "Knife set",
      type: null,
    });
    expect(p.variants[0].available).toBe(true);
    expect(p.variants[0].checkoutUrl).toBe("https://merchant.example.com/cart/1");
    expect(p.variants[0].options).toEqual([{ name: "Size", label: "12-piece" }]);
    expect(p.rating).toEqual({ value: 4.5, scaleMin: null, scaleMax: 5, count: 120 });
  });

  /**
   * Guards the full-fidelity capture: this payload mirrors a real
   * search_catalog response (see docs/ucp-field-inventory.json). Every field
   * below was previously parsed and then silently dropped by the normalizer.
   */
  it("captures every field the live catalog returns (no silent drops)", () => {
    const raw = RawProductSchema.parse({
      id: "gid://shopify/p/69GyNfKISHpuI0MuTuYKtN",
      title: "Light On Serum : Centella + Vita C",
      handle: "light-on-serum",
      description: { plain: "A lightweight vitamin C serum." },
      price_range: {
        min: { amount: 249000, currency: "INR" },
        max: { amount: 249000, currency: "INR" },
      },
      media: [
        { type: "image", url: "https://cdn.example.com/1.webp", alt_text: "Serum front" },
      ],
      rating: { value: 4.7, scale_min: 1, scale_max: 5, count: 2753 },
      metadata: {
        tech_specs:
          "Active Ingredients: 10-3% O-ethyl ascorbic acid\nProduct Form: Serum\nVolume: 30 ml",
        top_features: "Brightening\nSoothing",
        unique_selling_points: ["Non-sticky formula"],
      },
      variants: [
        {
          id: "gid://shopify/ProductVariant/42465032601765",
          title: "30ml",
          description: { plain: "Variant-specific copy." },
          url: "https://merchant.example.com/p/1",
          price: { amount: 249000, currency: "INR" },
          availability: { available: true },
          rating: { value: 4.9, scale_min: 1, scale_max: 5, count: 1144 },
          condition: ["new"],
          eligible: { native_checkout: true },
          seller: {
            id: "gid://shopify/Shop/55841357989",
            name: "Beauty of Joseon",
            url: "https://beautyofjoseon.com",
            domain: "boj.myshopify.com",
            links: [
              { type: "refund_policy", url: "https://example.com/refund" },
              { type: "privacy_policy", url: "https://example.com/privacy" },
            ],
          },
        },
      ],
    });
    const p = normalizeCatalogProduct(raw);

    expect(p.handle).toBe("light-on-serum");
    expect(p.images[0].type).toBe("image");
    expect(p.rating.scaleMin).toBe(1);

    // tech_specs becomes a real label/value table.
    expect(p.metadata.specs).toEqual([
      { label: "Active Ingredients", value: "10-3% O-ethyl ascorbic acid" },
      { label: "Product Form", value: "Serum" },
      { label: "Volume", value: "30 ml" },
    ]);

    // Variant-level detail that used to be discarded.
    const v = p.variants[0];
    expect(v.description).toBe("Variant-specific copy.");
    expect(v.rating).toEqual({ value: 4.9, scaleMin: 1, scaleMax: 5, count: 1144 });
    expect(v.condition).toEqual(["new"]);
    expect(v.nativeCheckoutEligible).toBe(true);

    // Seller + policy links surface at product level, not just per variant.
    expect(p.seller?.name).toBe("Beauty of Joseon");
    expect(p.seller?.policyLinks).toEqual([
      { type: "refund_policy", url: "https://example.com/refund" },
      { type: "privacy_policy", url: "https://example.com/privacy" },
    ]);
  });

  it("parses spec lines with colons in the value and keeps colon-less lines", () => {
    const raw = RawProductSchema.parse({
      id: "p",
      metadata: { tech_specs: "Brew ratio: 1:16\nHand wash only\nEmpty:" },
    });
    const p = normalizeCatalogProduct(raw);
    expect(p.metadata.specs).toEqual([
      { label: "Brew ratio", value: "1:16" },
      { label: "Hand wash only", value: null },
      { label: "Empty:", value: null },
    ]);
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
