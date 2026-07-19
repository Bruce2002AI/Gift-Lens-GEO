import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { NavBar } from "@/components/layout/NavBar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShopLens — One AI shopping agent, many lenses.",
  description:
    "ShopLens turns plain-language needs into live, buyable recommendations and plans from Shopify's Global Catalog — gifts, outfits, routines, room bundles and more — and shows brands how AI shopping agents understand their products.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${inter.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-plum focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <NavBar />
        <main id="main" className="min-h-[calc(100vh-8rem)]">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
