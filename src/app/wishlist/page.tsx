import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WishlistView } from "@/components/wishlist/WishlistView";

export const metadata: Metadata = {
  title: "Your Wishlist — ShopLens",
};

export const runtime = "nodejs";

export default async function WishlistPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/wishlist");
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-(family-name:--font-display) text-3xl font-semibold">
          Your Wishlist
        </h1>
        <p className="mt-1 text-ink-soft">
          Products you saved from AI recommendations, kept to your account.
        </p>
      </header>
      <WishlistView />
    </div>
  );
}
