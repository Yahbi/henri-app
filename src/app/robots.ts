import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep in sync with CONTRACTOR_PREFIXES in src/middleware.ts. /leads
        // and /territories were missing here for the same reason they were
        // missing from the auth gate: they live in the `(dashboard)` route
        // group, which contributes nothing to the URL, so neither list
        // matched them. /dev is internal tooling (now 404'd in production by
        // the middleware) and should never have been crawlable either.
        disallow: [
          "/dashboard",
          "/homeowner",
          "/onboarding",
          "/settings",
          "/leads",
          "/territories",
          "/dev",
          "/api",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
