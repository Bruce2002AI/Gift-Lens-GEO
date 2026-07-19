import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How ShopLens works",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-(family-name:--font-display) text-3xl font-semibold">
        How ShopLens works
      </h1>

      <div className="mt-6 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        <section>
          <h2 className="font-(family-name:--font-display) text-xl font-semibold text-ink">
            The core insight
          </h2>
          <p className="mt-2">
            A shopper starts with <strong className="text-ink">known intent and an unknown product</strong>.
            A brand starts with a <strong className="text-ink">known product and unknown discoverability</strong>.
            ShopLens serves both with the same three Shopify Global Catalog
            tools, pointed in opposite directions.
          </p>
        </section>

        <section>
          <h2 className="font-(family-name:--font-display) text-xl font-semibold text-ink">
            Shopper flow
          </h2>
          <p className="mt-2">
            The AI model extracts a structured GiftIntent from your description
            (validated with Zod — budget, destination, exclusions, style).
            ShopLens then plans three deliberately different searches —
            literal, adjacent, and wildcard — and runs them in parallel with
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-xs">search_catalog</code>,
            using hard filters for price, availability, and destination.
            Candidates are deduplicated, re-checked against every hard
            constraint in code, and scored (35% recipient fit, 20% occasion fit,
            20% logistics, 10% quality, 10% completeness, 5% novelty). You get a
            ranked set — a dozen by default, expandable on request — led by
            three signature picks (Best Match, Delight, Safe) re-validated with
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-xs">get_product</code>
            before you see them; every further match is re-checked the moment
            you open it.
          </p>
        </section>

        <section>
          <h2 className="font-(family-name:--font-display) text-xl font-semibold text-ink">
            Brand flow (GEO Lens)
          </h2>
          <p className="mt-2">
            Your product URL is resolved with
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-xs">lookup_catalog</code>,
            deep-audited with
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-xs">get_product</code>,
            then tested against ten realistic buyer-intent searches. The Agent
            Readiness Score is a transparent heuristic over observable catalog
            evidence — never a claim about Shopify&apos;s internal ranking.
          </p>
        </section>

        <section>
          <h2 className="font-(family-name:--font-display) text-xl font-semibold text-ink">
            Responsible-use commitments
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Product facts come only from Catalog API responses — the model cannot invent price, availability, materials, or policies.</li>
            <li>Hard constraints (budget, destination, availability, exclusions) are enforced deterministically in code.</li>
            <li>No delivery promises: shipping eligibility never becomes an arrival date.</li>
            <li>Demo/mock data is always labeled; live API failures are never silently replaced.</li>
            <li>GEO recommendations carry no ranking guarantee, and ShopLens never modifies a merchant listing.</li>
            <li>Secrets stay server-side; inspiration images are validated, used for one request, and never persisted or logged.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
