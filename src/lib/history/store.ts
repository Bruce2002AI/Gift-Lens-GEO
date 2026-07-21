import "server-only";

import { getSearchHistory, type HistoryDoc } from "@/lib/db/mongo";
import type { HistoryEntry } from "@/lib/history/types";

/**
 * Server-side search-history persistence, keyed by the authenticated user's id.
 *
 * Two read shapes: `listHistory` returns lightweight index rows (snapshot
 * projected away, so the menu payload stays small), and `getSnapshot` fetches
 * one conversation's full blob on restore. Writes are idempotent per
 * conversation and capped LRU by `updatedAt`.
 */

/** DB isn't bound by the ~5MB localStorage ceiling, so keep more than the local cap. */
const MAX_ENTRIES = 100;

function toEntry(doc: Pick<HistoryDoc, keyof HistoryDoc>): HistoryEntry {
  return {
    id: doc.conversationId,
    title: doc.title,
    subtitle: doc.subtitle,
    lens: doc.lens,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    turnCount: doc.turnCount,
    productCount: doc.productCount,
    thumbnailUrl: doc.thumbnailUrl,
  };
}

/** Newest first. Snapshots are projected out — this is the menu/index payload. */
export async function listHistory(userId: string): Promise<HistoryEntry[]> {
  const col = await getSearchHistory();
  const docs = await col
    .find({ userId }, { projection: { snapshot: 0 } })
    .sort({ updatedAt: -1 })
    .limit(MAX_ENTRIES)
    .toArray();
  return docs.map((d) => toEntry(d as HistoryDoc));
}

/** The full snapshot for one conversation, or null if it isn't the user's. */
export async function getSnapshot(userId: string, conversationId: string): Promise<unknown | null> {
  const col = await getSearchHistory();
  const doc = await col.findOne(
    { userId, conversationId },
    { projection: { snapshot: 1 } },
  );
  return doc ? doc.snapshot : null;
}

/**
 * Insert or update a conversation. Idempotent on (userId, conversationId): a
 * follow-up turn overwrites the snapshot and bumps `updatedAt`. After writing,
 * evict anything beyond the LRU cap (and its snapshot) so a heavy user can't
 * grow unbounded.
 */
export async function upsertHistory(
  userId: string,
  entry: HistoryEntry,
  snapshot: unknown,
): Promise<HistoryEntry> {
  const col = await getSearchHistory();
  const updatedAt = new Date(entry.updatedAt);
  const createdAt = new Date(entry.createdAt);
  const doc = await col.findOneAndUpdate(
    { userId, conversationId: entry.id },
    {
      $set: {
        title: entry.title,
        subtitle: entry.subtitle,
        lens: entry.lens,
        turnCount: entry.turnCount,
        productCount: entry.productCount,
        thumbnailUrl: entry.thumbnailUrl,
        snapshot,
        updatedAt,
      },
      $setOnInsert: { userId, conversationId: entry.id, createdAt },
    },
    { upsert: true, returnDocument: "after" },
  );

  // LRU eviction: keep the newest MAX_ENTRIES, drop the tail.
  const stale = await col
    .find({ userId }, { projection: { _id: 1 } })
    .sort({ updatedAt: -1 })
    .skip(MAX_ENTRIES)
    .toArray();
  if (stale.length > 0) {
    await col.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
  }

  if (!doc) throw new Error("Failed to save search history");
  return toEntry(doc);
}

export async function renameHistory(
  userId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  const col = await getSearchHistory();
  await col.updateOne({ userId, conversationId }, { $set: { title } });
}

export async function deleteHistory(userId: string, conversationId: string): Promise<void> {
  const col = await getSearchHistory();
  await col.deleteOne({ userId, conversationId });
}

export async function clearHistory(userId: string): Promise<void> {
  const col = await getSearchHistory();
  await col.deleteMany({ userId });
}
