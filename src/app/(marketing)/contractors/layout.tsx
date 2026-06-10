import type { Metadata } from "next";

export const metadata: Metadata = {
  // 2026-04-30 truthfulness pass — earlier title + descriptions claimed
  // "Exclusive Leads", "delivered exclusively to you", "One contractor
  // per trade per ZIP". The lock infrastructure exists in DB and API
  // but no UI path acquires a lock and no cron enforces forfeit, so
  // those claims were unbacked. See plan
  // ~/.claude/plans/whats-the-14-days-purring-papert.md.
  title: "Henri. for Contractors — AI-Scored Building Permit Leads",
  description:
    "Henri turns public building permits into AI-scored, contact-enriched leads in your dashboard. Plans from $149/mo, 24-hour free trial, cancel anytime.",
  // Canonical + explicit og:image (2026-06-09 audit): defining a child
  // `openGraph` REPLACES the root layout's object wholesale, which had
  // silently dropped og:image on this page — link shares rendered with
  // no card image. Child openGraph blocks must re-declare `images`.
  alternates: { canonical: "/contractors" },
  openGraph: {
    title: "Henri. — AI-scored building permit leads for contractors",
    description:
      "Permit data + AI scoring + homeowner contact enrichment, refreshed daily. Plans from $149/mo, 24-hour free trial.",
    type: "website",
    url: "https://meethenri.com/contractors",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Henri. — AI-scored building permit leads for contractors",
      },
    ],
  },
};

export default function ContractorsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
