import Link from "next/link";
import {
  ArrowRight,
  Gift,
  MessageSquareText,
  Radar,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="py-16 text-center sm:py-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-sm text-ink-soft">
          <Sparkles size={14} className="text-gold" aria-hidden />
          Powered by Shopify&apos;s Global Catalog + Ollama
        </p>
        <h1 className="mx-auto max-w-3xl font-(family-name:--font-display) text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
          One AI shopping agent.
          <br />
          <span className="text-plum">Many lenses.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Describe what you need in plain language — ShopLens picks the right
          lens and turns it into live, buyable recommendations and plans from
          Shopify&apos;s Global Catalog. Then it shows brands how to become
          easier for AI shopping agents to understand.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/shop" className="btn-primary text-base">
            <Gift size={18} aria-hidden />
            Start shopping
          </Link>
          <Link href="/geo" className="btn-secondary text-base">
            <Radar size={18} aria-hidden />
            Audit a product
          </Link>
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-sm text-ink-soft">
          Lenses: Gift · Skincare · Outfit · Nutrition · Room · Travel · Hobby
          kit · Life stage · Alternative finder · Occasion.
        </p>
      </section>

      {/* Two-sided visualization */}
      <section aria-label="How ShopLens works for shoppers and brands" className="grid gap-6 pb-16 md:grid-cols-2">
        <div className="card p-8">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-plum-wash text-plum">
              <MessageSquareText size={20} aria-hidden />
            </span>
            <h2 className="font-(family-name:--font-display) text-2xl font-semibold">
              For shoppers
            </h2>
          </div>
          <FlowSteps
            steps={[
              "Say what you need — a gift, an outfit, a routine, a room, a kit…",
              "ShopLens picks the lens, plans it, and searches live Shopify merchants",
              "Ranked picks or a component-by-component plan, each with evidence",
            ]}
          />
          <p className="mt-5 text-sm leading-relaxed text-ink-soft">
            Every result explains why it fits, cites the catalog evidence, and
            names one honest trade-off before you commit — with more options a
            tap away.
          </p>
          <Link
            href="/shop"
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-plum hover:text-plum-dark"
          >
            Open ShopLens <ArrowRight size={14} aria-hidden />
          </Link>
        </div>

        <div className="card p-8">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-wash text-gold">
              <Store size={20} aria-hidden />
            </span>
            <h2 className="font-(family-name:--font-display) text-2xl font-semibold">
              For brands
            </h2>
          </div>
          <FlowSteps
            steps={[
              "Paste your Shopify product URL",
              "ShopLens resolves it, then runs 10 real buyer-intent searches",
              "Commerce Agent Readiness Score + evidence-linked improvements",
            ]}
          />
          <p className="mt-5 text-sm leading-relaxed text-ink-soft">
            See which catalog signals make your product discoverable to AI
            shopping agents — and which missing signals may hold it back.
          </p>
          <Link
            href="/geo"
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-plum hover:text-plum-dark"
          >
            Open the GEO Lens <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </section>

      {/* Trust strip */}
      <section className="mb-20 grid gap-4 rounded-2xl border border-line bg-cream-deep/50 p-6 sm:grid-cols-3">
        {[
          {
            icon: <ScanSearch size={18} aria-hidden />,
            title: "Real Catalog calls",
            body: "search_catalog, lookup_catalog and get_product — with a sanitized API trace you can open on every result.",
          },
          {
            icon: <ShieldCheck size={18} aria-hidden />,
            title: "Hard constraints stay hard",
            body: "Budget, destination, availability and exclusions are enforced in code. Semantic charm never overrides them.",
          },
          {
            icon: <Sparkles size={18} aria-hidden />,
            title: "Honest by design",
            body: "No invented product facts, no fake delivery promises, and demo data is always labeled as demo data.",
          },
        ].map((item) => (
          <div key={item.title} className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-plum shadow-(--shadow-card)">
              {item.icon}
            </span>
            <div>
              <h3 className="font-medium">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.body}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function FlowSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={step} className="flex items-start gap-3 text-sm leading-relaxed">
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sand font-(family-name:--font-display) text-xs font-semibold text-ink"
          >
            {i + 1}
          </span>
          <span className="text-ink">{step}</span>
        </li>
      ))}
    </ol>
  );
}
