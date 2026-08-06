import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep in sync with CONTRACTOR_PREFIXES in src/middleware.ts. Both
        // lists exist because `(dashboard)` is a Next.js route GROUP and
        // contributes nothing to the URL, so a page nested under it is easy
        // to miss when scanning the source tree. /dev is internal tooling
        // (404'd in production by the middleware) and should never have been
        // crawlable either.
        //
        // 2026-08-06: "/leads" and "/territories" removed — those top-level
        // routes were deleted as unreachable duplicates of /dashboard and
        // /settings/territories, so there is nothing left to disallow. The
        // two prefixes remain in middleware's CONTRACTOR_PREFIXES as dead
        // entries (that file is approval-gated); they are inert, not a bug.
        // The surviving leads surfaces live under /dashboard/* and are
        // already covered by the "/dashboard" rule below.
        //
        // NOT listed here on purpose: /brand-preview. It carries
        // `metadata.robots = { index: false, follow: false }`, and a
        // robots.txt Disallow would stop crawlers fetching the page at all —
        // which means they'd never read that noindex. Disallow + noindex is
        // the classic way to leave a URL indexed-but-uncrawled. One
        // mechanism, and noindex is the stronger one.
        disallow: [
          "/dashboard",
          "/homeowner",
          "/onboarding",
          "/settings",
          "/dev",
          "/api",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
