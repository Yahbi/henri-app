/**
 * Ten logo iterations to evaluate before locking the Henri brand mark.
 *
 * All variants:
 *   - Use `currentColor` so callers theme via Tailwind (`text-primary`,
 *     `text-foreground`, etc.). The brand color #D4886A is the default
 *     against light surfaces; on dark surfaces the parent flips to a
 *     warm cream and the mark inverts cleanly.
 *   - Share the same 64×64 viewBox so they downsample to the same
 *     16×16 favicon pixel grid without any reflow.
 *   - Render purely with primitive SVG paths/shapes — no <text> elements
 *     — so the raster engine doesn't have to load a webfont before the
 *     glyph appears. This matters for OG image generation (`next/og`)
 *     and for the 16×16 favicon where antialiased font hinting often
 *     produces fuzzy results.
 *
 * Ten concepts span different brand metaphors so the choice is about
 * positioning, not just aesthetics:
 *
 *   Batch 1 — letter-inside-a-shape:
 *     A — Permit stamp — official, registered, authoritative
 *     B — Foundation block — architectural, structural, solid
 *     C — Concierge card — handover, white-glove introduction
 *     D — Match compass — homeowner-to-contractor routing
 *     E — Roof pitch — direct trade signal, housing-first
 *
 *   Batch 2 — type-first / metaphor-first:
 *     F — Lowercase h. — pure typographic, no enclosure
 *     G — Address pin — geographic / territory anchor
 *     H — Speech bubble — AI concierge / conversational
 *     I — Notary seal — bespoke, double-ringed, ceremonial
 *     J — Oversized period — the period IS the brand mark
 */

import { cn } from "@/lib/utils/cn";

interface VariantProps {
  size?: number;
  className?: string;
  title?: string | false;
}

function svgProps({ size = 24, className, title = "Henri" }: VariantProps) {
  const isDecorative = title === false;
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 64 64",
    width: size,
    height: size,
    role: isDecorative ? ("presentation" as const) : ("img" as const),
    "aria-label": isDecorative ? undefined : (title as string),
    "aria-hidden": isDecorative || undefined,
    className: cn("inline-block", className),
    fill: "none" as const,
  };
}

/**
 * VARIANT A — Permit Stamp
 *
 * Circular stamp ring with a serif-inspired geometric "H." inside.
 * Reads as "officially registered." The period dot sits offset to the
 * lower-right so it echoes a notary's dating mark rather than a
 * decorative flourish. Most institutional of the five.
 *
 * Tradeoffs:
 *   + Reinforces the wedge contract — exclusivity, stamped-and-claimed
 *   + Distinct silhouette at 16×16 (the ring survives downsample)
 *   - Circle-with-letter is a common logo pattern; not stylistically
 *     unique without the period
 */
export function VariantA(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="3" />
      <rect x="20" y="18" width="5" height="28" fill="currentColor" />
      <rect x="35" y="18" width="5" height="28" fill="currentColor" />
      <rect x="25" y="30" width="10" height="4" fill="currentColor" />
      <circle cx="47" cy="44" r="3" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT B — Foundation Block
 *
 * A rounded square fully filled in brand color, with a crisp white "H"
 * carved out in negative space and a small white period dot in the
 * lower-right. Reads as a piece of infrastructure — a permit document,
 * a building block, a stamped certification.
 *
 * Tradeoffs:
 *   + High contrast — the most visible at small sizes
 *   + Most "app icon"-like; reads cleanly on iOS home screen
 *   - Heavier ink coverage than the others; can feel corporate
 */
export function VariantB(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="4" y="4" width="56" height="56" rx="10" fill="currentColor" />
      <rect x="20" y="18" width="5" height="28" fill="white" />
      <rect x="35" y="18" width="5" height="28" fill="white" />
      <rect x="25" y="30" width="10" height="4" fill="white" />
      <circle cx="47" cy="44" r="3" fill="white" />
    </svg>
  );
}

/**
 * VARIANT C — Concierge Card
 *
 * Two stacked rounded rectangles — a tinted background card offset
 * behind a sharply outlined front card — with the geometric "H." inside
 * the front card. Reads as "handover" / "introduction" — the contractor
 * receives a card from Henri.
 *
 * Tradeoffs:
 *   + Encodes the AI-concierge positioning directly into the mark
 *   + Visually distinct from any common SaaS logo template
 *   - More moving parts; the offset shadow effect can muddy at 16×16
 */
export function VariantC(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <rect
        x="10"
        y="14"
        width="40"
        height="44"
        rx="4"
        fill="currentColor"
        opacity="0.25"
      />
      <rect
        x="14"
        y="10"
        width="40"
        height="44"
        rx="4"
        stroke="currentColor"
        strokeWidth="3"
      />
      <rect x="22" y="20" width="4" height="24" fill="currentColor" />
      <rect x="42" y="20" width="4" height="24" fill="currentColor" />
      <rect x="26" y="30" width="16" height="4" fill="currentColor" />
      <circle cx="48" cy="46" r="2.5" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT D — Match Compass
 *
 * A circular boundary with an upward-right arrow inside; a small period
 * dot sits in the lower-left as a counterweight. Reads as routing /
 * matchmaking — homeowner ZIP routed to contractor territory.
 *
 * Tradeoffs:
 *   + Encodes the marketplace metaphor (matched, routed, directed)
 *   + Reads strongly even at 16×16 because the arrow is a single shape
 *   - Less obviously "Henri" — could be any matchmaking product;
 *     drops the H. monogram entirely
 */
export function VariantD(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="3" />
      <path
        d="M20 44 L44 20"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M32 20 L44 20 L44 32"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="46" r="2.5" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT E — Roof Pitch
 *
 * A pitched roof line forms the top of the mark; two vertical posts
 * drop from the eaves (the "H" stems become house pillars); a crossbar
 * bridges them at mid-height; a period dot sits grounded near the
 * baseline. Reads as housing-trade direct.
 *
 * Tradeoffs:
 *   + Most explicit trade signal — a contractor sees it and immediately
 *     knows the audience
 *   + The H is preserved through the pillar/crossbar geometry
 *   - Risks anchoring the brand to roofing specifically; long-term
 *     Henri may want to grow beyond exterior trades
 */
export function VariantE(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <path
        d="M6 30 L32 10 L58 30"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="20" y="28" width="5" height="24" fill="currentColor" />
      <rect x="35" y="28" width="5" height="24" fill="currentColor" />
      <rect x="25" y="38" width="10" height="4" fill="currentColor" />
      <circle cx="47" cy="50" r="3" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT F — Lowercase h.
 *
 * Pure typographic mark. A geometric lowercase "h" with a proportional
 * period dot. No circle, no square, no enclosure — the letterform IS
 * the logo. Reads as understated, type-first, editorial.
 *
 * Tradeoffs:
 *   + Most flexible; pairs with any background, any size
 *   + Distinct because most competitors over-decorate
 *   - Less iconic at favicon size — the silhouette is just a glyph
 *   - Easier to confuse with body type
 */
export function VariantF(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      {/* tall left stem */}
      <rect x="18" y="10" width="5" height="44" fill="currentColor" />
      {/* lower-half right stem (the bowl of the lowercase h) */}
      <rect x="33" y="26" width="5" height="28" fill="currentColor" />
      {/* crossbar connecting the stem to the bowl */}
      <rect x="23" y="26" width="10" height="4" fill="currentColor" />
      {/* period dot at the baseline, sized to match a normal-weight period */}
      <circle cx="46" cy="51" r="3" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT G — Address Pin
 *
 * A teardrop map pin with the geometric H. monogram inside the bulge.
 * Reads as geographic — Henri claims a contractor for this territory,
 * this ZIP, this address. The mark is the deed.
 *
 * Tradeoffs:
 *   + Encodes the territory model directly into the mark
 *   + Recognizably "location" at any size
 *   - Map-pin shape is a common pattern in marketplace logos
 *   - The H. has to live in the bulge, leaving the point empty
 */
export function VariantG(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <path
        d="M32 4 C18 4 8 14 8 26 C8 38 32 60 32 60 C32 60 56 38 56 26 C56 14 46 4 32 4 Z"
        stroke="currentColor"
        strokeWidth="3"
      />
      <rect x="22" y="14" width="4" height="22" fill="currentColor" />
      <rect x="38" y="14" width="4" height="22" fill="currentColor" />
      <rect x="26" y="22" width="12" height="4" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT H — Speech Bubble
 *
 * A rounded chat bubble with a tail dropping from the lower-left, and
 * the geometric H. inside. Reads as conversation — Henri is the AI
 * concierge that talks to homeowners and routes the brief.
 *
 * Tradeoffs:
 *   + Encodes the AI-concierge positioning (the homeowner-facing wedge)
 *   + Distinct from any common contractor / trades logo
 *   - The tail breaks the silhouette at small sizes
 *   - Conversational metaphor may de-emphasize the contractor surface
 */
export function VariantH(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <path
        d="M12 8 H52 A8 8 0 0 1 60 16 V36 A8 8 0 0 1 52 44 H22 L16 56 L18 44 H12 A8 8 0 0 1 4 36 V16 A8 8 0 0 1 12 8 Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect x="20" y="18" width="4" height="18" fill="currentColor" />
      <rect x="36" y="18" width="4" height="18" fill="currentColor" />
      <rect x="24" y="24" width="12" height="4" fill="currentColor" />
      <circle cx="44" cy="34" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT I — Notary Seal
 *
 * Two concentric rings with eight evenly spaced dots between them, like
 * a notary's wax seal or a state-issued certificate stamp. The H. sits
 * in the center. Reads as bespoke, ceremonial, more textured than a
 * plain stamp.
 *
 * Tradeoffs:
 *   + Most ceremonial — the ring of dots reads like an official seal
 *   + Conveys "verified" without using a checkmark
 *   - Heavier visual weight than Variant A
 *   - The 8 dots can flatten into a continuous ring at 16×16
 */
export function VariantI(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="2" />
      {/* 8 dots evenly spaced between the rings (radius ~25.5) */}
      <circle cx="57.5" cy="32" r="1.5" fill="currentColor" />
      <circle cx="50" cy="14" r="1.5" fill="currentColor" />
      <circle cx="32" cy="6.5" r="1.5" fill="currentColor" />
      <circle cx="14" cy="14" r="1.5" fill="currentColor" />
      <circle cx="6.5" cy="32" r="1.5" fill="currentColor" />
      <circle cx="14" cy="50" r="1.5" fill="currentColor" />
      <circle cx="32" cy="57.5" r="1.5" fill="currentColor" />
      <circle cx="50" cy="50" r="1.5" fill="currentColor" />
      {/* H. inside */}
      <rect x="22" y="22" width="4" height="20" fill="currentColor" />
      <rect x="38" y="22" width="4" height="20" fill="currentColor" />
      <rect x="26" y="30" width="12" height="4" fill="currentColor" />
      <circle cx="44" cy="40" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * VARIANT J — Oversized Period
 *
 * A small, restrained "h" tucked to the upper-left, dwarfed by an
 * oversized brand-color disc that occupies the lower-right — the
 * period IS the mark. Pushes the brand's signature punctuation to the
 * extreme.
 *
 * Tradeoffs:
 *   + Most distinctive silhouette of all ten — nothing else looks like it
 *   + The period (Henri's signature glyph) becomes the brand
 *   - The "h" is barely legible at 16×16; the dot dominates entirely
 *   - High concept; some viewers will read it as "just a dot"
 */
export function VariantJ(props: VariantProps) {
  return (
    <svg {...svgProps(props)}>
      {/* small lowercase h, tucked top-left */}
      <rect x="10" y="12" width="3" height="32" fill="currentColor" />
      <rect x="22" y="24" width="3" height="20" fill="currentColor" />
      <rect x="13" y="24" width="9" height="3" fill="currentColor" />
      {/* OVERSIZED period — the brand mark */}
      <circle cx="46" cy="46" r="12" fill="currentColor" />
    </svg>
  );
}
