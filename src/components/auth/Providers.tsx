"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WishlistProvider } from "@/components/wishlist/WishlistProvider";

/**
 * Client provider stack. Order matters: WishlistProvider depends on both the
 * session (to know who to load for) and the toast context (for feedback).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <WishlistProvider>{children}</WishlistProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
