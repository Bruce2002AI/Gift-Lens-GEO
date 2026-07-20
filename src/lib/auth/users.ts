import "server-only";

import { getUsers, type UserDoc } from "@/lib/db/mongo";
import { normalizeEmail } from "@/lib/auth/otp";

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  provider: "otp" | "google";
}

function toAppUser(doc: UserDoc): AppUser {
  return {
    id: String(doc._id),
    email: doc.email,
    name: doc.name ?? null,
    image: doc.image ?? null,
    provider: doc.provider,
  };
}

export interface UpsertInput {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: "otp" | "google";
}

/** Insert or update a user by email, stamping login timestamps. Returns the stored user. */
export async function upsertUser(input: UpsertInput): Promise<AppUser> {
  const email = normalizeEmail(input.email);
  const now = new Date();
  const users = await getUsers();

  // Only overwrite name/image when provided (Google gives them; OTP does not).
  const set: Partial<UserDoc> = { email, provider: input.provider, lastLoginAt: now };
  if (input.name != null) set.name = input.name;
  if (input.image != null) set.image = input.image;

  const doc = await users.findOneAndUpdate(
    { email },
    { $set: set, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: "after" },
  );
  if (!doc) throw new Error("Failed to upsert user");
  return toAppUser(doc);
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const users = await getUsers();
  const doc = await users.findOne({ email: normalizeEmail(email) });
  return doc ? toAppUser(doc) : null;
}
