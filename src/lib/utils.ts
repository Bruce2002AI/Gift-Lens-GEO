/** Small shared utilities (isomorphic — no secrets, no server-only imports). */

let counter = 0;

/** Unique-enough id for JSON-RPC requests and trace events. */
export function uniqueId(prefix = "req"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Strip HTML tags and decode common entities into safe plain text. */
export function htmlToPlainText(html: string): string {
  const withoutTags = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalize a title for fuzzy dedupe: lowercase, alphanumeric words only. */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter. */
export function backoffDelay(attempt: number, baseMs = 400): number {
  const cap = baseMs * 2 ** attempt;
  return Math.floor(Math.random() * cap);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Alphanumeric word tokens, lowercased. */
function wordTokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Fold a word to a stem that a regular singular and plural share, so
 * "candles"/"candle", "glasses"/"glass", and "cases"/"case" all compare equal.
 * Deliberately dictionary-free: `-es` is stripped only after a genuine sibilant
 * stem (glasses→glass, boxes→box, dishes→dish); otherwise a trailing `-s` (but
 * not `-ss`) is dropped (candles→candle, cats→cat). Irregular plurals
 * (leaf/leaves) and a few `-s`/`-us` singulars are out of scope — acceptable
 * fuzziness for gift exclusions, where the alternative was garbage stems.
 */
function pluralStem(word: string): string {
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Whole-word / whole-phrase containment: does `phrase` appear in `haystack` as
 * complete word(s), not merely as a substring? "cat" matches "a cat toy" but
 * NOT "delicate"; "coffee mug" matches "blue coffee mug". Both sides are
 * tokenized to alphanumeric words so punctuation never blocks a match. With
 * `stemPlurals`, singular and plural forms are folded together so "no candles"
 * matches a "candle" listing and "no glass" matches "glasses". Used for gift
 * exclusions (stemmed) and interest-mention claims (exact), where substring
 * matching produced false positives.
 */
export function phraseInText(
  haystack: string,
  phrase: string,
  opts: { stemPlurals?: boolean } = {},
): boolean {
  const norm = opts.stemPlurals ? pluralStem : (w: string) => w;
  const needle = wordTokens(phrase).map(norm);
  if (needle.length === 0) return false;
  const padded = ` ${wordTokens(haystack).map(norm).join(" ")} `;
  return padded.includes(` ${needle.join(" ")} `);
}
