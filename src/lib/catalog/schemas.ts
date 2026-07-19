import { z } from "zod";

/**
 * Zod schemas for UCP Global Catalog responses.
 * Forward-compatible: loose objects tolerate unknown fields, and every field
 * the official schema does not guarantee is optional. Verified against
 * shopify.dev/docs/agents/catalog/global-catalog (UCP version 2026-04-08).
 */

export const AmountSchema = z.looseObject({
  amount: z.number(),
  currency: z.string(),
});

/** Descriptions arrive as `{ plain: "..." }`, plain strings, or objects with html. */
export const DescriptionSchema = z.union([
  z.string(),
  z.looseObject({
    plain: z.string().optional().nullable(),
    html: z.string().optional().nullable(),
  }),
]);

export const MediaItemSchema = z.looseObject({
  url: z.string().optional().nullable(),
  src: z.string().optional().nullable(),
  alt: z.string().optional().nullable(),
  alt_text: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
});

export const SelectedOptionSchema = z.looseObject({
  name: z.string(),
  label: z.string().optional().nullable(),
  value: z.string().optional().nullable(),
});

export const OptionValueSchema = z.union([
  z.string(),
  z.looseObject({
    label: z.string().optional().nullable(),
    value: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    available: z.boolean().optional().nullable(),
    exists: z.boolean().optional().nullable(),
  }),
]);

export const ProductOptionSchema = z.looseObject({
  name: z.string(),
  values: z.array(OptionValueSchema).optional().nullable(),
});

export const AvailabilitySchema = z.looseObject({
  available: z.boolean().optional().nullable(),
  status: z.string().optional().nullable(),
  running_low: z.boolean().optional().nullable(),
});

export const SellerSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional().nullable(),
  name: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  domain: z.string().optional().nullable(),
  // Live responses use `links: [{type, url}]`; keep older aliases tolerated.
  links: z.unknown().optional().nullable(),
  policies: z.unknown().optional().nullable(),
  policy_links: z.unknown().optional().nullable(),
});

export const RatingSchema = z.union([
  z.number(),
  z.looseObject({
    value: z.number().optional().nullable(),
    average: z.number().optional().nullable(),
    rating: z.number().optional().nullable(),
    max: z.number().optional().nullable(),
    scale_max: z.number().optional().nullable(),
    count: z.number().optional().nullable(),
    review_count: z.number().optional().nullable(),
  }),
]);

export const RawVariantSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  title: z.string().optional().nullable(),
  description: DescriptionSchema.optional().nullable(),
  url: z.string().optional().nullable(),
  price: AmountSchema.optional().nullable(),
  sku: z.string().optional().nullable(),
  handle: z.string().optional().nullable(),
  availability: AvailabilitySchema.optional().nullable(),
  available: z.boolean().optional().nullable(),
  options: z.array(SelectedOptionSchema).optional().nullable(),
  selected_options: z.array(SelectedOptionSchema).optional().nullable(),
  media: z.array(MediaItemSchema).optional().nullable(),
  image: MediaItemSchema.optional().nullable(),
  checkout_url: z.string().optional().nullable(),
  native_checkout_eligible: z.boolean().optional().nullable(),
  // Live responses report checkout eligibility as `eligible.native_checkout`.
  eligible: z
    .looseObject({ native_checkout: z.boolean().optional().nullable() })
    .optional()
    .nullable(),
  requires_shipping: z.boolean().optional().nullable(),
  rating: RatingSchema.optional().nullable(),
  seller: SellerSchema.optional().nullable(),
  inputs: z.array(z.unknown()).optional().nullable(),
});

/** Live metadata fields arrive either as string[] or as one newline-joined string. */
const StringListSchema = z.union([z.string(), z.array(z.string())]);

export const RawProductSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  title: z.string().optional().nullable(),
  description: DescriptionSchema.optional().nullable(),
  url: z.string().optional().nullable(),
  handle: z.string().optional().nullable(),
  price_range: z
    .looseObject({
      min: AmountSchema.optional().nullable(),
      max: AmountSchema.optional().nullable(),
    })
    .optional()
    .nullable(),
  media: z.array(MediaItemSchema).optional().nullable(),
  images: z.array(MediaItemSchema).optional().nullable(),
  options: z.array(ProductOptionSchema).optional().nullable(),
  variants: z.array(RawVariantSchema).optional().nullable(),
  rating: RatingSchema.optional().nullable(),
  seller: SellerSchema.optional().nullable(),
  sellers: z.array(SellerSchema).optional().nullable(),
  categories: z.array(z.unknown()).optional().nullable(),
  category: z.unknown().optional().nullable(),
  metadata: z
    .looseObject({
      tech_specs: StringListSchema.optional().nullable(),
      top_features: StringListSchema.optional().nullable(),
      unique_selling_points: StringListSchema.optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const CatalogMessageSchema = z.looseObject({
  type: z.string().optional().nullable(),
  code: z.string().optional().nullable(),
  path: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  severity: z.string().optional().nullable(),
});

export const StructuredContentSchema = z.looseObject({
  ucp: z.unknown().optional().nullable(),
  products: z.array(RawProductSchema).optional().nullable(),
  product: RawProductSchema.optional().nullable(),
  pagination: z
    .looseObject({
      cursor: z.string().optional().nullable(),
      has_next_page: z.boolean().optional().nullable(),
      total_count: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
  messages: z.array(CatalogMessageSchema).optional().nullable(),
});

export const JsonRpcResponseSchema = z.looseObject({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional().nullable(),
  result: z
    .looseObject({
      structuredContent: StructuredContentSchema.optional().nullable(),
      content: z.array(z.unknown()).optional().nullable(),
      isError: z.boolean().optional().nullable(),
    })
    .optional()
    .nullable(),
  error: z
    .looseObject({
      code: z.number().optional().nullable(),
      message: z.string().optional().nullable(),
      data: z.unknown().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const TokenResponseSchema = z.looseObject({
  access_token: z.string(),
  token_type: z.string().optional().nullable(),
  expires_in: z.number().optional().nullable(),
});

export type RawProduct = z.infer<typeof RawProductSchema>;
export type RawVariant = z.infer<typeof RawVariantSchema>;
export type RawCatalogMessage = z.infer<typeof CatalogMessageSchema>;
export type StructuredContent = z.infer<typeof StructuredContentSchema>;
