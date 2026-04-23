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

        {/* Brand name */}
        <div
          style={{
            fontSize: 96,
            fontFamily: "Georgia, serif",
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          Henri.
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
            henri.app
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
