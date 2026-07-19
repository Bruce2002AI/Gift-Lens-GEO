import "server-only";
import { MODE_META } from "../meta";
import { genericStrategies, makePicksMode } from "./_shared";

/**
 * SwapLens — better-fitting alternative finder. Picks mode: the shopper already
 * has a product in mind and wants a cheaper / more sustainable / different-color
 * / another-seller / similar-aesthetic alternative. A pasted product URL is
 * resolved by the engine and passed as a similarity seed.
 */
const swap = makePicksMode({
  meta: MODE_META.swap,
  noun: "alternative",
  extractGuidance: `The shopper wants an ALTERNATIVE to a product they already have in mind (cheaper, more sustainable, different color, another seller, better rated, or a similar look). Put the product type + desired improvements into interests and softPreferences; put firm requirements (size, ships-to, max price) into hardConstraints and budget.`,
  strategies: (intent) => genericStrategies(intent, "alternative"),
});

export default swap;
