import { z } from "zod";

/** GiftIntent — the validated, structured understanding of the shopper's need. */

export const GiftStyleSchema = z.enum([
  "practical",
  "sentimental",
  "playful",
  "luxurious",
  "unique",
  "safe",
  "mixed",
]);

export const GiftIntentSchema = z.object({
  recipient: z.object({
    relationship: z.string().nullable(),
    ageBand: z.string().nullable(),
    interests: z.array(z.string()),
    dislikes: z.array(z.string()),
    personalityTraits: z.array(z.string()),
  }),
  occasion: z.string().nullable(),
  giftStyle: GiftStyleSchema.nullable(),
  budget: z.object({
    minMajor: z.number().nullable(),
    maxMajor: z.number().nullable(),
    minMinor: z.number().int().nullable(),
    maxMinor: z.number().int().nullable(),
    currency: z.string().min(3).max(3),
  }),
  destination: z.object({
    country: z.string().min(2).max(2),
    region: z.string().nullable(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
  deadline: z.string().nullable(),
  physicality: z.enum(["physical", "digital", "either"]),
  hardConstraints: z.array(z.string()),
  softPreferences: z.array(z.string()),
  searchThemes: z.array(z.string()),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type GiftIntent = z.infer<typeof GiftIntentSchema>;

/** What Claude returns before we compute minor units deterministically. */
export const RawIntentSchema = GiftIntentSchema.omit({ budget: true }).extend({
  budget: z.object({
    minMajor: z.number().nullable(),
    maxMajor: z.number().nullable(),
    currency: z.string().min(3).max(3),
  }),
});
export type RawIntent = z.infer<typeof RawIntentSchema>;

/** Three-strategy search plan. */
export const SearchStrategySchema = z.object({
  strategy: z.enum(["literal", "adjacent", "wildcard"]),
  query: z.string().min(2),
  rationale: z.string(),
});

export const SearchPlanSchema = z.object({
  strategies: z.array(SearchStrategySchema).length(3),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

/** Semantic sub-scores from Claude for a candidate (0..1 each). */
export const SemanticScoreSchema = z.object({
  productId: z.string(),
  recipientFit: z.number().min(0).max(1),
  occasionFit: z.number().min(0).max(1),
  noveltyFit: z.number().min(0).max(1),
  fitNotes: z.string(),
});

export const SemanticScoresSchema = z.object({
  scores: z.array(SemanticScoreSchema),
});
export type SemanticScores = z.infer<typeof SemanticScoresSchema>;

/** Final explanation payload for one recommendation. */
export const ExplanationSchema = z.object({
  productId: z.string(),
  reasons: z.array(z.string()).min(1).max(3),
  tradeoff: z.string(),
  evidence: z
    .array(z.object({ claim: z.string(), sourceField: z.string() }))
    .max(5),
});

export const ExplanationsSchema = z.object({
  explanations: z.array(ExplanationSchema),
});
export type Explanations = z.infer<typeof ExplanationsSchema>;

/** Interpretation of a refinement chip / follow-up message. */
export const RefinementSchema = z.object({
  updatedIntentPatch: z
    .object({
      giftStyle: GiftStyleSchema.nullable().optional(),
      budgetMaxMajor: z.number().nullable().optional(),
      budgetMinMajor: z.number().nullable().optional(),
      addInterests: z.array(z.string()).optional(),
      addDislikes: z.array(z.string()).optional(),
      addHardConstraints: z.array(z.string()).optional(),
      addSoftPreferences: z.array(z.string()).optional(),
      searchThemes: z.array(z.string()).optional(),
    })
    .partial(),
  note: z.string(),
});
export type Refinement = z.infer<typeof RefinementSchema>;

/** Product-link evaluation ("is this a good gift?"). */
export const LinkEvaluationSchema = z.object({
  verdict: z.enum(["strong", "reasonable", "weak"]),
  reasons: z.array(z.string()).min(1).max(4),
  concerns: z.array(z.string()).max(3),
  suggestAlternatives: z.boolean(),
});
export type LinkEvaluation = z.infer<typeof LinkEvaluationSchema>;
