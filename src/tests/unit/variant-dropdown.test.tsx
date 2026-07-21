import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariantSelector } from "@/components/expert/VariantSelector";
import type { ProductFacts, ProductFactsVariant } from "@/lib/agent/types";

const emptyRating = { value: null, scaleMin: null, scaleMax: null, count: null };

function variant(overrides: Partial<ProductFactsVariant> = {}): ProductFactsVariant {
  return {
    id: "v1",
    title: "Variant 1",
    sku: null,
    priceMinor: 19900,
    currency: "INR",
    available: true,
    availabilityStatus: "in_stock",
    runningLow: null,
    requiresShipping: true,
    nativeCheckoutEligible: null,
    url: null,
    imageUrl: null,
    options: [],
    condition: [],
    rating: emptyRating,
    description: "",
    isSelected: false,
    ...overrides,
  };
}

function facts(variants: ProductFactsVariant[]): ProductFacts {
  return {
    description: "",
    handle: null,
    categories: [],
    rating: emptyRating,
    specs: [],
    topFeatures: [],
    uniqueSellingPoints: [],
    images: [],
    options: [],
    variants,
    seller: null,
    priceRange: { minMinor: null, maxMinor: null, currency: "INR" },
    inStockVariants: variants.filter((v) => v.available !== false).length,
    totalVariants: variants.length,
  };
}

describe("VariantSelector — dropdown mode", () => {
  const threeVariants = facts([
    variant({ id: "v1", title: "Black / M", isSelected: true }),
    variant({ id: "v2", title: "Black / L", priceMinor: 29800 }),
    variant({ id: "v3", title: "White / M", priceMinor: 24900 }),
  ]);

  it("renders nothing for a single-variant product", () => {
    const { container } = render(
      <VariantSelector
        facts={facts([variant()])}
        selectedId="v1"
        onSelect={() => {}}
        mode="dropdown"
      />,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("portals the open listbox to document.body so the card's overflow can't clip it", () => {
    const { container } = render(
      <VariantSelector
        facts={threeVariants}
        selectedId="v1"
        onSelect={() => {}}
        mode="dropdown"
      />,
    );
    // Closed: the listbox is not mounted, and nothing lives outside the anchor.
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /black \/ m/i }));

    const listbox = screen.getByRole("listbox");
    // The popover must NOT be a descendant of the (overflow-hidden) anchor —
    // it is portaled to the body instead.
    expect(container.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
    // Fixed positioning is what lets it escape the clipping ancestor.
    expect((listbox as HTMLElement).style.position).toBe("fixed");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("selects a variant and closes when an option is clicked", () => {
    const onSelect = vi.fn();
    render(
      <VariantSelector
        facts={threeVariants}
        selectedId="v1"
        onSelect={onSelect}
        mode="dropdown"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /black \/ m/i }));
    // The clickable element is the button inside the option <li>.
    fireEvent.click(screen.getByRole("button", { name: /white \/ m/i }));
    expect(onSelect).toHaveBeenCalledWith("v3");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
