import "server-only";
import { z } from "zod";
import { aiAvailable, structuredCompletion } from "@/lib/ai/client";
import type { NormalizedProduct } from "@/lib/catalog/types";
import { logger } from "@/lib/logger";
import { truncate } from "@/lib/utils";
import type {
  BeforeAfterCopy,
  DimensionScore,
  GeoRecommendation,
  VisibilitySummary,
} from "./types";

/**
 * Evidence-linked GEO recommendations plus a suggested before/after copy
 * preview. Nothing here modifies the merchant's listing, and no
 * recommendation claims a guaranteed ranking outcome.
 */

export function deriveRecommendations(
  product: NormalizedProduct,
  dimensions: DimensionScore[],
  visibility: VisibilitySummary | null,
): GeoRecommendation[] {
  const recs: GeoRecommendation[] = [];
  const categoryFor: Record<string, string> = {
    naming: "Product title & description",
    attributes: "Attributes & variants",
    offer: "Price & availability",
    media: "Images & alt text",
    trust: "Seller policies & trust",
    visibility: "Use-case language",
  };

  for (const dim of dimensions) {
    for (const f of dim.findings.filter((x) => !x.passed)) {
      recs.push({
        category: categoryFor[dim.key] ?? dim.label,
        issue: f.check,
        evidence: f.evidence,
        why: whyFor(dim.key, f.check),
        suggestion: suggestionFor(dim.key, f.check, product),
        priority: f.maxPoints >= 5 ? "high" : f.maxPoints >= 3 ? "medium" : "low",
        confidence: "medium",
      });
    }
  }

  if (visibility && visibility.notObservedCount > 0) {
    const missed = visibility.tests
      .filter((t) => t.status === "not_observed")
      .slice(0, 3)
      .map((t) => `"${t.prompt}"`)
      .join(", ");
    recs.push({
      category: "Recipient & occasion language",
      issue: "Product was not observed for several realistic shopper prompts",
      evidence: `Not observed in the first ${20} results for: ${missed}`,
      why: "Agents retrieve products whose listings express the shopper's intent; missing recipient/occasion/use-case language gives them less to match on.",
      suggestion:
        "Weave natural recipient, occasion, and problem-to-solve phrases from the missed prompts into the title, description, or FAQ (without keyword stuffing).",
      priority: "high",
      confidence: "medium",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 10);
}

function whyFor(dimKey: string, check: string): string {
  const map: Record<string, string> = {
    "Title states what the product is":
      "A literal title gives agents explicit product-type language to match against shopper queries.",
    "Title is descriptive (4+ words)":
      "Very short titles carry little intent-matching signal for retrieval.",
    "Description is specific (100+ characters)":
      "Specific descriptions supply the attributes and use cases agents quote when recommending.",
    "Use cases or occasions are described":
      "Shoppers ask agents by occasion and recipient; listings without that language are harder to surface.",
    "Categories present in catalog data":
      "Taxonomy narrows retrieval and disambiguates the product type for agents.",
    "Alt text present on most images":
      "Alt text is machine-readable visual evidence agents can use to describe the product.",
    "Policy links present":
      "Return/shipping policies are trust evidence agents surface before a handoff.",
  };
  return (
    map[check] ??
    (dimKey === "offer"
      ? "Agents avoid recommending offers they cannot price, confirm, or hand off to checkout."
      : "More complete catalog signals make the product easier for agents to understand and recommend.")
  );
}

function suggestionFor(
  dimKey: string,
  check: string,
  product: NormalizedProduct,
): string {
  const type =
    product.categories[0]?.value.split(">").pop()?.trim() ?? "product type";
  const map: Record<string, string> = {
    "Title states what the product is": `Rename to a literal pattern: "<What it is> — <key attribute>, <size/quantity>" (e.g. include "${type}").`,
    "Title is descriptive (4+ words)":
      "Extend the title with material, size, or use-case qualifiers shoppers actually search.",
    "Description is specific (100+ characters)":
      "Describe what it is, what it's made of, who it suits, and when to gift it in the first two sentences.",
    "Use cases or occasions are described":
      "Add one sentence covering occasions (housewarming, birthday) and recipients it suits.",
    "Categories present in catalog data":
      "Assign a Shopify standard product taxonomy category in the admin.",
    "Default selection is available":
      "Make the default variant one that is in stock, or reorder variants so an available option loads first.",
    "Variant titles are descriptive":
      "Replace 'Default' variant titles with the actual option value (e.g. 'Sand / 500 ml').",
    "Alt text present on most images":
      "Add alt text that literally describes each image (product, angle, context).",
    "Multiple angles (3+ images)":
      "Add lifestyle and detail shots — agents and shoppers both use them as evidence.",
    "Rating present":
      "Enable product reviews; even a handful of ratings adds trust evidence to the catalog record.",
    "Policy links present":
      "Publish refund and shipping policies in Shopify so they attach to the offer.",
    "Checkout handoff URL present":
      "Ensure the product is published to the sales channel that exposes checkout links to agents.",
  };
  return (
    map[check] ??
    "Fill the missing field in Shopify admin so the catalog record carries this signal."
  );
}

const CopySchema = z.object({
  afterTitle: z.string().min(8),
  afterDescription: z.string().min(60),
});

export function heuristicBeforeAfter(
  product: NormalizedProduct,
): BeforeAfterCopy {
  const type =
    product.categories[0]?.value.split(">").pop()?.trim() ??
    "— add the product type";
  const feature = product.metadata.topFeatures[0] ?? "key feature";
  return {
    beforeTitle: product.title,
    afterTitle: `${product.title.replace(/\s*—.*$/, "")} — ${type}, ${feature}`.slice(0, 90),
    beforeDescription: truncate(product.description || "(no description returned)", 300),
    afterDescription: `State literally what it is (${type}), the material or size, who it suits, and one occasion it fits. Lead with facts an agent can quote; close with care or usage notes.`,
  };
}

export async function suggestBeforeAfter(
  product: NormalizedProduct,
  missedPrompts: string[],
): Promise<{ copy: BeforeAfterCopy; aiMode: "ai" | "heuristic" }> {
  if (!aiAvailable()) {
    return { copy: heuristicBeforeAfter(product), aiMode: "heuristic" };
  }
  try {
    const result = await structuredCompletion(
      "You improve e-commerce listings for clarity to AI shopping agents. Never invent product facts (materials, dimensions, certifications) that are not in the provided data. Return only JSON.",
      `Current listing (the only source of truth about this product):
Title: ${product.title}
Description: ${product.description || "(empty)"}
Categories: ${product.categories.map((c) => c.value).join("; ") || "(none)"}
Known features: ${product.metadata.topFeatures.join("; ") || "(none)"}
Options: ${product.options.map((o) => `${o.name}: ${o.values.map((v) => v.label).join("/")}`).join("; ") || "(none)"}

Shopper prompts where the product was NOT observed in test searches:
${missedPrompts.slice(0, 5).map((p) => `- ${p}`).join("\n") || "- (none)"}

Rewrite the title and description to be literal, specific, and naturally aligned with those shopper intents. Do not add facts not present above. Return JSON: { "afterTitle": "...", "afterDescription": "..." } (description 2-4 sentences).`,
      CopySchema,
      { maxTokens: 700 },
    );
    return {
      copy: {
        beforeTitle: product.title,
        afterTitle: result.afterTitle,
        beforeDescription: truncate(product.description || "(no description returned)", 300),
        afterDescription: result.afterDescription,
      },
      aiMode: "ai",
    };
  } catch (err) {
    logger.warn("before/after copy via Claude failed; using heuristic", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { copy: heuristicBeforeAfter(product), aiMode: "heuristic" };
  }
}
