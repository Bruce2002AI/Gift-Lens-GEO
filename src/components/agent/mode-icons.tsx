"use client";

import {
  ArrowLeftRight,
  Droplets,
  Gift,
  KeyRound,
  Luggage,
  Palette,
  PartyPopper,
  Salad,
  ShoppingBag,
  Shirt,
  Sofa,
  type LucideIcon,
} from "lucide-react";

/** Resolve a mode's icon name (from ModeMeta) to a lucide component. */
const ICONS: Record<string, LucideIcon> = {
  Gift,
  ArrowLeftRight,
  Droplets,
  Shirt,
  Salad,
  Sofa,
  Luggage,
  Palette,
  KeyRound,
  PartyPopper,
};

export function modeIcon(name: string): LucideIcon {
  return ICONS[name] ?? ShoppingBag;
}
