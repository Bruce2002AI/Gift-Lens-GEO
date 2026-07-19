"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, Sparkles } from "lucide-react";

const LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/geo", label: "GEO Lens" },
  { href: "/about", label: "How it works" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/90 backdrop-blur">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 font-(family-name:--font-display) text-xl font-semibold text-ink"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum text-white">
            <ShoppingBag size={17} aria-hidden />
          </span>
          ShopLens
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                  active
                    ? "bg-plum-wash text-plum"
                    : "text-ink-soft hover:bg-sand hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link href="/shop" className="btn-primary ml-1 hidden !px-4 !py-1.5 text-sm sm:inline-flex">
            <Sparkles size={14} aria-hidden />
            Start shopping
          </Link>
        </div>
      </nav>
    </header>
  );
}
