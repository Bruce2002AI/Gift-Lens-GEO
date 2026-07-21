"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WishlistProvider } from "@/components/wishlist/WishlistProvider";
import { ShortlistProvider } from "@/components/shortlist/ShortlistProvider";
import { HistoryProvider } from "@/components/history/HistoryProvider";

/**
 * Client provider stack. Order matters: both the wishlist and shortlist depend
 * on the toast context (for feedback); the wishlist also needs the session (to
 * know who to load for). The shortlist is session-scoped (sessionStorage) and
 * needs no auth. History is device-local (localStorage) and bridges the navbar
 * menu to the shop page.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <WishlistProvider>
          <ShortlistProvider>
            <HistoryProvider>{children}</HistoryProvider>
          </ShortlistProvider>
        </WishlistProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
