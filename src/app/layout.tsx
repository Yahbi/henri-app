import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ReactQueryProvider } from "@/components/ReactQueryProvider";
import { GodModeSwitcher } from "@/components/dev/GodModeSwitcher";
import { ToastProvider } from "@/components/ui/toast";
import { RedirectReasonToast } from "@/components/RedirectReasonToast";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

export const metadata: Metadata = {
  title: {
    default: "Henri. | AI-Powered Contractor Marketplace",
    template: "%s | Henri.",
  },
  description:
    "Henri connects homeowners with verified, licensed contractors the moment a building permit is filed. Claim your territory, get real-time leads, and win more jobs with AI-powered lead scoring.",
  metadataBase: new URL(APP_URL),
  keywords: [
    "contractor leads",
    "building permits",
    "contractor marketplace",
    "home renovation",
    "licensed contractors",
    "permit intelligence",
    "construction leads",
  ],
  openGraph: {
    type: "website",
    siteName: "Henri.",
    title: "Henri. | AI-Powered Contractor Marketplace",
    description:
      "Connecting homeowners with verified contractors. Claim your territory and get notified the moment a permit is filed in your ZIP.",
    url: APP_URL,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Henri. | AI-Powered Contractor Marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Henri. | AI-Powered Contractor Marketplace",
    description:
      "Connecting homeowners with verified contractors. Claim your territory and get notified the moment a permit is filed in your ZIP.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  // PWA manifest + iOS metadata (P1-10/11).
  // The manifest at /manifest.json declares Henri. as installable.
  // theme-color is exported via `viewport` below (Next 14+ deprecated
  // the metadata.themeColor field).
  manifest: "/manifest.json",
  appleWebApp: {
    title: "Henri.",
    statusBarStyle: "default",
    capable: true,
  },
  icons: {
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

/* Viewport export (Next 14+).
 * `themeColor` makes iOS Safari and Android Chrome tint their browser
 * chrome to brand `#D4886A` when the app is open. The light/dark media
 * query preserves the chosen color across both color schemes. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#D4886A" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" className={`${dmSans.variable} ${fraunces.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans">
        {/* Skip-to-content link for keyboard users. Visible only on focus. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-md"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <ToastProvider>
            <ReactQueryProvider>{children}</ReactQueryProvider>
            {/* Surfaces middleware redirect reasons as toasts. */}
            <Suspense fallback={null}>
              <RedirectReasonToast />
            </Suspense>
          </ToastProvider>
        </ThemeProvider>
        {process.env.NODE_ENV !== "production" && <GodModeSwitcher />}
        {/* Vercel Analytics + Speed Insights (P1-13). First-party scripts
         * served from cdn.vercel.sh — already allowed by our CSP. They
         * auto-no-op outside production / preview, so dev builds aren't
         * affected. CSP `connect-src` allows *.vercel-insights.com so the
         * beacon POSTs land. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
