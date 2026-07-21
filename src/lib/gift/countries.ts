/**
 * A curated list of major markets Shopify merchants commonly ship to, used as
 * the single source of truth for the ship-to filter dropdown and for resolving
 * a country name back to its ISO-3166 alpha-2 code in the agent loop.
 *
 * The ledger stores `country` as an ISO-2 code (e.g. "IN", "US"); we keep the
 * human-readable name alongside so the UI can show "Ships to Germany" instead
 * of a bare "DE".
 */
export interface Country {
  /** ISO-3166 alpha-2 code, uppercase. */
  code: string;
  name: string;
}

/** Major shipping markets, grouped loosely by region then alphabetised. */
export const SHIPPING_COUNTRIES: readonly Country[] = [
  // Asia
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "CN", name: "China" },
  { code: "HK", name: "Hong Kong" },
  // Middle East
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "QA", name: "Qatar" },
  { code: "IL", name: "Israel" },
  // North America
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "MX", name: "Mexico" },
  // Europe
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  // Oceania
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  // South America & Africa
  { code: "BR", name: "Brazil" },
  { code: "ZA", name: "South Africa" },
];

const NAME_BY_CODE = new Map(SHIPPING_COUNTRIES.map((c) => [c.code, c.name]));

const CODE_BY_NAME = new Map<string, string>();
for (const { code, name } of SHIPPING_COUNTRIES) {
  CODE_BY_NAME.set(name.toLowerCase(), code);
}
// Common aliases the model (or a shopper) is likely to use.
const ALIASES: Record<string, string> = {
  usa: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  uae: "AE",
  emirates: "AE",
  "south korea": "KR",
  korea: "KR",
};
for (const [alias, code] of Object.entries(ALIASES)) {
  CODE_BY_NAME.set(alias, code);
}

/** Display name for an ISO-2 code, falling back to the code itself. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return NAME_BY_CODE.get(code.toUpperCase()) ?? code;
}

/**
 * Resolve a free-form country string (name, alias, or ISO-2 code) to an ISO-2
 * code. Returns null when nothing matches.
 */
export function countryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const byName = CODE_BY_NAME.get(trimmed.toLowerCase());
  if (byName) return byName;
  const upper = trimmed.toUpperCase();
  if (trimmed.length === 2 && NAME_BY_CODE.has(upper)) return upper;
  // Unknown two-letter code: accept it so users aren't blocked by our list.
  if (trimmed.length === 2) return upper;
  return null;
}

// ---------------------------------------------------------------------------
// Postal / PIN code formats
// ---------------------------------------------------------------------------

export interface PostalFormat {
  /** Full-match validator, run against the trimmed, uppercased value. */
  pattern: RegExp;
  /** Sample value shown in the placeholder/hint. */
  example: string;
  /** Restrict the input to digits only when true (native numeric keypad). */
  numeric: boolean;
  /** Longest a valid value can be, including any separator (for maxLength). */
  maxLength: number;
}

/**
 * Per-country postal-code rules. Countries not listed accept any non-empty
 * value — we would rather let an unusual-but-real code through than block a
 * shopper over a format we haven't catalogued.
 */
const POSTAL_FORMATS: Record<string, PostalFormat> = {
  IN: { pattern: /^\d{6}$/, example: "560001", numeric: true, maxLength: 6 },
  SG: { pattern: /^\d{6}$/, example: "238859", numeric: true, maxLength: 6 },
  US: { pattern: /^\d{5}(-\d{4})?$/, example: "94103", numeric: false, maxLength: 10 },
  CA: { pattern: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/, example: "K1A 0B1", numeric: false, maxLength: 7 },
  GB: {
    pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/,
    example: "SW1A 1AA",
    numeric: false,
    maxLength: 8,
  },
  AU: { pattern: /^\d{4}$/, example: "2000", numeric: true, maxLength: 4 },
  NZ: { pattern: /^\d{4}$/, example: "6011", numeric: true, maxLength: 4 },
  DE: { pattern: /^\d{5}$/, example: "10115", numeric: true, maxLength: 5 },
  FR: { pattern: /^\d{5}$/, example: "75001", numeric: true, maxLength: 5 },
  ES: { pattern: /^\d{5}$/, example: "28001", numeric: true, maxLength: 5 },
  IT: { pattern: /^\d{5}$/, example: "00100", numeric: true, maxLength: 5 },
  FI: { pattern: /^\d{5}$/, example: "00100", numeric: true, maxLength: 5 },
  MX: { pattern: /^\d{5}$/, example: "01000", numeric: true, maxLength: 5 },
  BR: { pattern: /^\d{5}-?\d{3}$/, example: "01310-100", numeric: false, maxLength: 9 },
  NL: { pattern: /^\d{4}\s?[A-Z]{2}$/, example: "1011 AB", numeric: false, maxLength: 7 },
  BE: { pattern: /^\d{4}$/, example: "1000", numeric: true, maxLength: 4 },
  AT: { pattern: /^\d{4}$/, example: "1010", numeric: true, maxLength: 4 },
  CH: { pattern: /^\d{4}$/, example: "8001", numeric: true, maxLength: 4 },
  DK: { pattern: /^\d{4}$/, example: "1050", numeric: true, maxLength: 4 },
  NO: { pattern: /^\d{4}$/, example: "0155", numeric: true, maxLength: 4 },
  SE: { pattern: /^\d{3}\s?\d{2}$/, example: "111 22", numeric: false, maxLength: 6 },
  PL: { pattern: /^\d{2}-?\d{3}$/, example: "00-001", numeric: false, maxLength: 6 },
  PT: { pattern: /^\d{4}-?\d{3}$/, example: "1000-001", numeric: false, maxLength: 8 },
  JP: { pattern: /^\d{3}-?\d{4}$/, example: "100-0001", numeric: false, maxLength: 8 },
  KR: { pattern: /^\d{5}$/, example: "04524", numeric: true, maxLength: 5 },
  CN: { pattern: /^\d{6}$/, example: "100000", numeric: true, maxLength: 6 },
  TH: { pattern: /^\d{5}$/, example: "10200", numeric: true, maxLength: 5 },
  MY: { pattern: /^\d{5}$/, example: "50050", numeric: true, maxLength: 5 },
  ID: { pattern: /^\d{5}$/, example: "10110", numeric: true, maxLength: 5 },
  PH: { pattern: /^\d{4}$/, example: "1000", numeric: true, maxLength: 4 },
  VN: { pattern: /^\d{6}$/, example: "100000", numeric: true, maxLength: 6 },
  IL: { pattern: /^\d{5}(\d{2})?$/, example: "9103001", numeric: true, maxLength: 7 },
  ZA: { pattern: /^\d{4}$/, example: "0001", numeric: true, maxLength: 4 },
  // Hong Kong has no postal code system.
  HK: { pattern: /^$/, example: "", numeric: true, maxLength: 0 },
};

/** The format rules for a country, or null when we have none / no code. */
export function postalFormat(code: string | null | undefined): PostalFormat | null {
  if (!code) return null;
  return POSTAL_FORMATS[code.toUpperCase()] ?? null;
}

/**
 * What a country calls its postal code, for labels, placeholders, and messages.
 * India says "PIN code", the US says "ZIP code", much of the Commonwealth says
 * "postcode"; everyone else falls back to the generic "postal code".
 */
const POSTAL_TERMS: Record<string, string> = {
  IN: "PIN code",
  US: "ZIP code",
  GB: "postcode",
  AU: "postcode",
  NZ: "postcode",
  IE: "postcode",
  ZA: "postcode",
};

export function postalTerm(code: string | null | undefined): string {
  if (!code) return "postal code";
  return POSTAL_TERMS[code.toUpperCase()] ?? "postal code";
}

/**
 * Validate a postal code against a country's format. Returns an error message
 * to show the shopper, or null when the value is acceptable (including when the
 * country is unknown or has no defined format). An empty value is always fine —
 * it clears the constraint rather than failing.
 */
export function validatePostalCode(
  code: string | null | undefined,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fmt = postalFormat(code);
  if (!fmt) return null;
  const name = countryName(code) ?? code;
  const term = postalTerm(code);
  if (fmt.maxLength === 0) return `${name} has no ${term}.`;
  if (fmt.pattern.test(trimmed.toUpperCase())) return null;
  return `Enter a valid ${name} ${term} (e.g. ${fmt.example}).`;
}
