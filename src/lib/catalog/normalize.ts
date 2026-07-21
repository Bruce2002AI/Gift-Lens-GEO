import { htmlToPlainText, isRecord } from "@/lib/utils";
import type {
  CatalogMessage,
  NormalizedImage,
  NormalizedProduct,
  NormalizedRating,
  NormalizedSeller,
  NormalizedSpec,
  NormalizedVariant,
} from "./types";
import type {
  RawCatalogMessage,
  RawProduct,
  RawVariant,
} from "./schemas";

/**
 * Convert raw UCP catalog payloads to the normalized internal shape the UI
 * and ranking logic depend on. Defensive throughout — the official schema
 * guarantees only id/title/description/price_range/variants on products.
 */

function toStringId(id: string | number): string {
  return typeof id === "number" ? String(id) : id;
}

function normalizeDescription(
  d: RawProduct["description"] | RawVariant["description"],
): string {
  if (!d) return "";
  if (typeof d === "string") return htmlToPlainText(d);
  if (isRecord(d)) {
    if (typeof d.plain === "string" && d.plain.trim()) return d.plain.trim();
    if (typeof d.html === "string") return htmlToPlainText(d.html);
  }
  return "";
}

function normalizeMedia(
  media: RawProduct["media"] | RawProduct["images"],
): NormalizedImage[] {
  if (!Array.isArray(media)) return [];
  const out: NormalizedImage[] = [];
  for (const m of media) {
    if (!isRecord(m)) continue;
    const url =
      (typeof m.url === "string" && m.url) ||
      (typeof m.src === "string" && m.src) ||
      null;
    if (!url) continue;
    const alt =
      (typeof m.alt_text === "string" && m.alt_text) ||
      (typeof m.alt === "string" && m.alt) ||
      null;
    out.push({
      url,
      altText: alt,
      type: typeof m.type === "string" ? m.type : null,
    });
  }
  return out;
}

function normalizeRating(rating: RawProduct["rating"]): NormalizedRating {
  if (typeof rating === "number") {
    return { value: rating, scaleMin: null, scaleMax: 5, count: null };
  }
  if (isRecord(rating)) {
    const value =
      typeof rating.value === "number"
        ? rating.value
        : typeof rating.average === "number"
          ? rating.average
          : typeof rating.rating === "number"
            ? rating.rating
            : null;
    const scaleMax =
      typeof rating.scale_max === "number"
        ? rating.scale_max
        : typeof rating.max === "number"
          ? rating.max
          : value !== null
            ? 5
            : null;
    const scaleMin =
      typeof rating.scale_min === "number"
        ? rating.scale_min
        : typeof rating.min === "number"
          ? rating.min
          : null;
    const count =
      typeof rating.count === "number"
        ? rating.count
        : typeof rating.review_count === "number"
          ? rating.review_count
          : null;
    return { value, scaleMin, scaleMax, count };
  }
  return { value: null, scaleMin: null, scaleMax: null, count: null };
}

/**
 * `metadata.tech_specs` is newline-separated "Label: value" lines. Split on the
 * FIRST colon only — values legitimately contain colons (ratios, times) — and
 * keep colon-less lines as label-only so no catalog text is silently dropped.
 */
export function parseSpecs(lines: string[]): NormalizedSpec[] {
  const out: NormalizedSpec[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0 && idx < line.length - 1) {
      const label = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (label) out.push({ label, value: value || null });
    } else if (line.trim()) {
      out.push({ label: line.trim(), value: null });
    }
  }
  return out;
}

/** Condition arrives as string[] or a bare string; normalize to a clean list. */
function normalizeCondition(
  condition: RawVariant["condition"],
): string[] {
  if (Array.isArray(condition)) {
    return condition.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim());
  }
  if (typeof condition === "string" && condition.trim()) return [condition.trim()];
  return [];
}

function normalizeSeller(seller: RawVariant["seller"]): NormalizedSeller | null {
  if (!isRecord(seller)) return null;
  const policyLinks: Array<{ type: string; url: string }> = [];
  // Live responses use `links`; older aliases tolerated.
  const rawPolicies = seller.links ?? seller.policy_links ?? seller.policies;
  if (Array.isArray(rawPolicies)) {
    for (const p of rawPolicies) {
      if (isRecord(p) && typeof p.url === "string") {
        policyLinks.push({
          type: typeof p.type === "string" ? p.type : "policy",
          url: p.url,
        });
      }
    }
  } else if (isRecord(rawPolicies)) {
    for (const [type, url] of Object.entries(rawPolicies)) {
      if (typeof url === "string") policyLinks.push({ type, url });
      else if (isRecord(url) && typeof url.url === "string") {
        policyLinks.push({ type, url: url.url });
      }
    }
  }
  return {
    id: seller.id != null ? toStringId(seller.id as string | number) : null,
    name: typeof seller.name === "string" ? seller.name : null,
    url: typeof seller.url === "string" ? seller.url : null,
    domain: typeof seller.domain === "string" ? seller.domain : null,
    policyLinks,
  };
}

function normalizeVariantOptions(
  v: RawVariant,
): Array<{ name: string; label: string }> {
  const raw = v.options ?? v.selected_options ?? [];
  const out: Array<{ name: string; label: string }> = [];
  for (const o of raw) {
    if (!isRecord(o) || typeof o.name !== "string") continue;
    const label =
      (typeof o.label === "string" && o.label) ||
      (typeof o.value === "string" && o.value) ||
      "";
    if (label) out.push({ name: o.name, label });
  }
  return out;
}

export function normalizeVariant(
  v: RawVariant,
  productSeller: NormalizedSeller | null,
): NormalizedVariant {
  const availability = v.availability;
  const available =
    typeof availability?.available === "boolean"
      ? availability.available
      : typeof v.available === "boolean"
        ? v.available
        : null;
  const media = normalizeMedia(v.media);
  const imageFromSingle = isRecord(v.image)
    ? normalizeMedia([v.image])[0]?.url ?? null
    : null;
  return {
    id: toStringId(v.id),
    title: v.title ?? "",
    url: typeof v.url === "string" ? v.url : null,
    sku: v.sku ?? null,
    priceMinor: typeof v.price?.amount === "number" ? v.price.amount : null,
    currency: v.price?.currency ?? null,
    available,
    availabilityStatus: availability?.status ?? null,
    runningLow:
      typeof availability?.running_low === "boolean"
        ? availability.running_low
        : null,
    checkoutUrl: typeof v.checkout_url === "string" ? v.checkout_url : null,
    nativeCheckoutEligible:
      typeof v.native_checkout_eligible === "boolean"
        ? v.native_checkout_eligible
        : typeof v.eligible?.native_checkout === "boolean"
          ? v.eligible.native_checkout
          : null,
    requiresShipping:
      typeof v.requires_shipping === "boolean" ? v.requires_shipping : null,
    imageUrl: media[0]?.url ?? imageFromSingle,
    options: normalizeVariantOptions(v),
    seller: normalizeSeller(v.seller) ?? productSeller,
    description: normalizeDescription(v.description),
    rating: normalizeRating(v.rating),
    condition: normalizeCondition(v.condition),
  };
}

function normalizeCategories(
  p: RawProduct,
): Array<{ value: string; taxonomy?: string }> {
  const out: Array<{ value: string; taxonomy?: string }> = [];
  const push = (c: unknown) => {
    if (typeof c === "string" && c.trim()) out.push({ value: c.trim() });
    else if (isRecord(c)) {
      const value =
        (typeof c.full_name === "string" && c.full_name) ||
        (typeof c.name === "string" && c.name) ||
        (typeof c.value === "string" && c.value) ||
        (typeof c.id === "string" && c.id) ||
        null;
      if (value) {
        out.push({
          value,
          ...(typeof c.taxonomy === "string" ? { taxonomy: c.taxonomy } : {}),
        });
      }
    }
  };
  if (Array.isArray(p.categories)) p.categories.forEach(push);
  if (p.category) push(p.category);
  return out;
}

export function normalizeCatalogProduct(p: RawProduct): NormalizedProduct {
  const productSeller =
    normalizeSeller(p.seller) ??
    (Array.isArray(p.sellers) && p.sellers.length > 0
      ? normalizeSeller(p.sellers[0])
      : null);
  const variants = (p.variants ?? []).map((v) =>
    normalizeVariant(v, productSeller),
  );

  const minMinor =
    typeof p.price_range?.min?.amount === "number"
      ? p.price_range.min.amount
      : null;
  const maxMinor =
    typeof p.price_range?.max?.amount === "number"
      ? p.price_range.max.amount
      : null;
  const currency =
    p.price_range?.min?.currency ??
    p.price_range?.max?.currency ??
    variants.find((v) => v.currency)?.currency ??
    null;

  const options = (p.options ?? []).map((o) => ({
    name: o.name,
    values: (o.values ?? []).map((val) => {
      if (typeof val === "string") return { label: val };
      const label =
        (typeof val.label === "string" && val.label) ||
        (typeof val.value === "string" && val.value) ||
        (typeof val.name === "string" && val.name) ||
        "";
      return {
        label,
        ...(typeof val.available === "boolean"
          ? { available: val.available }
          : {}),
        ...(typeof val.exists === "boolean" ? { exists: val.exists } : {}),
      };
    }),
  }));

  const techSpecs = toStringList(p.metadata?.tech_specs);

  return {
    id: toStringId(p.id),
    title: p.title ?? "",
    description: normalizeDescription(p.description),
    url: typeof p.url === "string" ? p.url : null,
    handle: typeof p.handle === "string" ? p.handle : null,
    categories: normalizeCategories(p),
    images: normalizeMedia(p.media ?? p.images),
    priceRange: { minMinor, maxMinor, currency },
    options,
    variants,
    rating: normalizeRating(p.rating),
    // UCP reports the seller per variant; expose the first one product-level so
    // the storefront and its policy links are available without digging.
    seller: productSeller ?? variants.find((v) => v.seller)?.seller ?? null,
    metadata: {
      techSpecs,
      topFeatures: toStringList(p.metadata?.top_features),
      uniqueSellingPoints: toStringList(p.metadata?.unique_selling_points),
      specs: parseSpecs(techSpecs),
    },
    rawMessages: [],
  };
}

/** Live metadata fields arrive as string[] or one newline-joined string. */
function toStringList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((s) => s.trim().length > 0);
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeMessages(
  messages: RawCatalogMessage[] | null | undefined,
): CatalogMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => ({
    type: m.type ?? "info",
    code: m.code ?? null,
    message: m.content ?? m.message ?? null,
    severity: m.severity ?? null,
    ...(typeof m.path === "string" ? { path: m.path } : {}),
  }));
}

/** Identifiers listed in not_found messages (lookup_catalog convention). */
export function extractNotFound(messages: CatalogMessage[]): string[] {
  return messages
    .filter((m) => m.code === "not_found" || m.type === "not_found")
    .map((m) => m.message ?? "unresolved identifier");
}
