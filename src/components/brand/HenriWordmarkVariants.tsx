/**
 * Twelve wordmark iterations — type-led, set in Fraunces (the platform
 * heading font), in the brand terracotta.
 *
 * Each variant is one disciplined typographic move applied to the
 * wordmark. No icons, no enclosures, no decoration — just type.
 *
 * The constraint is intentional: most premium brands in adjacent
 * categories (Aman, Soho House, Ritz-Carlton, Glossier, Casper,
 * Outdoor Voices, Equinox) ship a wordmark, not a mark + lockup. The
 * mark is what survives at small sizes; the wordmark is what carries
 * the meaning.
 *
 * Sizing is decoupled — every variant accepts a `size` prop in pixels
 * (default 56). At lockdown the chosen variant gets traced to outlines
 * for the favicon / OG / iOS icon paths so it doesn't depend on the
 * webfont loading.
 *
 * Color is inheritance-based — the variants use `text-primary` from
 * Tailwind by default, which resolves to the brand terracotta via the
 * CSS variable. Variant N (two-tone) deliberately fixes its second
 * span to `text-primary` so the split survives any parent override.
 *
 * Twelve concepts:
 *
 *   K — Stripped — the wordmark with no embellishment (control)
 *   L — Disc period — period replaced with an oversized brand-color disc
 *   M — Hairline ring — period replaced with a thin open ring
 *   N — Two-tone "i." — last two glyphs in terracotta, the rest in foreground
 *   O — Italic — the entire wordmark set in Fraunces italic
 *   P — Wide caps — HENRI . with architectural letter-spacing
 *   Q — Masthead — wordmark stacked over a tracked-caps tagline
 *   R — Monogram — H. only, no further name
 *   S — Em-dash — Henri — for contractors. (lockup with the wedge)
 *   T — Vertical totem — letters stacked into a column
 *   U — Bracketed — [Henri.] (code / syntax aesthetic)
 *   V — Quoted — "Henri." (curly typographic quotes frame the name)
 */

import { cn } from "@/lib/utils/cn";

interface WordmarkProps {
  /** Pixel size of the dominant glyph. Default 56. */
  size?: number;
  className?: string;
}

const HERO_SIZE = 56;

function baseStyle(size: number) {
  return { fontSize: `${size}px`, lineHeight: 1 } as const;
}

/**
 * VARIANT K — Stripped wordmark (control).
 *
 * The wordmark with no embellishment, no enclosure, no color trick.
 * Sets the floor — every other variant has to earn its complexity
 * against this baseline.
 */
export function WordmarkK({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      Henri.
    </span>
  );
}

/**
 * VARIANT L — Disc period.
 *
 * The typographic period is replaced with an oversized terracotta
 * filled disc. The disc reads as a graphic mark while the rest of the
 * word stays as type. Pentagram-style move; lots of premium brands
 * (Glossier, Diptyque variations) use this trick.
 */
export function WordmarkL({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      Henri
      <span
        aria-hidden
        className="ml-[0.04em] inline-block rounded-full"
        style={{
          width: "0.18em",
          height: "0.18em",
          marginBottom: "0.04em",
          backgroundColor: "currentColor",
        }}
      />
    </span>
  );
}

/**
 * VARIANT M — Hairline ring period.
 *
 * The period is a thin open ring instead of a filled dot. Reads more
 * editorial / refined than Variant L's solid disc. Magazine-masthead
 * energy.
 */
export function WordmarkM({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      Henri
      <span
        aria-hidden
        className="ml-[0.06em] inline-block rounded-full"
        style={{
          width: "0.22em",
          height: "0.22em",
          marginBottom: "0.04em",
          border: "0.04em solid currentColor",
        }}
      />
    </span>
  );
}

/**
 * VARIANT N — Two-tone "i."
 *
 * "Henr" sits in the foreground color (deep ink); "i." flips to
 * terracotta. The terminal "i." becomes the ownable element — a brand
 * signature that carries even when the rest of the word is set in body
 * type.
 */
export function WordmarkN({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-foreground",
        className,
      )}
      style={baseStyle(size)}
    >
      Henr<span className="text-primary">i.</span>
    </span>
  );
}

/**
 * VARIANT O — Full italic.
 *
 * The wordmark set entirely in Fraunces italic. Fraunces' italic is
 * particularly distinctive — pronounced softness in the terminals,
 * almost calligraphic. Reads as "spoken," personal, signature-feeling.
 */
export function WordmarkO({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium italic tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      Henri.
    </span>
  );
}

/**
 * VARIANT P — Wide caps.
 *
 * "HENRI." set in Fraunces all-caps with architectural letter-spacing.
 * Reads as serious, credentialed, masthead. Loses the friendly
 * lowercase but gains gravitas.
 */
export function WordmarkP({ size = HERO_SIZE * 0.82, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium uppercase text-primary",
        className,
      )}
      style={{ ...baseStyle(size), letterSpacing: "0.18em" }}
    >
      Henri.
    </span>
  );
}

/**
 * VARIANT Q — Masthead lockup.
 *
 * "Henri." in serif over a tiny tracked-caps positioning line. Reads
 * like a magazine masthead or premium hospitality lockup. The tagline
 * is swappable at lockdown.
 */
export function WordmarkQ({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn("inline-flex flex-col items-center text-primary", className)}
    >
      <span
        className="font-heading font-medium tracking-tight"
        style={baseStyle(size)}
      >
        Henri.
      </span>
      <span
        className="mt-2 font-semibold uppercase text-muted-foreground"
        style={{
          fontSize: `${Math.max(size * 0.16, 10)}px`,
          letterSpacing: "0.36em",
          paddingLeft: "0.36em",
        }}
      >
        Permits · Contractors · Scored
      </span>
    </span>
  );
}

/**
 * VARIANT R — H. monogram only.
 *
 * Drops "enri" entirely. The icon-and-wordmark-in-one is just "H."
 * Big bold call — works only if the brand has enough surface area
 * elsewhere to spell the full name. Aman / Apple / IBM territory.
 */
export function WordmarkR({ size = HERO_SIZE * 1.4, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      H.
    </span>
  );
}

/**
 * VARIANT S — Em-dash lockup.
 *
 * "Henri — for contractors." The em-dash anchors a positioning line as
 * part of the mark itself. Reads as both name and statement of intent.
 * Risk: locks the brand to a specific audience phrase.
 */
export function WordmarkS({ size = HERO_SIZE * 0.62, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      Henri — for contractors.
    </span>
  );
}

/**
 * VARIANT T — Vertical totem.
 *
 * Letters stacked into a single-column tower. Reads as architectural,
 * monumental — a column of Henri. Most unconventional of the twelve;
 * reserves the horizontal wordmark for body copy and lets the totem be
 * the icon.
 */
export function WordmarkT({ size = HERO_SIZE * 0.55, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={{ ...baseStyle(size), lineHeight: 0.92 }}
    >
      <span>H</span>
      <span>e</span>
      <span>n</span>
      <span>r</span>
      <span>i</span>
      <span>.</span>
    </span>
  );
}

/**
 * VARIANT U — Square brackets.
 *
 * "[Henri.]" — references the AI prompt / code-template aesthetic.
 * Reads as modern, sharp, technical. Distinct from any common
 * marketplace logo because the brackets are part of the typographic
 * mark, not a container.
 */
export function WordmarkU({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      [Henri.]
    </span>
  );
}

/**
 * VARIANT V — Curly-quoted.
 *
 * Wraps the wordmark in proper typographic curly double quotes. Reads
 * as "the named thing" — a nod to brand-as-person, the curated voice,
 * the pull-quote on a magazine cover.
 */
export function WordmarkV({ size = HERO_SIZE, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      “Henri.”
    </span>
  );
}

/**
 * VARIANT Z — Stamp + "meet Henri." lockup.
 *
 * The W stamp (H. inside a heavy ring) on top, "meet Henri." centered
 * directly beneath it. Same brand pattern as the Aphex Twin sleeve —
 * the symbol on top, a typographic label below, both reading as one
 * unit. The tagline uses the same italic-then-upright Y move so the
 * lockup carries one consistent voice.
 *
 * Composition rules:
 *   - Tagline width and stamp diameter are NOT yoked. The stamp is
 *     centered, the tagline is centered, and they share a vertical
 *     axis. Tagline length doesn't change the stamp's size.
 *   - Tagline font-size = 18% of stamp diameter. At stamp=200, tagline
 *     is 36px — large enough to be the brand name, small enough to be
 *     subordinate to the stamp.
 *   - Vertical gap = 12% of stamp diameter. Tight enough to read as
 *     a lockup, loose enough that the stamp doesn't crowd the type.
 *
 * Tradeoffs:
 *   + Most complete brand asset of all variants — works as a logo,
 *     a wordmark, and a positioning statement in one composition.
 *   + Two-element lockup is the gold-standard premium-brand pattern
 *     (Aman, Ralph Lauren, Soho House — every premium hospitality /
 *     lifestyle brand uses this exact structure).
 *   - Vertical real estate — needs taller surfaces than W or Y alone.
 *     Doesn't fit horizontal nav contexts; for those, fall back to W
 *     standalone.
 *   - Two distinct typographic acts (stamp + wordmark) means more
 *     things to keep tuned across surfaces.
 */
export function WordmarkZ({ size = 200, className }: WordmarkProps) {
  const taglineSize = size * 0.18;
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center text-primary",
        className,
      )}
    >
      <WordmarkW size={size} />
      <span
        className="font-heading font-medium tracking-tight"
        style={{
          fontSize: taglineSize,
          lineHeight: 1,
          marginTop: `${size * 0.12}px`,
        }}
      >
        <span className="italic">meet</span> Henri.
      </span>
    </span>
  );
}

/**
 * VARIANT Y — "meet Henri." wordmark.
 *
 * The full call-to-action set as a single-line wordmark in Fraunces.
 * "meet" is italic, "Henri." is upright — the italic→upright pivot
 * lets the brand name carry the weight while "meet" reads as a soft
 * preamble. Same brand terracotta, same heading face, no enclosure.
 *
 * Variant K is "Henri." alone; this one earns its existence by
 * encoding the brand's call-to-action (meethenri.com) directly into
 * the wordmark. The italic "meet" is what makes it a logo and not
 * just two words run together — the hierarchy is built into the type.
 *
 * Tradeoffs:
 *   + Encodes the domain directly; the wordmark IS the ask
 *   + Italic-then-upright is a classic editorial move (think NYT
 *     section heads, FT pull-quotes) — unmistakably typographic
 *   - Longer than "Henri." so it doesn't survive at favicon scale
 *   - Locks the brand to "meet Henri" phrasing; future copy that uses
 *     "Henri" alone reads inconsistent against this lockup
 */
export function WordmarkY({ size = HERO_SIZE * 0.78, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading font-medium tracking-tight text-primary",
        className,
      )}
      style={baseStyle(size)}
    >
      <span className="italic">meet</span> Henri.
    </span>
  );
}

/**
 * VARIANT X — Stamp ring with "meet Henri" inscription.
 *
 * Same heavy ring + Fraunces typography as W, but the inscription is
 * the brand's call-to-action: "meet" italic curved along the top
 * inside the ring, "Henri." centered horizontally as the dominant
 * glyph. Reads like a notary seal — context phrase along the
 * perimeter, primary mark in the center.
 *
 * The whole composition is SVG (not HTML/CSS) because curved text
 * requires <textPath>, which CSS doesn't natively support. Same
 * Fraunces font-family is used; in Next.js context the webfont loads
 * via next/font, so the SVG inherits the platform's exact serif.
 *
 * Geometry:
 *   - Ring: 5% of diameter as stroke weight (matches W exactly)
 *   - "meet" arc radius: 82% of the ring's inner radius — text sits
 *     just inside the ring, leaving a small margin to breathe
 *   - "meet" font-size: 8.5% of diameter, italic, 1.8% letter-spacing
 *   - "Henri.": 28% of diameter, regular weight, optical centering
 *     pushes baseline to 62.5% of diameter (visual midpoint of cap
 *     height aligns with geometric center)
 *
 * Default size 200 — pass `size={n}` to scale linearly. Below ~120px
 * the curved "meet" inscription becomes hard to read; for favicon /
 * tiny nav usage the W variant (just H.) carries better.
 *
 * Tradeoffs:
 *   + Most "branded" of any variant — unmistakably a logo, not a
 *     wordmark. The notary-seal arrangement is institutional.
 *   + Encodes the brand call-to-action (meethenri.com) directly into
 *     the mark.
 *   - Doesn't survive small sizes — sub-200px the inscription crushes.
 *     Pair with W as a small-format fallback.
 *   - Curved text in SVG can render slightly differently across
 *     engines; PNG renders should be authoritative.
 */
export function WordmarkX({ size = 200, className }: WordmarkProps) {
  const stroke = size <= 24 ? 1.5 : size * 0.05;
  const ringRadius = size / 2 - stroke / 2;
  const meetArcRadius = (size / 2 - stroke) * 0.82;
  const arcLeftX = size / 2 - meetArcRadius;
  const arcRightX = size / 2 + meetArcRadius;
  const arcY = size / 2;
  const arcId = `meet-arc-${size}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={cn("inline-block text-primary", className)}
      role="img"
      aria-label="meet Henri"
    >
      <defs>
        <path
          id={arcId}
          d={`M ${arcLeftX} ${arcY} A ${meetArcRadius} ${meetArcRadius} 0 0 1 ${arcRightX} ${arcY}`}
          fill="none"
        />
      </defs>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={ringRadius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <text
        fontFamily="Fraunces, serif"
        fontWeight="500"
        fontStyle="italic"
        fontSize={size * 0.085}
        fill="currentColor"
        letterSpacing={size * 0.018}
      >
        <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
          meet
        </textPath>
      </text>
      <text
        x={size / 2}
        y={size * 0.625}
        textAnchor="middle"
        fontFamily="Fraunces, serif"
        fontWeight="500"
        fontSize={size * 0.28}
        fill="currentColor"
        letterSpacing={-size * 0.005}
      >
        Henri.
      </text>
    </svg>
  );
}

/**
 * VARIANT W — Stamp ring (Aphex-style monogram).
 *
 * "H" set in Fraunces, perfectly centered inside a single heavy
 * circular ring; the period dot lives INSIDE the same ring, anchored
 * to the right of the H at the H's baseline. The H is the geometric
 * center anchor; the period is a typographic accent that floats off
 * to its right inside the same negative space.
 *
 * Why H is the anchor (not "H."):
 *   - With "H." centered, the period drags visual weight to the right
 *     and the whole pair sits crooked relative to the ring's center.
 *     Either the H. is geometrically centered (looks visually offset)
 *     or optically centered (looks crooked when measured).
 *   - With H alone as the centered glyph and the period absolutely
 *     positioned to its right, the H stays anchored at the ring's
 *     dead center while the period extends outward as a typographic
 *     accent. The mark reads as a stamped glyph followed by its
 *     signature punctuation — both inside the same stamp.
 *
 * Geometry:
 *   - Ring: 5% of the diameter as stroke weight (heavy, declarative).
 *     Clamps to a 1.5px minimum so it stays visible at favicon size.
 *   - H inside: 55% of the diameter (cap height fills ~38% of the
 *     diameter, leaving generous margin between the type and the ring).
 *   - Period: positioned absolutely at the right edge of the H's
 *     own bounding box, at the H's baseline. Sits inside the ring's
 *     negative space, well clear of the right-side stroke.
 *
 * Default size 150 — pass `size={n}` to scale linearly for other
 * surfaces (favicon, nav badge, OG card).
 *
 * Tradeoffs:
 *   + Most "branded asset" of all variants — reads as a logo, not a
 *     wordmark. Pairs cleanly with the full "Henri." wordmark.
 *   + The H is anchored at the ring's geometric center; the period
 *     extends without disturbing that anchor. Best of both readings.
 *   + Period dot keeps the brand's signature glyph inside the mark.
 *   - Letter-in-circle is a common pattern; ownability lives in the
 *     ring weight, the H's centering discipline, and the period's
 *     relationship to the H rather than the ring.
 *   - At favicon size, the period may visually fuse with the right
 *     side of the H — tune the period weight if it disappears.
 */
export function WordmarkW({ size = 150, className }: WordmarkProps) {
  const stroke = size <= 24 ? 1.5 : size * 0.05;
  const innerSize = size * 0.55;
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center text-primary",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${stroke}px solid currentColor`,
      }}
    >
      <span className="relative inline-block">
        <span
          className="font-heading font-medium tracking-tight"
          style={{
            fontSize: innerSize,
            lineHeight: 1,
          }}
        >
          H
        </span>
        <span
          aria-hidden
          className="absolute font-heading font-medium"
          style={{
            left: "100%",
            bottom: 0,
            fontSize: innerSize,
            lineHeight: 1,
            marginLeft: `${innerSize * 0.05}px`,
          }}
        >
          .
        </span>
      </span>
    </span>
  );
}
