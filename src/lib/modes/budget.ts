/**
 * Budget allocation across plan components, in integer minor units. Keeping the
 * math in minor units avoids float drift; the rounding remainder is assigned to
 * the highest-weighted component so the slices sum EXACTLY to the total.
 */

export function allocateBudget(
  totalMinor: number | null,
  weights: number[],
): Array<number | null> {
  if (totalMinor == null || !Number.isFinite(totalMinor) || totalMinor <= 0) {
    return weights.map(() => null);
  }
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // No usable weights → split evenly.
    const even = Math.floor(totalMinor / Math.max(1, weights.length));
    const slices = weights.map(() => even);
    slices[slices.length - 1] += totalMinor - even * weights.length;
    return slices;
  }
  const raw = safe.map((w) => Math.floor((totalMinor * w) / sum));
  const allocated = raw.reduce((a, b) => a + b, 0);
  let remainder = totalMinor - allocated;
  // Give the remainder to the largest-weight component (deterministic tie-break
  // by earliest index).
  if (remainder > 0) {
    let maxIdx = 0;
    for (let i = 1; i < safe.length; i++) {
      if (safe[i] > safe[maxIdx]) maxIdx = i;
    }
    raw[maxIdx] += remainder;
    remainder = 0;
  }
  return raw;
}

/** Sum component prices in minor units; null if any input is null (incomparable). */
export function sumMinor(values: Array<number | null>): number | null {
  let total = 0;
  for (const v of values) {
    if (v == null) return null;
    total += v;
  }
  return total;
}
