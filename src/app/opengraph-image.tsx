import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Henri. — AI-Powered Contractor Marketplace";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0A0A0A",
          position: "relative",
        }}
      >
        {/* Accent bar at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "6px",
            backgroundColor: "#D4886A",
          }}
        />

        {/* Brand mark + wordmark lockup. The mark is the same SVG
            geometry as `icon.svg` and `apple-icon.tsx` — a circular
            stamp containing "H." Brand consistency: every surface
            shows the same glyph at proportional size. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            color: "#D4886A",
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
          <div
            style={{
              fontSize: 128,
              fontFamily: "Georgia, serif",
              color: "#FFFFFF",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            Henri.
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            fontFamily: "sans-serif",
            color: "#D4886A",
            marginTop: 24,
            letterSpacing: "0.05em",
          }}
        >
          AI-Powered Contractor Marketplace
        </div>

        {/* Subtle bottom accent */}
        <div
          style={{
            position: "absolute",
            bottom: 48,
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: 40,
              height: 2,
              backgroundColor: "#D4886A",
              opacity: 0.6,
            }}
          />
          <div
            style={{
              fontSize: 16,
              fontFamily: "sans-serif",
              color: "#666666",
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
            }}
          >
            meethenri.com
          </div>
          <div
            style={{
              width: 40,
              height: 2,
              backgroundColor: "#D4886A",
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
