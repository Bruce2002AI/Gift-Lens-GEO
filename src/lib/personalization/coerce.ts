import type { ProfileField } from "./schema";
import type { FactValue } from "./types";

/**
 * Canonicalize a model-written value onto the shape its form field expects.
 *
 * The agent writes prose: "pottery, hiking" for a tag list, "5000" for a money
 * slider, "Yes" for a switch. Storing that verbatim means the form renders a
 * list as one junk tag, a number as a string, and — worst — a budget off by a
 * factor of 100.
 *
 * MONEY IS THE IMPORTANT ONE. Fields flagged `minorUnits` are stored in minor
 * units (paise/cents) because that is what the catalog filters and the agent's
 * budget constraint use. A person says "5000 rupees" and the model writes
 * "5000", so model-written money is treated as MAJOR units and multiplied.
 * This runs ONLY on the ledger→profile path: values coming from the form are
 * already minor units and never pass through here.
 */

const TRUE_WORDS = new Set(["true", "yes", "on", "y", "1", "enabled", "allow"]);
const FALSE_WORDS = new Set(["false", "no", "off", "n", "0", "disabled", "deny"]);

/**
 * Split "a, b and c" / "a; b" into parts, preserving multi-word entries.
 *
 * "and" is only treated as a separator when the string ALREADY looks like a
 * list (has a comma). Otherwise a bare intra-phrase "and" — "Marks and
 * Spencer", "salt and pepper" — would be shattered into junk. When there is no
 * comma, the whole thing is a single value.
 */
function splitList(raw: string): string[] {
  const looksLikeList = /[,;]/.test(raw);
  const separator = looksLikeList ? /[,;]|\band\b/gi : /[,;]/g;
  return raw
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Multipliers for spoken magnitudes. INR is the default market, so "lakh" and
 * "crore" matter as much as "k"/"m". Ordered longest-first so "lac" doesn't
 * shadow "lakh" and "cr" doesn't shadow "crore".
 */
const MAGNITUDE: Array<[RegExp, number]> = [
  [/crores?\b|\bcr\b/i, 1e7],
  [/lakh?s?\b|lacs?\b/i, 1e5],
  [/millions?\b|\bmn\b|\dm\b/i, 1e6],
  [/thousands?\b|\dk\b/i, 1e3],
];

/**
 * Pull the first number out of text like "about 5,000 rupees", "5k", "2 lakh",
 * or "20 min", applying any spoken magnitude suffix.
 *
 * Getting this wrong is expensive: "2 lakh" parsed as 2 silently stored a
 * ₹200,000 budget as ₹500 (after the minor-unit ×100 and the slider floor
 * clamp). A range like "20-30" takes the FIRST number — documented here so it
 * isn't a silent surprise.
 */
function parseNumber(raw: string): number | null {
  // Strip separators (comma, ASCII space, NBSP, thin-space) but KEEP letters,
  // so the magnitude test below can still see "k"/"lakh".
  const compact = raw.replace(/[,   ]/g, "");
  const m = compact.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  for (const [re, mult] of MAGNITUDE) {
    if (re.test(compact)) {
      n *= mult;
      break;
    }
  }
  return n;
}

/**
 * Case-insensitive match onto a declared option, so casing stays canonical.
 *
 * Matching is DIRECTIONAL on purpose. "minimal" → "Minimal (2-3 steps)" is a
 * safe canonicalization: the shopper's value is a shorter form of the option.
 * The reverse is not: collapsing "dehydrated but oily" to "Oily" throws away
 * "dehydrated", which changes what we'd recommend. When the value says MORE
 * than any option, we keep the value and lose nothing.
 */
function canonicalOption(
  options: readonly string[] | undefined,
  value: string,
): string | null {
  if (!options?.length) return null;
  const v = value.trim().toLowerCase();

  const exact = options.find((o) => o.toLowerCase() === v);
  if (exact) return exact;

  // "Minimal" matches the option "Minimal (2-3 steps)".
  const head = options.find((o) => o.split("(")[0].trim().toLowerCase() === v);
  if (head) return head;

  // Value is a shorter form of an option — safe to expand.
  const expands = options.find((o) => o.toLowerCase().includes(v));
  return expands ?? null;
}

/**
 * Convert a raw model-written string onto the field's canonical type.
 * Returns null when nothing usable could be derived, so the caller can skip
 * storing a value rather than storing junk.
 */
export function coerceValueForField(
  field: ProfileField,
  raw: FactValue,
): FactValue | null {
  // Arrays only make sense for list controls; flatten otherwise.
  const asText = Array.isArray(raw)
    ? raw.join(", ")
    : typeof raw === "boolean"
      ? String(raw)
      : String(raw ?? "").trim();
  if (!asText) return null;

  switch (field.control) {
    case "toggle": {
      const v = asText.toLowerCase();
      if (TRUE_WORDS.has(v)) return true;
      if (FALSE_WORDS.has(v)) return false;
      return null;
    }

    case "slider": {
      const n = parseNumber(asText);
      if (n === null) return null;
      // Model-written money arrives in MAJOR units; the field stores minor.
      const value = field.minorUnits ? Math.round(n * 100) : n;
      // Respect the declared range so a stray number can't poison the control.
      if (field.min != null && value < field.min) return field.min;
      if (field.max != null && value > field.max) return field.max;
      return value;
    }

    case "multichips": {
      const parts = Array.isArray(raw) ? raw.map(String) : splitList(asText);
      // Prefer the canonical option label, but KEEP an unlisted value rather
      // than dropping it — "acne" as a skincare goal isn't in the option list,
      // yet silently discarding a health fact the shopper stated is worse than
      // storing a free entry the form shows alongside the chips.
      const mapped = parts
        .map((p) => canonicalOption(field.options, p) ?? p.trim())
        .filter((p) => p.length > 0);
      return mapped.length > 0 ? [...new Set(mapped)] : null;
    }

    case "tags": {
      const parts = Array.isArray(raw) ? raw.map((p) => String(p).trim()) : splitList(asText);
      const cleaned = parts.filter(Boolean);
      return cleaned.length > 0 ? [...new Set(cleaned)] : null;
    }

    case "chips":
    case "choice": {
      // Keep the shopper's words when they don't match a declared option —
      // an unlisted answer is still an answer, and the form shows it.
      return canonicalOption(field.options, asText) ?? asText;
    }

    case "date": {
      // Store ISO when we can parse it; otherwise keep the text so a human
      // can still read "14 March" rather than losing it entirely.
      const parsed = Date.parse(asText);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
      return asText;
    }

    case "text":
    default:
      return asText;
  }
}
