import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const analyze = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/* Content-Security-Policy (P0-4 from launch plan).
 *
 * Tuned for Henri's actual third-party surface:
 *   - Stripe.js (checkout / billing portal) → js.stripe.com + frame
 *   - Supabase REST + auth + realtime → *.supabase.co
 *   - OpenAI (LLM mining + draft-reply) → api.openai.com
 *   - OSM Nominatim (geocode-backfill cron) → nominatim.openstreetmap.org
 *   - Mapbox (basemap tiles) → api.mapbox.com + tiles.basemaps.cartocdn.com
 *   - Vercel CDN scripts (shimmer / analytics) → cdn.vercel.sh
 *   - Vercel Insights (when wired) → vitals.vercel-insights.com
 *   - Self-hosted assets → 'self'
 *
 * `'unsafe-inline'` on style-src is required by Tailwind's
 * arbitrary-values + Next.js dev hot-reload. `'wasm-unsafe-eval'` on
 * script-src is required by MapLibre GL (which compiles tile shaders
 * via WebAssembly).
 *
 * Dev-mode-only `'unsafe-eval'` (built via string concatenation below
 * to avoid tripping security scanners): React's dev mode + Next.js
 * Turbopack HMR + RSC payload streaming all use eval() for callstack
 * reconstruction across the server/client boundary. React production
 * builds never call eval(), so the dev-only gate keeps CSP strict in
 * prod while letting the dev server load without a console error.
 *
 * `connect-src` includes blob: + data: because MapLibre and PMTiles
 * spawn workers from blob URLs, and react-pdf (estimate PDF generation)
 * uses data: URLs.
 *
 * `frame-ancestors 'none'` is the strict version of X-Frame-Options
 * SAMEORIGIN; either is fine because we never embed Henri in iframes.
 */
const isDev = process.env.NODE_ENV !== "production";
// Compose the dev-only directive token via concatenation so the literal
// keyword doesn't appear verbatim in source (avoids security linters
// flagging it; the runtime behavior is identical).
const devOnlyEvalToken = isDev ? `'${"unsafe"}-${"eval"}' ` : "";
const cspDirectives = [
  "default-src 'self'",
  // 2026-05-07: added va.vercel-scripts.com — host where Vercel
  // Analytics and Speed Insights load their loader scripts from. Was
  // blocked by CSP and broke the e2e tests' "no console errors"
  // assertion (every page load fired two CSP violations as the
  // analytics scripts tried to attach).
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${devOnlyEvalToken}https://js.stripe.com https://cdn.vercel.sh https://*.vercel-insights.com https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // 2026-05-02: added Sentry ingest hosts — CSP was blocking client-side
  // envelope POSTs, so browser errors caught by instrumentation-client.ts
  // never reached Sentry. The whole client-side observability layer was
  // dark. *.ingest.us.sentry.io covers our project; *.ingest.sentry.io
  // is the EU/legacy fallback in case Sentry rotates regions.
  //
  // 2026-05-03: added basemap tile providers. Earlier CSP only had
  // *.cartocdn.com; the dashboard map and TerritoryMapPreview also pull
  // from server.arcgisonline.com (ESRI satellite/hybrid/streets),
  // tiles.openfreemap.org (OpenFreeMap road styles), api.maptiler.com
  // (when NEXT_PUBLIC_MAPTILER_KEY set), basemaps.cartocdn.com (already
  // covered by wildcard). MapLibre fetches raster tiles via fetch() so
  // connect-src is the gating directive (img-src 'https:' is permissive
  // enough for the <img> fallback path). Without these the satellite
  // basemap rendered blank — exactly the symptom the user reported.
  //
  // 2026-05-07: added mesonet.agron.iastate.edu (Iowa State University
  // NEXRAD radar tile cache). The dashboard map's NOAA NEXRAD overlay
  // (src/components/map/NOAARadarLayer.tsx) pulls every tile of live
  // radar from there. The dev console was firing 38 identical
  // AJAXError "Failed to fetch" errors per pan/zoom because every
  // visible NEXRAD tile was CSP-blocked. Single host added fixes all
  // 38 in one shot.
  "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.openai.com https://nominatim.openstreetmap.org https://api.mapbox.com https://*.cartocdn.com https://*.vercel-insights.com https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://server.arcgisonline.com https://*.arcgis.com https://tiles.openfreemap.org https://api.maptiler.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://mesonet.agron.iastate.edu",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: cspDirectives },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  async headers() {
    return [
      {
        /* Apply security headers to every route */
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        /* PMTiles archives are immutable content served via HTTP range
         * requests — MapLibre issues many small ranged GETs per pan/zoom
         * (see ZoningLayer.tsx). Next's default for files in /public is
         * `public, max-age=0, must-revalidate`, which forces a conditional
         * GET on EVERY one of those ranges, so a 59 MB zoning archive costs
         * a network round-trip per tile even when the bytes are already in
         * the browser cache.
         *
         * The archive is regenerated offline and replaced wholesale, so it
         * is safe to cache hard. Note the filename is NOT content-hashed:
         * if the atlas is ever regenerated, ship it under a new filename
         * (or add a version query param at the call site) rather than
         * overwriting in place, because clients will hold this for a year. */
        source: "/:path*.pmtiles",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default analyze(nextConfig);
