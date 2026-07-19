import { describe, expect, it } from "vitest";
import { findMockProduct } from "@/data/mock-products";
import {
  auditConfidence,
  computeAgentReadiness,
  scoreNaming,
  scoreVisibility,
} from "@/lib/geo/scoring";
import type { VisibilitySummary, VisibilityTest } from "@/lib/geo/types";

const strong = findMockProduct("mock:nordhem-pourover-set")!;
const weak = findMockProduct("mock:ritual-pourover")!;

function summaryWith(
  appeared: number,
  notObserved: number,
  failed: number,
): VisibilitySummary {
  const tests: VisibilityTest[] = [
    ...Array.from({ length: appeared }, (_, i): VisibilityTest => ({
      prompt: `appeared ${i}`,
      status: "appeared",
      position: i + 1,
      resultsInspected: 20,
      topCompetitor: null,
      matchType: "product",
      timestamp: new Date().toISOString(),
      warning: null,
      hardFilterRisk: null,
    })),
    ...Array.from({ length: notObserved }, (_, i): VisibilityTest => ({
      prompt: `missed ${i}`,
      status: "not_observed",
      position: null,
      resultsInspected: 20,
      topCompetitor: null,
      matchType: null,
      timestamp: new Date().toISOString(),
      warning: null,
      hardFilterRisk: null,
    })),
    ...Array.from({ length: failed }, (_, i): VisibilityTest => ({
      prompt: `failed ${i}`,
      status: "failed",
      position: null,
      resultsInspected: 0,
      topCompetitor: null,
      matchType: null,
      timestamp: new Date().toISOString(),
      warning: "timeout",
      hardFilterRisk: null,
    })),
  ];
  const attempted = appeared + notObserved;
  const positions = tests.filter((t) => t.position != null).map((t) => t.position!);
  return {
    tests,
    coverage: attempted > 0 ? appeared / attempted : 0,
    topThreeCount: positions.filter((p) => p <= 3).length,
    averagePosition: positions.length
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null,
    notObservedCount: notObserved,
    failedCount: failed,
    attemptedCount: attempted,
  };
}

describe("Agent Readiness Score", () => {
  it("scores the strong listing well above the weak one", () => {
    const strongScore = computeAgentReadiness(strong, summaryWith(6, 4, 0), "IN");
    const weakScore = computeAgentReadiness(weak, summaryWith(1, 9, 0), "IN");
    expect(strongScore.total).toBeGreaterThan(weakScore.total + 20);
    expect(strongScore.total).toBeLessThanOrEqual(100);
    expect(weakScore.total).toBeGreaterThanOrEqual(0);
  });

  it("uses the documented dimension maxima (25/20/20/15/10/10)", () => {
    const { dimensions } = computeAgentReadiness(strong, summaryWith(5, 5, 0), "IN");
    const byKey = Object.fromEntries(dimensions.map((d) => [d.key, d.max]));
    expect(byKey).toEqual({
      naming: 25,
      attributes: 20,
      offer: 20,
      media: 15,
      trust: 10,
      visibility: 10,
    });
  });

  it("penalizes the weak title for not naming a product type", () => {
    const naming = scoreNaming(weak);
    const failedTitleCheck = naming.findings.find(
      (f) => f.check === "Title states what the product is",
    );
    expect(failedTitleCheck?.passed).toBe(false);
  });
});

describe("prompt visibility scoring", () => {
  it("computes coverage × 10, excluding failed tests from the denominator", () => {
    const dim = scoreVisibility(summaryWith(4, 4, 2));
    expect(dim.score).toBe(5); // 4/8 attempted → 0.5 × 10
  });

  it("withholds the score entirely when no tests completed", () => {
    const dim = scoreVisibility(summaryWith(0, 0, 10));
    expect(dim.score).toBe(0);
    expect(dim.summary).toMatch(/withheld/i);
  });
});

describe("auditConfidence", () => {
  it("is high for a resolved product with complete data and a healthy suite", () => {
    const conf = auditConfidence(true, strong, summaryWith(8, 2, 0));
    expect(conf.level).toBe("high");
  });

  it("degrades when most visibility tests fail", () => {
    const conf = auditConfidence(true, strong, summaryWith(1, 1, 8));
    expect(conf.level).not.toBe("high");
    expect(conf.reasons.join(" ")).toMatch(/failed/i);
  });

  it("is low for an unresolved identifier", () => {
    const conf = auditConfidence(false, null, null);
    expect(conf.level).toBe("low");
  });
});
