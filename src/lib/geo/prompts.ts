import "server-only";
import { z } from "zod";
import { aiAvailable, structuredCompletion } from "@/lib/ai/client";
import type { NormalizedProduct } from "@/lib/catalog/types";
import { logger } from "@/lib/logger";
import type { GeoAuditInput } from "./types";

/**
 * Ten realistic customer-intent prompts covering the standard archetypes:
 * literal, recipient, occasion, problem, style, budget, destination,
 * not-the-obvious-item, safe-choice, premium/unusual.
 */

const PromptSuiteSchema = z.object({
  prompts: z.array(z.string().min(4)).length(10),
});

export function heuristicPrompts(
  product: NormalizedProduct,
  input: GeoAuditInput,
): string[] {
  const words = product.title
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const noun = words.slice(-1)[0]?.toLowerCase() || "gift";
  const theme =
    product.categories[0]?.value.split(">").pop()?.trim().toLowerCase() ||
    words[0]?.toLowerCase() ||
    "gift";
  const audience = input.audience || "a friend";
  const occasion = input.occasion || "housewarming";
  const budget = input.budgetMax
    ? `under ${input.budgetMax} ${input.currency}`
    : "on a mid-range budget";
  return [
    `${theme} ${noun}`.trim(),
    `gift for ${audience} who loves ${theme}`,
    `${occasion} present ideas`,
    `practical gift that does not create clutter`,
    `minimalist ${theme} for a small home`,
    `${theme} gift ${budget}`,
    `gift that ships to ${input.country}`,
    `unique ${theme} gift that is not the obvious choice`,
    `safe ${occasion} gift for someone I do not know well`,
    `premium-looking ${theme} present ${budget}`,
  ];
}

const PROMPT_GEN = (product: NormalizedProduct, input: GeoAuditInput) => `Generate 10 realistic shopper search prompts to test whether this product is discoverable by AI shopping agents.

Product being audited (from catalog data):
- Title: ${product.title}
- Description: ${product.description.slice(0, 300)}
- Categories: ${product.categories.map((c) => c.value).join("; ") || "none returned"}
- Price range present: ${product.priceRange.minMinor != null}
Audit context: country=${input.country}, currency=${input.currency}, audience=${input.audience ?? "unspecified"}, occasion=${input.occasion ?? "unspecified"}, budget max=${input.budgetMax ?? "unspecified"}.

The 10 prompts must cover, in order:
1. Literal product query
2. Recipient query
3. Occasion query
4. Problem-to-solve query
5. Style query
6. Budget query
7. Destination query
8. "Not the obvious item" query
9. Safe-choice query
10. Premium or unusual query

Write them the way real shoppers type (4-12 words each). Return JSON: { "prompts": ["...", ...] } with exactly 10 strings.`;

export async function generatePrompts(
  product: NormalizedProduct,
  input: GeoAuditInput,
): Promise<{ prompts: string[]; aiMode: "ai" | "heuristic" }> {
  if (input.customPrompts && input.customPrompts.length > 0) {
    return {
      prompts: input.customPrompts.slice(0, 12),
      aiMode: "heuristic",
    };
  }
  if (!aiAvailable()) {
    return { prompts: heuristicPrompts(product, input), aiMode: "heuristic" };
  }
  try {
    const suite = await structuredCompletion(
      "You design realistic e-commerce search prompts. Return only JSON.",
      PROMPT_GEN(product, input),
      PromptSuiteSchema,
      { maxTokens: 800 },
    );
    return { prompts: suite.prompts, aiMode: "ai" };
  } catch (err) {
    logger.warn("prompt generation via Claude failed; using templates", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { prompts: heuristicPrompts(product, input), aiMode: "heuristic" };
  }
}
