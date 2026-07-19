import { describe, expect, it } from "vitest";
import { heuristicIntent } from "@/lib/ai/intent";

const DEMO =
  "Housewarming gift for my sister in Bengaluru. She loves coffee and Scandinavian design, hates clutter, and my budget is ₹4,000.";

describe("heuristicIntent (deterministic fallback)", () => {
  it("extracts the demo query correctly", () => {
    const intent = heuristicIntent([{ role: "user", content: DEMO }]);
    expect(intent.budget.currency).toBe("INR");
    expect(intent.budget.maxMajor).toBe(4000);
    expect(intent.budget.maxMinor).toBe(400000);
    expect(intent.destination.country).toBe("IN");
    expect(intent.destination.city).toBe("Bengaluru");
    expect(intent.recipient.relationship).toBe("sister");
    expect(intent.occasion).toBe("housewarming");
    expect(intent.recipient.interests).toContain("coffee");
    expect(intent.recipient.dislikes.join(" ")).toContain("clutter");
  });

  it("form fields override extracted values", () => {
    const intent = heuristicIntent([{ role: "user", content: DEMO }], {
      budgetMax: 2500,
      currency: "USD",
      country: "US",
      occasion: "birthday",
      relationship: "friend",
    });
    expect(intent.budget.maxMajor).toBe(2500);
    expect(intent.budget.currency).toBe("USD");
    expect(intent.budget.maxMinor).toBe(250000);
    expect(intent.destination.country).toBe("US");
    expect(intent.occasion).toBe("birthday");
    expect(intent.recipient.relationship).toBe("friend");
  });

  it("understands 'under $50' style budgets", () => {
    const intent = heuristicIntent([
      { role: "user", content: "Birthday gift for a friend who loves hiking, under $50" },
    ]);
    expect(intent.budget.currency).toBe("USD");
    expect(intent.budget.maxMajor).toBe(50);
    expect(intent.recipient.interests).toContain("hiking");
  });

  it("understands 'between 2000 and 4000' ranges", () => {
    const intent = heuristicIntent([
      { role: "user", content: "Something between ₹2,000 and ₹4,000 for my mother" },
    ]);
    expect(intent.budget.minMajor).toBe(2000);
    expect(intent.budget.maxMajor).toBe(4000);
  });

  it("never invents a clarification question", () => {
    const intent = heuristicIntent([{ role: "user", content: "a gift" }]);
    expect(intent.clarificationNeeded).toBe(false);
    expect(intent.clarificationQuestion).toBeNull();
  });
});
