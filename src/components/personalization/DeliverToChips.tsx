"use client";

import { ChevronDown, Hash, MapPin } from "lucide-react";
import { SHIPPING_COUNTRIES, countryName, postalFormat } from "@/lib/gift/countries";

/**
 * Home-screen "deliver to" control — a country selector and a PIN/postal field
 * that sit under the prompt. Both are pending until the shopper searches, at
 * which point they ride along as shipping context on the first turn.
 */
export function DeliverToChips({
  country,
  postal,
  onCountry,
  onPostal,
}: {
  country: string | null;
  postal: string;
  onCountry: (code: string) => void;
  onPostal: (value: string) => void;
}) {
  const name = countryName(country);
  const fmt = postalFormat(country);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <label className="group relative inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-plum/50 has-[:focus-visible]:border-plum">
        <MapPin size={14} aria-hidden className="text-ink-soft group-hover:text-plum" />
        {name ? <span>Deliver to {name}</span> : <span className="text-ink-soft">Deliver to?</span>}
        <ChevronDown size={12} aria-hidden className="text-ink-faint" />
        <select
          value={country ?? ""}
          onChange={(e) => e.target.value && onCountry(e.target.value)}
          aria-label="Deliver to country"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <option value="" disabled>
            Deliver to…
          </option>
          {SHIPPING_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[13px] text-ink transition-colors focus-within:border-plum">
        <Hash size={14} aria-hidden className="text-ink-soft" />
        <span className="sr-only">PIN or postal code</span>
        <input
          value={postal}
          onChange={(e) =>
            onPostal(fmt?.numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)
          }
          placeholder={fmt?.example ? `PIN ${fmt.example}` : "PIN code"}
          inputMode={fmt?.numeric ? "numeric" : undefined}
          maxLength={fmt?.maxLength}
          className="w-24 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
    </div>
  );
}
