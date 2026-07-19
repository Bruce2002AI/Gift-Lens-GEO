import type { NormalizedVariant } from "./types";

/**
 * Pick the variant that best satisfies an option selection, relaxing the
 * lowest-priority options first (mirrors the documented get_product
 * `preferences` semantics: earlier option names are preserved longer).
 */
export function selectVariantWithRelaxation(
  variants: NormalizedVariant[],
  selected: Record<string, string> | null | undefined,
  preferenceOrder: string[] | null | undefined,
): NormalizedVariant | null {
  if (variants.length === 0) return null;
  if (!selected || Object.keys(selected).length === 0) {
    return variants.find((v) => v.available) ?? variants[0];
  }
  const entries = Object.entries(selected);
  const order =
    preferenceOrder && preferenceOrder.length > 0
      ? preferenceOrder
      : entries.map(([name]) => name);
  for (let keepCount = entries.length; keepCount >= 0; keepCount--) {
    const keepNames = order.slice(0, keepCount);
    const keep = entries.filter(([name]) => keepNames.includes(name));
    const candidate = variants.find(
      (v) =>
        v.available &&
        keep.every(([name, label]) =>
          v.options.some((o) => o.name === name && o.label === label),
        ),
    );
    if (candidate) return candidate;
  }
  return variants.find((v) => v.available) ?? variants[0];
}

/** Was the returned selection relaxed relative to what the shopper asked for? */
export function selectionWasRelaxed(
  variant: NormalizedVariant | null,
  selected: Record<string, string> | null | undefined,
): string[] {
  if (!variant || !selected) return [];
  return Object.entries(selected)
    .filter(
      ([name, label]) =>
        !variant.options.some((o) => o.name === name && o.label === label),
    )
    .map(([name]) => name);
}
