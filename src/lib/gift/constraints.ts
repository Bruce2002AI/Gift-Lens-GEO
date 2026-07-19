import type { NormalizedProduct } from "@/lib/catalog/types";
import type { BaseIntent } from "@/lib/modes/types";
import { phraseInText } from "@/lib/utils";

/**
 * Hard constraint engine. Catalog filters are the first line of enforcement;
 * this re-checks returned data. A semantically attractive product can never
 * override a hard constraint.
 */

export interface ConstraintCheck {
  pass: boolean;
  violations: string[];
}

/**
 * Filler words that ride along on conversational exclusions ("no candles
 * please") but should not be part of the matched term.
 */
const TRAILING_FILLER = new Set([
  "please", "pls", "thanks", "thank", "you", "though", "too", "also",
  "really", "at", "all", "if", "possible", "okay", "ok", "kindly",
]);

function trimFiller(term: string): string {
  const words = term.split(/\s+/).filter(Boolean);
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/** Terms the shopper explicitly excluded ("exclude: mugs", dislikes, "no candles"). */
export function exclusionTerms(intent: BaseIntent): string[] {
  const fromHard = intent.hardConstraints
    .map((c) => {
      const m = c.match(/^(?:exclude|no|avoid|not?)[:\s]+(.+)$/i);
      return m ? m[1].trim() : null;
    })
    .filter((t): t is string => Boolean(t));
  return [...new Set([...fromHard, ...intent.exclusions])]
    .map((t) => trimFiller(t.toLowerCase().trim()))
    .filter((t) => t.length > 2);
}

/**
 * The searchable surface for exclusions and care-flag scope fences. Must cover
 * every field the evidence layer treats as quotable — otherwise a fenced
 * ingredient (e.g. retinol during pregnancy) could sit in techSpecs, pass the
 * constraint check, and still be quoted as a verified claim.
 */
function productText(p: NormalizedProduct): string {
  return [
    p.title,
    p.description,
    p.categories.map((c) => c.value).join(" "),
    p.metadata.techSpecs.join(" "),
    p.metadata.topFeatures.join(" "),
    p.metadata.uniqueSellingPoints.join(" "),
    p.options.map((o) => `${o.name} ${o.values.map((v) => v.label).join(" ")}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export interface ConstraintOptions {
  /**
   * True when the product came from a search where the budget cap was passed
   * as a catalog price filter. The Global Catalog applies that cap with its
   * own currency conversion, so an offer priced in another currency has
   * already been budget-screened server-side; GiftLens flags the currency in
   * the logistics message instead of rejecting (it never invents FX rates).
   */
  catalogBudgetFilterApplied?: boolean;
}

export function checkHardConstraints(
  product: NormalizedProduct,
  intent: BaseIntent,
  options: ConstraintOptions = {},
): ConstraintCheck {
  const violations: string[] = [];

  // Budget max: the cheapest buyable price must fit. Minor-unit amounts are
  // only comparable within the same currency — the live catalog can return
  // offers priced in other currencies, and GiftLens never invents FX rates.
  const cheapest =
    product.priceRange.minMinor ??
    product.variants
      .filter((v) => v.priceMinor != null)
      .reduce<number | null>(
        (min, v) => (min === null ? v.priceMinor : Math.min(min, v.priceMinor!)),
        null,
      );
  const productCurrency = (
    product.priceRange.currency ??
    product.variants.find((v) => v.currency)?.currency ??
    null
  )?.toUpperCase();
  const currencyComparable =
    productCurrency == null ||
    productCurrency === intent.budget.currency.toUpperCase();
  if (intent.budget.maxMinor != null) {
    if (cheapest == null) {
      violations.push("Price data missing — cannot verify budget.");
    } else if (!currencyComparable) {
      if (!options.catalogBudgetFilterApplied) {
        violations.push(
          `Price returned in ${productCurrency}, budget stated in ${intent.budget.currency} — budget cannot be verified without a conversion.`,
        );
      }
      // else: the catalog already applied the cap with its own conversion;
      // logisticsMessage surfaces the currency difference to the shopper.
    } else if (cheapest > intent.budget.maxMinor) {
      violations.push("Over the maximum budget.");
    }
  }
  if (intent.budget.minMinor != null && cheapest != null && currencyComparable) {
    const dearest = product.priceRange.maxMinor ?? cheapest;
    if (dearest < intent.budget.minMinor) {
      violations.push("Below the required minimum budget.");
    }
  }

  // Availability: at least one variant must be available (or availability unknown but not all false).
  const anyAvailable = product.variants.some((v) => v.available === true);
  const allUnavailable =
    product.variants.length > 0 &&
    product.variants.every((v) => v.available === false);
  if (allUnavailable || (product.variants.length > 0 && !anyAvailable && product.variants.some((v) => v.available === false))) {
    violations.push("No available variant.");
  }

  // Physical vs digital.
  if (intent.physicality === "digital") {
    const anyDigital = product.variants.some((v) => v.requiresShipping === false);
    if (!anyDigital) violations.push("Shopper asked for a digital product.");
  }
  if (intent.physicality === "physical") {
    const allDigital =
      product.variants.length > 0 &&
      product.variants.every((v) => v.requiresShipping === false);
    if (allDigital) violations.push("Shopper asked for a physical product.");
  }

  // Explicit exclusions — whole-word, plural-folded match so "no candles"
  // catches a "candle" listing (and "no glass" catches "glasses") without
  // false-matching inside unrelated words ("cat" must not match "delicate").
  const text = productText(product);
  for (const term of exclusionTerms(intent)) {
    if (phraseInText(text, term, { stemPlurals: true })) {
      violations.push(`Matches excluded term "${term}".`);
    }
  }

  return { pass: violations.length === 0, violations };
}

/**
 * Deadline is a preference, not a promise. The Catalog confirms shipping
 * eligibility but not delivery timing.
 */
export function logisticsMessage(
  product: NormalizedProduct,
  intent: BaseIntent,
): string {
  const parts: string[] = [];
  const available = product.variants.some((v) => v.available === true);
  parts.push(available ? "In stock per catalog data" : "Availability unconfirmed");
  if (intent.destination.country) {
    parts.push(`searched with ships-to ${intent.destination.country}`);
  }
  const productCurrency = (
    product.priceRange.currency ??
    product.variants.find((v) => v.currency)?.currency ??
    null
  )?.toUpperCase();
  if (
    intent.budget.maxMinor != null &&
    productCurrency &&
    productCurrency !== intent.budget.currency.toUpperCase()
  ) {
    parts.push(
      `price shown in ${productCurrency} — your ${intent.budget.currency} budget cap was applied by the catalog's own conversion, verify the final price at checkout`,
    );
  }
  if (intent.deadline) {
    parts.push("delivery date not verified — the catalog confirms shipping eligibility, not arrival timing");
  }
  return parts.join("; ") + ".";
}
