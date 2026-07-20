import "server-only";

import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "@/lib/env";

/**
 * Server-only MongoDB access for authentication (users + one-time passcodes).
 *
 * The MongoClient is cached on globalThis so Next.js hot-reload in development
 * does not open a new connection pool on every module evaluation. Nothing here
 * runs unless the DB is actually configured — callers guard with env.authConfigured.
 */

export interface UserDoc {
  _id?: unknown;
  email: string;
  name?: string | null;
  image?: string | null;
  provider: "otp" | "google";
  createdAt: Date;
  lastLoginAt: Date;
}

export interface OtpDoc {
  _id?: unknown;
  email: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface WishlistDoc {
  _id?: unknown;
  /** Owner — the stringified Mongo user _id from session.user.id. */
  userId: string;
  productId: string;
  source: "live" | "mock";
  title: string;
  imageUrl: string | null;
  url: string | null;
  priceMinor: number | null;
  priceMaxMinor: number | null;
  currency: string | null;
  /** Store / seller / merchant name. */
  brand: string | null;
  rating: { value: number | null; scaleMax: number | null; count: number | null } | null;
  available: boolean | null;
  createdAt: Date;
}

interface MongoState {
  client: MongoClient;
  indexesEnsured: boolean;
}

// Reuse a single client + connection pool across HMR reloads in dev.
const globalForMongo = globalThis as unknown as {
  __shoplensMongo?: MongoState;
};

function getState(): MongoState {
  const uri = env.mongoUri;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Authentication requires a MongoDB connection.",
    );
  }
  if (!globalForMongo.__shoplensMongo) {
    globalForMongo.__shoplensMongo = {
      client: new MongoClient(uri),
      indexesEnsured: false,
    };
  }
  return globalForMongo.__shoplensMongo;
}

/** Connect (idempotent) and return the configured database. */
export async function getDb(): Promise<Db> {
  const state = getState();
  // MongoClient.connect() is safe to call repeatedly; it no-ops once connected.
  await state.client.connect();
  const db = state.client.db(env.mongoDbName);
  if (!state.indexesEnsured) {
    await ensureIndexes(db);
    state.indexesEnsured = true;
  }
  return db;
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<UserDoc>("users").createIndex({ email: 1 }, { unique: true }),
    // Unique per email so a fresh request replaces any pending code.
    db.collection<OtpDoc>("otps").createIndex({ email: 1 }, { unique: true }),
    // TTL index: Mongo purges the doc once expiresAt passes.
    db
      .collection<OtpDoc>("otps")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // One wishlist entry per user + product + source.
    db
      .collection<WishlistDoc>("wishlists")
      .createIndex({ userId: 1, productId: 1, source: 1 }, { unique: true }),
  ]);
}

export async function getUsers(): Promise<Collection<UserDoc>> {
  return (await getDb()).collection<UserDoc>("users");
}

export async function getOtps(): Promise<Collection<OtpDoc>> {
  return (await getDb()).collection<OtpDoc>("otps");
}

export async function getWishlist(): Promise<Collection<WishlistDoc>> {
  return (await getDb()).collection<WishlistDoc>("wishlists");
}
