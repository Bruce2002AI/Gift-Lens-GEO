"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Bridges the global history menu (in the navbar) to the shop page's chat state.
 *
 * The menu lives above the router outlet, so it can't call the shop page's
 * setState directly. Instead it raises a signal here; the shop page reads the
 * signal and applies it, then acknowledges. Navigation is included so a click
 * from any page lands on /shop before the shop page consumes the signal.
 */
interface HistoryContextValue {
  /** Id of a search the user asked to reopen; null when nothing is pending. */
  pendingRestoreId: string | null;
  /** Navigate to /shop and request that this search be restored. */
  requestRestore: (id: string) => void;
  /** Shop page calls this once it has applied the restore. */
  consumeRestore: () => void;
  /** Increments each time the user asks for a fresh search. */
  newSearchNonce: number;
  /** Navigate to /shop and request a blank conversation. */
  requestNewSearch: () => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [newSearchNonce, setNewSearchNonce] = useState(0);

  const requestRestore = useCallback(
    (id: string) => {
      setPendingRestoreId(id);
      router.push("/shop");
    },
    [router],
  );

  const consumeRestore = useCallback(() => setPendingRestoreId(null), []);

  const requestNewSearch = useCallback(() => {
    setNewSearchNonce((n) => n + 1);
    router.push("/shop");
  }, [router]);

  return (
    <HistoryContext.Provider
      value={{
        pendingRestoreId,
        requestRestore,
        consumeRestore,
        newSearchNonce,
        requestNewSearch,
      }}
    >
      {children}
    </HistoryContext.Provider>
  );
}
