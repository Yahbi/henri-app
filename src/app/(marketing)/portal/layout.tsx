import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Henri. — Find Your Contractor | Free for Homeowners",
  description:
    "Henri matches you with one vetted, licensed contractor. No spam calls, no bidding wars. Free for homeowners.",
  openGraph: {
    title: "Henri. — The right contractor, not a sales call avalanche",
    description:
      "Henri matches you with exactly one vetted, licensed contractor for your project. Free for homeowners.",
    type: "website",
    url: "https://meethenri.com/portal",
  },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
