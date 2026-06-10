import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Henri. — Find Your Contractor | Free for Homeowners",
  description:
    "Henri matches you with one vetted, licensed contractor. No spam calls, no bidding wars. Free for homeowners.",
  // Canonical + explicit og:image (2026-06-09 audit): a child openGraph
  // replaces the root's wholesale, so `images` must be re-declared here
  // or link shares render with no card image.
  alternates: { canonical: "/portal" },
  openGraph: {
    title: "Henri. — The right contractor, not a sales call avalanche",
    description:
      "Henri matches you with exactly one vetted, licensed contractor for your project. Free for homeowners.",
    type: "website",
    url: "https://meethenri.com/portal",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Henri. — The right contractor for your project",
      },
    ],
  },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
