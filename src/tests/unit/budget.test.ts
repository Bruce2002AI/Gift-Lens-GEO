import { describe, expect, it } from "vitest";
import { allocateBudget, sumMinor } from "@/lib/modes/budget";

const total = (xs: Array<number | null>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

describe("allocateBudget", () => {
  it("splits by weight and sums exactly to the total", () => {
    const slices = allocateBudget(1000, [1, 1, 2]);
    expect(slices).toEqual([250, 250, 500]);
    expect(total(slices)).toBe(1000);
  });

  it("assigns the rounding remainder to the largest-weight component (exact sum)", () => {
    const slices = allocateBudget(100, [1, 1, 1]);
    expect(total(slices)).toBe(100);
    // First component (a max-weight, earliest index) takes the +1 remainder.
    expect(slices[0]).toBe(34);
  });

  it("returns nulls when there is no usable total", () => {
    expect(allocateBudget(null, [1, 2])).toEqual([null, null]);
    expect(allocateBudget(0, [1, 2])).toEqual([null, null]);
  });

  it("splits evenly and exactly when weights are unusable", () => {
    const slices = allocateBudget(91, [0, 0, 0]);
    expect(total(slices)).toBe(91);
  });
});

describe("sumMinor", () => {
  it("sums when all present", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
  });
  it("returns null if any is null (incomparable currency)", () => {
    expect(sumMinor([1, null, 3])).toBeNull();
  });
});
