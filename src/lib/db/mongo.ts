import "server-only";

import dns from "node:dns";
import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";
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

/**
 * Personalization storage. An extensible fact model (see
 * lib/personalization/types.ts) rather than a wide column set, so new signals
 * are data rather than migrations.
 */
export interface ProfileFactDoc {
  // Typed (not `unknown` like the older docs) so `_id` filters typecheck.
  _id?: ObjectId;
  userId: string;
  /** WHO the fact is about — `self` or a person's subject id. Legacy docs lack it. */
  subjectId?: string;
  lens: string;
  category: string;
  key: string;
  /** Arbitrary JSON value (string | number | boolean | string[]). */
  value: unknown;
  source: string;
  confidence: number;
  sensitivity: string;
  consentScope: string;
  quote: string | null;
  lastConfirmedAt: Date | null;
  /** Date → Mongo TTL purges it. Null → never expires (TTL ignores non-dates). */
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileRecordDoc {
  _id?: ObjectId;
  userId: string;
  lens: string;
  kind: string;
  label: string;
  /** Normalized (trimmed+lowercased) label — the identity for auto-upserts. */
  labelKey?: string;
  data: Record<string, unknown>;
  sensitivity: string;
  consentScope: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A subject is a person a conversation is about. `self` (the account owner) is
 * virtual and never stored; only named people get a row here.
 */
export interface ProfileSubjectDoc {
  _id?: ObjectId;
  userId: string;
  /** Stable per-user slug identifying the person. Never `self` in storage. */
  subjectId: string;
  kind: string;
  name: string;
  relationship: string | null;
  createdBy: string;
  /** Denormalized preview (interests, dislikes…) for the switcher subtitle. */
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutcomeEventDoc {
  _id?: ObjectId;
  userId: string;
  lens: string;
  productId: string;
  productTitle: string | null;
  outcome: string;
  note: string | null;
  createdAt: Date;
}

/**
 * A saved search — the light index fields (shown in the history menu) plus the
 * opaque `snapshot` blob used only to restore the conversation. The list query
 * projects `snapshot` away so opening the menu never ships megabytes. Scoped to
 * a user; identity is (userId, conversationId) so the debounced client upsert is
 * idempotent per conversation. `updatedAt` doubles as the TTL anchor — an active
 * conversation keeps bumping it, so only stale searches age out (see indexes).
 */
export interface HistoryDoc {
  _id?: ObjectId;
  userId: string;
  /** Client-generated conversation id; the restore + dedupe key. */
  conversationId: string;
  title: string;
  subtitle: string;
  lens: string | null;
  turnCount: number;
  productCount: number;
  thumbnailUrl: string | null;
  /** Opaque to storage — the shop page owns its shape (ChatSnapshot). */
  snapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoState {
  client: MongoClient;
  indexesEnsured: boolean;
}

// Reuse a single client + connection pool across HMR reloads in dev. We cache
// the in-flight promise so concurrent first-hits don't each build a client.
const globalForMongo = globalThis as unknown as {
  __shoplensMongo?: Promise<MongoState>;
};

/**
 * Resolve a `mongodb+srv://` URI to a plain `mongodb://` seedlist URI by doing
 * the SRV/TXT lookup ourselves.
 *
 * Why this exists: the driver resolves SRV via `dns.promises.resolveSrv` on the
 * *default* c-ares resolver. On machines whose system DNS is a local resolver
 * that refuses SRV queries (VPN clients, Docker, Pi-hole / AdGuard / NextDNS
 * filters — anything leaving system DNS pointed at 127.0.0.1), that lookup
 * fails with `querySrv ECONNREFUSED` and c-ares does NOT fall through to any
 * additional servers — so appending public resolvers to the global list does
 * not help, and every DB call dies. Resolving the seedlist ourselves — the
 * system resolver first, then public DNS (8.8.8.8 / 1.1.1.1) via a *dedicated*
 * resolver on failure — sidesteps the driver's SRV path entirely and is
 * deterministic. A healthy system resolver is used as-is; public DNS is only a
 * fallback. Non-SRV URIs are returned untouched.
 */
async function resolveMongoUri(uri: string): Promise<string> {
  if (!uri.startsWith("mongodb+srv://")) return uri;
  const m = uri.match(/^mongodb\+srv:\/\/([^@]*@)?([^/?]+)(\/[^?]*)?(\?.*)?$/i);
  if (!m) return uri; // unparseable — let the driver try the original.
  const userinfo = m[1] ?? "";
  const host = m[2];
  const dbPath = m[3] ?? "";
  const search = m[4] ? m[4].slice(1) : "";
  const srvName = `_mongodb._tcp.${host}`;

  async function lookup() {
    try {
      const srv = await dns.promises.resolveSrv(srvName);
      const txt = await dns.promises.resolveTxt(host).catch(() => []);
      return { srv, txt };
    } catch {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(["8.8.8.8", "1.1.1.1"]);
      const srv = await resolver.resolveSrv(srvName);
      const txt = await resolver.resolveTxt(host).catch(() => []);
      return { srv, txt };
    }
  }

  const { srv, txt } = await lookup();
  if (srv.length === 0) return uri; // nothing resolved — fall back to original.
  const hosts = srv.map((s) => `${s.name}:${s.port}`).join(",");

  // `mongodb+srv` implies TLS on and pulls extra options (typically authSource +
  // replicaSet) from the domain's TXT record. Merge them without overriding any
  // option the user already set in the URI.
  const params = new URLSearchParams(search);
  for (const chunk of txt.flat().join("&").split("&")) {
    const [k, v] = chunk.split("=");
    if (k && !params.has(k)) params.set(k, v ?? "");
  }
  if (!params.has("tls") && !params.has("ssl")) params.set("tls", "true");
  const qs = params.toString();
  return `mongodb://${userinfo}${hosts}${dbPath}${qs ? `?${qs}` : ""}`;
}

function getState(): Promise<MongoState> {
  const uri = env.mongoUri;
  if (!uri) {
    return Promise.reject(
      new Error(
        "MONGODB_URI is not set. Authentication requires a MongoDB connection.",
      ),
    );
  }
  if (!globalForMongo.__shoplensMongo) {
    globalForMongo.__shoplensMongo = (async () => {
      const resolved = await resolveMongoUri(uri);
      return {
        // The driver's 30s default means an unreachable cluster stalls every
        // caller for half a minute. Personalization additionally races these
        // calls (see agent-memory.ts) so a shopping turn never waits on the DB.
        client: new MongoClient(resolved, {
          serverSelectionTimeoutMS: 8_000,
          connectTimeoutMS: 8_000,
        }),
        indexesEnsured: false,
      };
    })().catch((err) => {
      // Don't cache a failed connection setup — let the next call retry.
      globalForMongo.__shoplensMongo = undefined;
      throw err;
    });
  }
  return globalForMongo.__shoplensMongo;
}

/** Connect (idempotent) and return the configured database. */
export async function getDb(): Promise<Db> {
  const state = await getState();
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
  const facts = db.collection<ProfileFactDoc>("profile_facts");

  // The subjects migration is BEST-EFFORT and isolated: a legacy-duplicate
  // collision here must never propagate out of ensureIndexes, because getDb()
  // awaits this before serving ANY request (sign-in included) — a throw would
  // be a database-wide outage that re-throws on every boot. upsertFacts already
  // dedupes in code, so the unique index is defence-in-depth, not correctness.
  //  1. Backfill legacy (pre-subjects) facts to the owner `self`, so a
  //     re-statement updates the same doc instead of inserting a duplicate.
  //  2. Drop the old (userId,lens,category,key) unique index — it would forbid a
  //     second person holding the same category.key as the owner.
  //  3. Build the subject-scoped unique index.
  try {
    await facts.updateMany({ subjectId: { $exists: false } }, { $set: { subjectId: "self" } });
    await facts.dropIndex("fact_identity").catch(() => {});
    await facts.createIndex(
      { userId: 1, subjectId: 1, lens: 1, category: 1, key: 1 },
      { unique: true, name: "fact_subject_identity" },
    );
  } catch (err) {
    console.warn(
      "[mongo] fact-subject migration deferred (dedupe handled in code):",
      err instanceof Error ? err.message : String(err),
    );
  }

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

    // Reading a subject's lens profile is the hot path (every session hydration).
    facts.createIndex({ userId: 1, subjectId: 1, lens: 1 }),
    // Facts with an expiry self-purge; null/absent expiresAt is ignored by TTL.
    facts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

    // One subject per (user, subjectId). Named people only — `self` is virtual.
    db
      .collection<ProfileSubjectDoc>("profile_subjects")
      .createIndex({ userId: 1, subjectId: 1 }, { unique: true, name: "subject_identity" }),
    db.collection<ProfileSubjectDoc>("profile_subjects").createIndex({ userId: 1, updatedAt: -1 }),

    db.collection<ProfileRecordDoc>("profile_records").createIndex({ userId: 1, kind: 1 }),
    db.collection<ProfileRecordDoc>("profile_records").createIndex({ userId: 1, lens: 1 }),
    // One auto-created record per (user, kind, normalized label). Partial so it
    // applies only to records carrying a labelKey (auto-built ones), leaving
    // manually-created records unconstrained — two "gift set" wardrobe items
    // are fine, but the agent must never mint a second "Priya".
    db.collection<ProfileRecordDoc>("profile_records").createIndex(
      { userId: 1, kind: 1, labelKey: 1 },
      {
        unique: true,
        name: "record_label_identity",
        partialFilterExpression: { labelKey: { $exists: true } },
      },
    ),

    db
      .collection<OutcomeEventDoc>("outcome_events")
      .createIndex({ userId: 1, createdAt: -1 }),
    db
      .collection<OutcomeEventDoc>("outcome_events")
      .createIndex({ userId: 1, productId: 1 }),

    // One history entry per (user, conversation) so the client's debounced
    // upsert is idempotent.
    db
      .collection<HistoryDoc>("search_history")
      .createIndex({ userId: 1, conversationId: 1 }, { unique: true, name: "history_identity" }),
    // The menu lists newest-first for a user.
    db.collection<HistoryDoc>("search_history").createIndex({ userId: 1, updatedAt: -1 }),
    // TTL: Mongo purges a search 90 days after its last activity. `updatedAt` is
    // bumped on every follow-up turn, so only genuinely stale searches age out.
    db
      .collection<HistoryDoc>("search_history")
      .createIndex({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, name: "history_ttl" }),
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

export async function getProfileFacts(): Promise<Collection<ProfileFactDoc>> {
  return (await getDb()).collection<ProfileFactDoc>("profile_facts");
}

export async function getProfileRecords(): Promise<Collection<ProfileRecordDoc>> {
  return (await getDb()).collection<ProfileRecordDoc>("profile_records");
}

export async function getProfileSubjects(): Promise<Collection<ProfileSubjectDoc>> {
  return (await getDb()).collection<ProfileSubjectDoc>("profile_subjects");
}

export async function getOutcomeEvents(): Promise<Collection<OutcomeEventDoc>> {
  return (await getDb()).collection<OutcomeEventDoc>("outcome_events");
}

export async function getSearchHistory(): Promise<Collection<HistoryDoc>> {
  return (await getDb()).collection<HistoryDoc>("search_history");
}
