import "server-only";
import { z } from "zod";
import { structuredCompletion, visionAvailable, visionModel } from "@/lib/ai/client";
import { logger } from "@/lib/logger";

/**
 * Image understanding for the style lens and "show similar".
 *
 * A multimodal model reads the garment's visible attributes (type, colour, fit,
 * silhouette, pattern, material impression, formality). Those attributes drive
 * catalog queries — they are NEVER promoted to product claims about a
 * recommended item: what a photo suggests and what a listing states are
 * different things, and only the listing can be quoted as evidence.
 */

const GarmentSchema = z.object({
  /** e.g. "shirt", "trousers", "sneakers", "jacket". */
  type: z.string(),
  /** Dominant colour in plain words ("chocolate brown", "off-white"). */
  color: z.string().nullish(),
  /** "regular fit", "relaxed", "slim", "oversized" — as it reads in the photo. */
  fit: z.string().nullish(),
  /** Collar/neckline/cuff/length details a shopper would search on. */
  details: z.array(z.string()).nullish(),
  pattern: z.string().nullish(),
  /** Material impression — always a guess from a photo. */
  materialGuess: z.string().nullish(),
  /** Precise search phrase for THIS piece, written like a product title. */
  searchPhrase: z.string().nullish(),
  /** Deliberately broad 2-3 word phrase for the same piece ("white shirt men"). */
  broadPhrase: z.string().nullish(),
});

export const OutfitReadSchema = z.object({
  garments: z.array(GarmentSchema).min(1),
  palette: z.array(z.string()).nullish(),
  formality: z.string().nullish(),
  /** One-line read of the overall look ("relaxed smart-casual, warm neutrals"). */
  vibe: z.string().nullish(),
});
export type OutfitRead = z.infer<typeof OutfitReadSchema>;
export type Garment = z.infer<typeof GarmentSchema>;

const VISION_SYSTEM = `You are a fashion analyst reading a product or outfit photograph. Report ONLY what is visibly true in the image. Never guess a brand, price, or fabric composition as fact — material is always an impression. Be concrete and specific: "chocolate brown regular-fit shirt, spread collar, long sleeves, rolled cuffs" beats "a nice shirt". Write each searchPhrase the way a shopping catalog would title the item, including colour, fit and the distinguishing detail — and each broadPhrase as a deliberately generic 2-3 word version of the same item ("white shirt men", "black trousers") that would match many products.`;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

function parseDataUrl(
  dataUrl: string,
): { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | null {
  const m = dataUrl.match(DATA_URL_RE);
  if (!m) return null;
  return {
    mediaType: m[1] as "image/jpeg" | "image/png" | "image/webp",
    base64: m[2],
  };
}

/** Fetch a catalog image URL and encode it for the vision model. */
export async function fetchImageAsBase64(
  url: string,
): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const mediaType =
      type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    // Bound the payload — vision models reject very large images anyway.
    if (buf.length > 6_000_000) return null;
    return { mediaType, base64: buf.toString("base64") };
  } catch (err) {
    logger.warn("vision image fetch failed", {
      url: url.slice(0, 120),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function readImage(
  image: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string },
  prompt: string,
): Promise<OutfitRead | null> {
  const model = visionModel();
  if (!model) return null;
  try {
    return await structuredCompletion(VISION_SYSTEM, prompt, OutfitReadSchema, {
      image,
      model,
      maxTokens: 1200,
      temperature: 0.1,
      // Kept tight: structuredCompletion retries once on a schema miss, so this
      // is the per-attempt budget and vision must not eat the whole turn.
      timeoutMs: 35_000,
    });
  } catch (err) {
    logger.warn("vision analysis failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Analyze a shopper-uploaded outfit/inspiration photo. */
export async function analyzeUploadedOutfit(dataUrl: string): Promise<OutfitRead | null> {
  if (!visionAvailable()) return null;
  const image = parseDataUrl(dataUrl);
  if (!image) return null;
  return readImage(
    image,
    "Analyse this outfit photo. List EVERY distinct clothing item and accessory you can see as a separate garment, with its colour, fit, visible details, pattern, material impression, and a catalog-style search phrase. Then give the overall palette, formality and vibe. Return JSON matching the schema.",
  );
}

/** Analyze a catalog product's own photo so "show similar" matches on look, not just words. */
export async function analyzeProductImage(
  imageUrl: string,
  title: string,
): Promise<OutfitRead | null> {
  if (!visionAvailable()) return null;
  const image = await fetchImageAsBase64(imageUrl);
  if (!image) return null;
  return readImage(
    image,
    `This is the catalog photo for "${title}". Describe the MAIN garment precisely: type, colour, fit, collar/neckline and cuff details, pattern, material impression. Write a searchPhrase that would find visually similar items in another catalog. Ignore the model, background and props. Return JSON matching the schema.`,
  );
}

// ---------------------------------------------------------------------------
// General lens-aware image reading (skincare / gift / nutrition). Style keeps
// the detailed garment read above; every other lens gets a description tuned to
// what that expert would actually look for — and, for skincare, kept strictly
// to neutral educational observation, never diagnosis.
// ---------------------------------------------------------------------------

export const ImageReadSchema = z.object({
  /** One-line, neutral summary of what the photo shows. */
  summary: z.string(),
  /** Concrete, visible observations — bullet-style, no interpretation beyond what's seen. */
  observations: z.array(z.string()).min(1),
  /** 2-4 GENERIC catalog search phrases the image suggests (2-4 words each). */
  searchPhrases: z.array(z.string()).nullish(),
  /** Set only if what's shown may warrant a professional (skincare/nutrition). Never a diagnosis. */
  concern: z.string().nullish(),
});
export type ImageRead = z.infer<typeof ImageReadSchema>;

type GeneralImageLens = "skincare" | "gift" | "nutrition";

const IMAGE_SYSTEM: Record<GeneralImageLens, string> = {
  skincare: `You are helping describe a photo a person shared about their SKIN, for educational product guidance only. You are NOT a doctor and you do NOT diagnose. Report ONLY what is plainly visible, in neutral everyday words — the area shown, the apparent skin surface (looks oily/shiny, dry/flaky, or normal), and visible features (for example: a single raised red bump, a few small whiteheads, patchy redness, dark marks left behind). NEVER name a medical condition, grade severity, or state a cause ("this is acne/rosacea/eczema" is forbidden). If what's shown looks painful, deep/cystic, widespread, bleeding or infected, put that in "concern" as a gentle reason to see a professional — still without diagnosing. Suggest 2-4 GENERIC, gentle product search phrases the visible picture suggests (e.g. "gentle cleanser", "niacinamide serum", "oil free moisturizer", "spot treatment").`,
  gift: `You are looking at a photo someone shared to help you choose a GIFT — it might show the recipient's style, their room or space, a hobby, a pet, a screenshot of something they like, or an object. Describe concretely what's visibly relevant to gifting: the aesthetic and colours, apparent interests or hobbies, and any objects or details that hint at taste. Do not guess private facts about a person beyond what's visible. Suggest 2-4 GENERIC gift-search phrases the image inspires.`,
  nutrition: `You are looking at a photo shared in a NUTRITION chat — likely a meal, a plate, a grocery haul, or a product's nutrition label. Describe only what's visibly present: the foods and rough portions you can see, or, if it's a label, only the facts printed on it. Do NOT estimate calories, macros you can't read, or make health claims. Suggest 2-4 GENERIC grocery/food search phrases the image suggests.`,
};

/** Analyze a shopper-uploaded photo for a non-style lens. */
export async function analyzeImageForLens(
  dataUrl: string,
  lens: GeneralImageLens,
): Promise<ImageRead | null> {
  if (!visionAvailable()) return null;
  const image = parseDataUrl(dataUrl);
  if (!image) return null;
  const model = visionModel();
  if (!model) return null;
  try {
    return await structuredCompletion(
      IMAGE_SYSTEM[lens],
      "Describe this photo per your instructions. Report only what is visibly true. Return JSON matching the schema (summary, observations[], searchPhrases[], and concern only if warranted).",
      ImageReadSchema,
      { image, model, maxTokens: 900, temperature: 0.1, timeoutMs: 35_000 },
    );
  } catch (err) {
    logger.warn("general image analysis failed", {
      lens,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Compact, model-facing summary of a general image read. */
export function describeImageRead(read: ImageRead): string {
  const lines = [`VISION READ — ${read.summary}`];
  for (const o of read.observations.slice(0, 8)) lines.push(`  • ${o}`);
  if (read.concern) lines.push(`  ⚠ worth flagging: ${read.concern}`);
  const phrases = (read.searchPhrases ?? []).filter(Boolean);
  if (phrases.length > 0) lines.push(`suggested searches: ${phrases.map((p) => `"${p}"`).join(", ")}`);
  return lines.join("\n");
}

/** Compact, model-facing summary of an outfit read. */
export function describeOutfitRead(read: OutfitRead): string {
  const lines = [`VISION READ — overall: ${read.vibe}${read.formality ? ` (${read.formality})` : ""}`];
  if (read.palette?.length) lines.push(`palette: ${read.palette.join(", ")}`);
  read.garments.forEach((g, i) => {
    const bits = [
      [g.color, g.type].filter(Boolean).join(" "),
      g.fit ?? null,
      g.pattern ?? null,
      g.details?.length ? g.details.join(", ") : null,
      g.materialGuess ? `looks like ${g.materialGuess} (photo impression, not a listing fact)` : null,
    ].filter(Boolean);
    const phrase = g.searchPhrase ?? [g.color, g.fit, g.type].filter(Boolean).join(" ");
    const broad = g.broadPhrase ?? [g.color, g.type].filter(Boolean).join(" ");
    lines.push(`  ${i + 1}. ${bits.join(" · ")} → precise: "${phrase}" | broad: "${broad}"`);
  });
  lines.push(
    "Search each piece with BOTH its broad phrase (fills the shortlist) and its precise phrase (finds the exact match) — the broad one matters most for giving them real choice.",
  );
  return lines.join("\n");
}
