import "server-only";

import { ServerClient } from "postmark";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * OTP email delivery.
 *
 * Sends the one-time code via Postmark (mirroring the giftkart backend's
 * `postmark.ServerClient(...).sendEmail(...)` approach). When Postmark is not
 * configured (no POSTMARK_SERVER_TOKEN / EMAIL_FROM), it falls back to logging
 * the code to the server console so local development still works end-to-end.
 */

// Cache one client per token across HMR reloads in dev.
const globalForPostmark = globalThis as unknown as {
  __shoplensPostmark?: { token: string; client: ServerClient };
};

function getClient(token: string): ServerClient {
  if (globalForPostmark.__shoplensPostmark?.token !== token) {
    globalForPostmark.__shoplensPostmark = {
      token,
      client: new ServerClient(token),
    };
  }
  return globalForPostmark.__shoplensPostmark.client;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const token = env.postmarkServerToken;
  const from = env.emailFrom;

  // Fallback: no provider configured — print to console (dev skeleton behavior).
  if (!token || !from) {
    logger.info("OTP email (dev stub — Postmark not configured)", { email, code });
    console.log(`\n📧  OTP for ${email}: ${code}\n`);
    return;
  }

  const ttlMinutes = Math.round(env.otpTtlSeconds / 60);
  const client = getClient(token);
  const response = await client.sendEmail({
    From: from,
    To: email,
    Subject: `Your ShopLens sign-in code: ${code}`,
    HtmlBody: renderOtpHtml(code, ttlMinutes),
    TextBody: `Your ShopLens sign-in code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`,
    MessageStream: env.postmarkMessageStream,
  });

  // Postmark returns ErrorCode 0 on success.
  if (response.ErrorCode !== 0) {
    logger.error("Postmark rejected OTP email", {
      email,
      errorCode: response.ErrorCode,
      message: response.Message,
    });
    throw new Error(`Postmark send failed: ${response.Message}`);
  }
  logger.info("OTP email sent via Postmark", { email, messageId: response.MessageID });
}

function renderOtpHtml(code: string, ttlMinutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#faf6f0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#2a2724;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e5dcce;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:18px;font-weight:600;color:#713a8b;">ShopLens</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;">Your sign-in code</h1>
            <p style="margin:0;color:#5c554c;font-size:14px;">Enter this code to finish signing in. It expires in ${ttlMinutes} minutes.</p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <div style="background:#f3ecf7;border-radius:12px;text-align:center;padding:18px 0;font-size:34px;font-weight:700;letter-spacing:10px;color:#55296b;">${code}</div>
          </td></tr>
          <tr><td style="padding:0 32px 28px;">
            <p style="margin:0;color:#8b8378;font-size:12px;">If you didn't request this, you can safely ignore this email — no one can sign in without the code.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
