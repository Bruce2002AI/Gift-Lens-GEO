import { describe, expect, it } from "vitest";
import {
  currencyFractionDigits,
  formatMinor,
  formatMinorRange,
  isValidCurrencyCode,
  majorToMinor,
  minorToMajor,
} from "@/lib/gift/currency";

describe("majorToMinor", () => {
  it("converts ₹4,000 INR to 400000 minor units", () => {
    expect(majorToMinor(4000, "INR")).toBe(400000);
  });

  it("handles zero-fraction currencies (JPY)", () => {
    expect(majorToMinor(4000, "JPY")).toBe(4000);
  });

  it("handles three-fraction currencies (BHD)", () => {
    expect(majorToMinor(10, "BHD")).toBe(10000);
  });

  it("rounds fractional major amounts", () => {
    expect(majorToMinor(19.99, "USD")).toBe(1999);
    expect(majorToMinor(0.1 + 0.2, "USD")).toBe(30);
  });

  it("returns null for null, negative, and non-finite input", () => {
    expect(majorToMinor(null, "INR")).toBeNull();
    expect(majorToMinor(undefined, "INR")).toBeNull();
    expect(majorToMinor(-5, "INR")).toBeNull();
    expect(majorToMinor(Number.NaN, "INR")).toBeNull();
    expect(majorToMinor(Number.POSITIVE_INFINITY, "INR")).toBeNull();
  });
});

describe("minorToMajor", () => {
  it("round-trips with majorToMinor", () => {
    expect(minorToMajor(400000, "INR")).toBe(4000);
    expect(minorToMajor(4000, "JPY")).toBe(4000);
    expect(minorToMajor(10000, "BHD")).toBe(10);
  });
});

describe("currencyFractionDigits", () => {
  it("knows common exponents", () => {
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("INR")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
  });
});

describe("formatMinor / formatMinorRange", () => {
  it("formats INR minor units for display", () => {
    const formatted = formatMinor(400000, "INR");
    expect(formatted).toContain("4,000");
  });

  it("returns a safe placeholder for missing data", () => {
    expect(formatMinor(null, "INR")).toBe("Price unavailable");
    expect(formatMinor(1000, null)).toBe("Price unavailable");
  });

  it("collapses equal min/max into one price", () => {
    const single = formatMinorRange(1999, 1999, "USD");
    expect(single).not.toContain("–");
  });

  it("renders a range when min differs from max", () => {
    const range = formatMinorRange(1000, 2000, "USD");
    expect(range).toContain("–");
  });
});

describe("isValidCurrencyCode", () => {
  it("accepts real ISO codes and rejects junk", () => {
    expect(isValidCurrencyCode("INR")).toBe(true);
    expect(isValidCurrencyCode("usd")).toBe(true);
    expect(isValidCurrencyCode("XX")).toBe(false);
    expect(isValidCurrencyCode("12$")).toBe(false);
  });
});
