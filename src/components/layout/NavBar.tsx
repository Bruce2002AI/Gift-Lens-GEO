"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, ShoppingBag, ShoppingCart, SlidersHorizontal, Sparkles } from "lucide-react";
import { UserMenu } from "@/components/auth/UserMenu";
import { useWishlist } from "@/components/wishlist/WishlistProvider";
import { useShortlist } from "@/components/shortlist/ShortlistProvider";

const LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/geo", label: "GEO Lens" },
  { href: "/about", label: "How it works" },
];

export function NavBar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { count } = useWishlist();
  const { count: shortlistCount, openDrawer } = useShortlist();
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

          <button
            type="button"
            onClick={openDrawer}
            aria-label={`Shortlist${shortlistCount > 0 ? ` (${shortlistCount} items)` : ""}`}
            className="relative ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-plum"
          >
            <ShoppingCart size={18} aria-hidden />
            {shortlistCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-plum px-1 text-[10px] font-semibold text-white">
                {shortlistCount > 99 ? "99+" : shortlistCount}
              </span>
            )}
          </button>

          {status === "authenticated" ? (
            <>
              {/* Personalization is per-shopper, so it only appears once signed in. */}
              <Link
                href="/personalization"
                aria-label="Personalization Center"
                title="What the agent remembers about you"
                aria-current={pathname === "/personalization" ? "page" : undefined}
                className={`ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-sand hover:text-plum ${
                  pathname === "/personalization"
                    ? "bg-plum-wash text-plum"
                    : "text-ink-soft"
                }`}
              >
                <SlidersHorizontal size={18} aria-hidden />
              </Link>
              <Link
                href="/wishlist"
                aria-label={`Wishlist${count > 0 ? ` (${count} saved)` : ""}`}
                aria-current={pathname === "/wishlist" ? "page" : undefined}
                className="relative ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-plum"
              >
                <Heart size={18} aria-hidden />
                {count > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-plum px-1 text-[10px] font-semibold text-white">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </Link>
              <UserMenu name={session.user?.name} email={session.user?.email} />
            </>
          ) : (
            <Link
              href="/login"
              className="ml-1 rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sand hover:text-ink sm:px-4"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
