/**
 * Currency helpers: major-unit ↔ minor-unit conversion and display formatting.
 * Not every currency has two fraction digits (JPY has 0, BHD has 3), so we
 * derive the exponent from Intl.NumberFormat currency metadata with a
 * well-tested fallback table.
 */

const FALLBACK_FRACTION_DIGITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

const fractionDigitCache = new Map<string, number>();

export function currencyFractionDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = fractionDigitCache.get(code);
  if (cached !== undefined) return cached;
  let digits: number;
  try {
    const fmt = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    });
    digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = FALLBACK_FRACTION_DIGITS[code] ?? 2;
  }
  fractionDigitCache.set(code, digits);
  return digits;
}

/** ₹4,000 INR → 400000 minor units. Returns null for invalid input. */
export function majorToMinor(
  amountMajor: number | null | undefined,
  currency: string,
): number | null {
  if (amountMajor === null || amountMajor === undefined) return null;
  if (!Number.isFinite(amountMajor) || amountMajor < 0) return null;
  const digits = currencyFractionDigits(currency);
  return Math.round(amountMajor * 10 ** digits);
}

export function minorToMajor(
  amountMinor: number | null | undefined,
  currency: string,
): number | null {
  if (amountMinor === null || amountMinor === undefined) return null;
  if (!Number.isFinite(amountMinor)) return null;
  const digits = currencyFractionDigits(currency);
  return amountMinor / 10 ** digits;
}

/** Format a minor-unit amount for display, e.g. 400000 INR → "₹4,000.00". */
export function formatMinor(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amountMinor === null || amountMinor === undefined || !currency) {
    return "Price unavailable";
  }
  const major = minorToMajor(amountMinor, currency);
  if (major === null) return "Price unavailable";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}

/** Format a minor-unit price range for display. */
export function formatMinorRange(
  minMinor: number | null | undefined,
  maxMinor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!currency) return "Price unavailable";
  if (minMinor != null && maxMinor != null && minMinor !== maxMinor) {
    return `${formatMinor(minMinor, currency)} – ${formatMinor(maxMinor, currency)}`;
  }
  const single = minMinor ?? maxMinor;
  return formatMinor(single, currency);
}

export function isValidCurrencyCode(code: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return FALLBACK_FRACTION_DIGITS[code.toUpperCase()] !== undefined;
  }
}
