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
 * `connect-src` includes blob: + data: because MapLibre and PMTiles
 * spawn workers from blob URLs, and react-pdf (estimate PDF generation)
 * uses data: URLs.
 *
 * `frame-ancestors 'none'` is the strict version of X-Frame-Options
 * SAMEORIGIN; either is fine because we never embed Henri in iframes.
 */
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://cdn.vercel.sh https://*.vercel-insights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.openai.com https://nominatim.openstreetmap.org https://api.mapbox.com https://*.cartocdn.com https://*.vercel-insights.com",
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
    ];
  },
};

export default analyze(nextConfig);
