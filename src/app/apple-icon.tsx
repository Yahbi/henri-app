/**
 * Apple touch icon — 180×180 PNG generated at edge runtime from the
 * same brand mark used in `icon.svg`. iOS / iPadOS request this when
 * a user adds meethenri.com to their home screen.
 *
 * Why a separate route from icon.svg:
 *   - iOS doesn't render SVG favicons; needs a rasterized PNG with
 *     a solid background (transparency renders as black on home screen).
 *   - The 180×180 size is the modern iOS recommendation; older devices
 *     downscale gracefully.
 *   - Backgrounded the mark on `#FFFAF5` (the same warm-cream surface
 *     used elsewhere on the marketing site) so the home-screen icon
 *     reads as a brand asset, not a clipart bug.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FFFAF5",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          width="120"
          height="120"
          fill="none"
        >
          <circle cx="32" cy="32" r="29" stroke="#D4886A" strokeWidth="3" />
          <rect x="20" y="18" width="5" height="28" fill="#D4886A" />
          <rect x="35" y="18" width="5" height="28" fill="#D4886A" />
          <rect x="25" y="30" width="10" height="4" fill="#D4886A" />
          <circle cx="47" cy="44" r="3" fill="#D4886A" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
