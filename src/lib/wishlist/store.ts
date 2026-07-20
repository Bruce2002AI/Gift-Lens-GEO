import "server-only";

import { getWishlist, type WishlistDoc } from "@/lib/db/mongo";
import type {
  WishlistItem,
  WishlistItemInput,
  WishlistSource,
} from "@/lib/wishlist/types";

/** Server-side wishlist persistence, keyed by the authenticated user's id. */

function toItem(doc: WishlistDoc): WishlistItem {
  return {
    productId: doc.productId,
    source: doc.source,
    title: doc.title,
    imageUrl: doc.imageUrl,
    url: doc.url,
    priceMinor: doc.priceMinor,
    priceMaxMinor: doc.priceMaxMinor,
    currency: doc.currency,
    brand: doc.brand,
    rating: doc.rating,
    available: doc.available,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listWishlist(userId: string): Promise<WishlistItem[]> {
  const col = await getWishlist();
  const docs = await col.find({ userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(toItem);
}

export async function addWishlist(
  userId: string,
  input: WishlistItemInput,
): Promise<WishlistItem> {
  const col = await getWishlist();
  const now = new Date();
  const set = {
    userId,
    productId: input.productId,
    source: input.source,
    title: input.title,
    imageUrl: input.imageUrl,
    url: input.url,
    priceMinor: input.priceMinor,
    priceMaxMinor: input.priceMaxMinor,
    currency: input.currency,
    brand: input.brand,
    rating: input.rating,
    available: input.available,
  };
  const doc = await col.findOneAndUpdate(
    { userId, productId: input.productId, source: input.source },
    { $set: set, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: "after" },
  );
  if (!doc) throw new Error("Failed to save wishlist item");
  return toItem(doc);
}

export async function removeWishlist(
  userId: string,
  productId: string,
  source: WishlistSource,
): Promise<void> {
  const col = await getWishlist();
  await col.deleteOne({ userId, productId, source });
}
