import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { getOtps } from "@/lib/db/mongo";

/**
 * Email one-time passcode issue + verify.
 *
 * Codes are never stored in plaintext: we keep an HMAC (keyed by AUTH_SECRET)
 * and compare in constant time. Each email has at most one pending code (upsert),
 * codes expire via a MongoDB TTL index, and verification is attempt-limited.
 */

const MAX_ATTEMPTS = 5;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "mismatch" };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Generate a numeric code of env.otpLength digits (leading zeros preserved). */
export function generateOtp(): string {
  const len = env.otpLength;
  let code = "";
  for (let i = 0; i < len; i++) code += randomInt(0, 10).toString();
  return code;
}

function hashOtp(email: string, code: string): string {
  const secret = env.authSecret;
  if (!secret) throw new Error("AUTH_SECRET is required to hash OTP codes.");
  return createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

/**
 * Create (or replace) the pending code for an email and return the plaintext
 * code so the caller can deliver it. The plaintext is never persisted.
 */
export async function issueOtp(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const code = generateOtp();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.otpTtlSeconds * 1000);
  const otps = await getOtps();
  await otps.updateOne(
    { email: normalized },
    {
      $set: {
        email: normalized,
        codeHash: hashOtp(normalized, code),
        attempts: 0,
        expiresAt,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return code;
}

/** Verify a submitted code; consumes (deletes) the record on success. */
export async function verifyOtp(email: string, code: string): Promise<VerifyResult> {
  const normalized = normalizeEmail(email);
  const otps = await getOtps();
  const doc = await otps.findOne({ email: normalized });
  if (!doc) return { ok: false, reason: "no_code" };

  if (doc.expiresAt.getTime() <= Date.now()) {
    await otps.deleteOne({ email: normalized });
    return { ok: false, reason: "expired" };
  }
  if (doc.attempts >= MAX_ATTEMPTS) {
    await otps.deleteOne({ email: normalized });
    return { ok: false, reason: "too_many_attempts" };
  }

  const expected = Buffer.from(doc.codeHash, "hex");
  const actual = Buffer.from(hashOtp(normalized, code), "hex");
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await otps.updateOne({ email: normalized }, { $inc: { attempts: 1 } });
    return { ok: false, reason: "mismatch" };
  }

  await otps.deleteOne({ email: normalized });
  return { ok: true };
}
