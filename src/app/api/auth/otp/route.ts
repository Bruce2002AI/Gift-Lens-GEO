import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { issueOtp, normalizeEmail } from "@/lib/auth/otp";
import { sendOtpEmail } from "@/lib/auth/email";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email() });

// Lightweight per-email throttle (min gap between requests). In-memory only —
// good enough for the skeleton; a shared store would be needed to scale out.
const RESEND_GAP_MS = 30_000;
const lastSent = new Map<string, number>();

export async function POST(request: Request) {
  if (!env.authConfigured) {
    return NextResponse.json(
      { ok: false, error: "Authentication is not configured on the server." },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "A valid email is required." },
      { status: 400 },
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const now = Date.now();
  const previous = lastSent.get(email);
  if (previous && now - previous < RESEND_GAP_MS) {
    const retryAfter = Math.ceil((RESEND_GAP_MS - (now - previous)) / 1000);
    return NextResponse.json(
      { ok: false, error: `Please wait ${retryAfter}s before requesting another code.` },
      { status: 429 },
    );
  }

  try {
    const code = await issueOtp(email);
    await sendOtpEmail(email, code);
    lastSent.set(email, now);

    const devMode = process.env.NODE_ENV !== "production";
    return NextResponse.json({
      ok: true,
      // Only exposed in non-production to make local testing easy.
      ...(devMode ? { devCode: code } : {}),
    });
  } catch (err) {
    logger.error("Failed to issue OTP", { email, error: (err as Error).message });
    return NextResponse.json(
      { ok: false, error: "Could not send the code. Try again shortly." },
      { status: 500 },
    );
  }
}
