"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WishlistProvider } from "@/components/wishlist/WishlistProvider";
import { ShortlistProvider } from "@/components/shortlist/ShortlistProvider";

/**
 * Client provider stack. Order matters: both the wishlist and shortlist depend
 * on the toast context (for feedback); the wishlist also needs the session (to
 * know who to load for). The shortlist is session-scoped (sessionStorage) and
 * needs no auth.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <WishlistProvider>
          <ShortlistProvider>{children}</ShortlistProvider>
        </WishlistProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
