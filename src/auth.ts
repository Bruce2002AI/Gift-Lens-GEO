import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { env } from "@/lib/env";
import { verifyOtp } from "@/lib/auth/otp";
import { upsertUser, getUserByEmail } from "@/lib/auth/users";
import { logger } from "@/lib/logger";

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Two sign-in methods, one JWT session (7 days by default) in a secure cookie:
 *  - Google OAuth (only enabled when AUTH_GOOGLE_ID/SECRET are set).
 *  - Email OTP via a Credentials provider named "email-otp": the code is issued
 *    by /api/auth/otp and verified here.
 *
 * We persist users ourselves (see users.ts) rather than via a database adapter,
 * so both providers behave identically. Credentials requires the JWT strategy.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(10),
});

const providers: NextAuthConfig["providers"] = [];

if (env.googleClientId && env.googleClientSecret) {
  providers.push(
    Google({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    }),
  );
}

providers.push(
  Credentials({
    id: "email-otp",
    name: "Email OTP",
    credentials: {
      email: { label: "Email", type: "email" },
      code: { label: "Code", type: "text" },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { email, code } = parsed.data;

      const result = await verifyOtp(email, code);
      if (!result.ok) {
        logger.warn("OTP verification failed", { email, reason: result.reason });
        return null;
      }

      const user = await upsertUser({ email, provider: "otp" });
      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
);

export const authConfig: NextAuthConfig = {
  secret: env.authSecret ?? undefined,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: env.sessionMaxAgeDays * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers,
  callbacks: {
    // Persist Google users before the jwt callback resolves the canonical id.
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const email = user.email ?? (profile?.email as string | undefined);
        if (!email) return false;
        await upsertUser({
          email,
          name: user.name ?? (profile?.name as string | undefined) ?? null,
          image: user.image ?? (profile?.picture as string | undefined) ?? null,
          provider: "google",
        });
      }
      return true;
    },
    // On initial sign-in, stamp the token with our canonical MongoDB user id.
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await getUserByEmail(user.email);
        if (dbUser) {
          token.id = dbUser.id;
          token.email = dbUser.email;
          token.name = dbUser.name;
          token.picture = dbUser.image;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? session.user.id;
        if (token.email) session.user.email = token.email;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
