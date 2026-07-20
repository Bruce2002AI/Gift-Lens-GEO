"use client";

import { SessionProvider } from "next-auth/react";

/** Client wrapper so any component can read the session via `useSession`. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
