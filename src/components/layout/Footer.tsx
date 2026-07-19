export function Footer() {
  return (
    <footer className="border-t border-line bg-cream-deep/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-(family-name:--font-display) font-semibold text-ink">
            ShopLens
          </span>{" "}
          — built on Shopify&apos;s Global Catalog API and Ollama.
        </p>
        <p className="max-w-md">
          Recommendations reflect live catalog data at query time. ShopLens has
          no access to Shopify&apos;s private ranking logic and guarantees no
          visibility outcome.
        </p>
      </div>
    </footer>
  );
}
