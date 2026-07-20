import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in — ShopLens",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const googleEnabled = Boolean(env.googleClientId && env.googleClientSecret);

  // Only accept relative callback URLs to avoid open-redirects.
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12 sm:px-6">
      <div className="w-full">
        <LoginForm googleEnabled={googleEnabled} callbackUrl={safeCallback} />
      </div>
    </div>
  );
}
