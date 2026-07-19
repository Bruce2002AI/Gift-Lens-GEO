import "server-only";
import type { ShoppingMode, ShoppingModeId } from "./types";

/**
 * Lazy skill registry — each mode is loaded on demand via dynamic import(), so
 * a conversation only pulls the code for the lens it actually uses ("load the
 * behavior on the go"). Loaded descriptors are cached per process.
 */

const loaders: Partial<
  Record<ShoppingModeId, () => Promise<{ default: ShoppingMode }>>
> = {
  gift: () => import("./skills/gift"),
  swap: () => import("./skills/swap"),
  skincare: () => import("./skills/skincare"),
  style: () => import("./skills/style"),
  nutrition: () => import("./skills/nutrition"),
  room: () => import("./skills/room"),
  travel: () => import("./skills/travel"),
  hobby: () => import("./skills/hobby"),
  lifestage: () => import("./skills/lifestage"),
  occasion: () => import("./skills/occasion"),
};

export class ModeUnavailableError extends Error {
  constructor(public readonly modeId: ShoppingModeId) {
    super(`Shopping mode "${modeId}" is not available yet.`);
    this.name = "ModeUnavailableError";
  }
}

const cache = new Map<ShoppingModeId, ShoppingMode>();

export async function getMode(id: ShoppingModeId): Promise<ShoppingMode> {
  const cached = cache.get(id);
  if (cached) return cached;
  const loader = loaders[id];
  if (!loader) throw new ModeUnavailableError(id);
  const mod = await loader();
  cache.set(id, mod.default);
  return mod.default;
}

export function isModeImplemented(id: ShoppingModeId): boolean {
  return loaders[id] != null;
}
