import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LooksBoard } from "@/components/expert/LooksBoard";
import { ShortlistProvider } from "@/components/shortlist/ShortlistProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import type {
  ProductFacts,
  VerifiedBoardCategory,
  VerifiedBoardItem,
  VerifiedComposition,
} from "@/lib/agent/types";

const emptyRating = { value: null, scaleMin: null, scaleMax: null, count: null };

function facts(): ProductFacts {
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
    variants: [],
    seller: null,
    priceRange: { minMinor: null, maxMinor: null, currency: "INR" },
    inStockVariants: 0,
    totalVariants: 0,
  };
}

function item(id: string, title: string, priceMinor: number): VerifiedBoardItem {
  return {
    productId: id,
    title,
    imageUrl: null,
    priceMinor,
    currency: "INR",
    merchant: "Acme",
    productUrl: null,
    insight: "",
    tradeoff: null,
    isPick: false,
    source: "mock",
    facts: facts(),
  };
}

function renderBoard(compositions: VerifiedComposition[]) {
  const a = item("a", "CeraVe Foaming Cleanser", 116157);
  const b = item("b", "Sofie Pavitt Gel Moisturizer", 120000);
  const c = item("c", "Cetaphil Gentle Cleanser", 90000);
  const boardIndex = new Map<string, VerifiedBoardItem>([
    ["a", a],
    ["b", b],
    ["c", c],
  ]);
  const board: VerifiedBoardCategory[] = [
    { name: "Cleanser", items: [a, c] },
    { name: "Moisturizer", items: [b] },
  ];
  return render(
    <ToastProvider>
      <ShortlistProvider>
        <LooksBoard compositions={compositions} boardIndex={boardIndex} board={board} />
      </ShortlistProvider>
    </ToastProvider>,
  );
}

const duo: VerifiedComposition = {
  name: "The Essential Duo",
  rationale: "A non-stripping cleanser paired with a mattifying gel moisturizer.",
  productIds: ["a", "b"],
};

describe("LooksBoard", () => {
  beforeEach(() => localStorage.clear());

  it("renders a look with its members and a code-computed total", () => {
    renderBoard([duo]);
    expect(screen.getByText("The Essential Duo")).toBeInTheDocument();
    expect(screen.getByText("CeraVe Foaming Cleanser")).toBeInTheDocument();
    expect(screen.getByText("Sofie Pavitt Gel Moisturizer")).toBeInTheDocument();
    // 116157 + 120000 = 236157 minor → ₹2,361.57
    expect(screen.getByText("₹2,361.57")).toBeInTheDocument();
  });

  it("skips a composition whose members aren't on the board", () => {
    const { container } = renderBoard([
      { name: "Ghost look", rationale: "", productIds: ["missing-1", "missing-2"] },
    ]);
    expect(screen.queryByText("Ghost look")).toBeNull();
    // Nothing resolved → the whole section renders nothing.
    expect(container.querySelector("section")).toBeNull();
  });

  it("shortlists the whole look, then reflects the shortlisted state", () => {
    renderBoard([duo]);
    const btn = screen.getByRole("button", { name: /shortlist look/i });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /look shortlisted/i })).toBeInTheDocument();
  });

  it("opens the swap modal and swaps a piece for a same-aisle alternative", () => {
    renderBoard([duo]);
    fireEvent.click(screen.getByRole("button", { name: /swap a piece/i }));

    // The modal lists the current piece's aisle alternatives.
    const dialog = screen.getByRole("dialog", { name: /swap a piece/i });
    expect(dialog).toBeInTheDocument();
    const alt = screen.getByText("Cetaphil Gentle Cleanser");
    expect(alt).toBeInTheDocument();

    // Pick the alternative, apply, and the look now shows it in place of "a".
    fireEvent.click(alt);
    fireEvent.click(screen.getByRole("button", { name: /update look/i }));
    expect(screen.queryByRole("dialog", { name: /swap a piece/i })).toBeNull();
    expect(screen.getByText("Cetaphil Gentle Cleanser")).toBeInTheDocument();
    expect(screen.queryByText("CeraVe Foaming Cleanser")).toBeNull();
  });
});
