/**
 * Henri brand mark — circular permit-stamp glyph containing "H."
 *
 * The visual metaphor: every Henri lead originates in a permit, every
 * permit gets stamped by an authority. The stamp ring + offset period
 * encodes that bond at the brand level. The period inside the mark
 * mirrors the period in the wordmark `Henri.` — the dot is sacred.
 *
 * Design constraints:
 *   - Pure SVG paths (no <text>, no font dependency) — renders identically
 *     across browser raster engines and at every size, including favicons
 *     and external email clients that don't load custom fonts.
 *   - Single color via `currentColor` so callers can theme it via Tailwind
 *     `text-primary` / `text-foreground` / `text-background` etc.
 *   - 64x64 viewBox so a 16x16 favicon downsamples cleanly (4× supersampling).
 *
 * Usage:
 *   <HenriMark />                              // 24px, current text color
 *   <HenriMark size={48} className="text-primary" />
 *   <HenriMark size={32} title="Henri" />     // explicit alt text
 *   <HenriMark size={32} title={false} />      // decorative, paired with wordmark
 */

import { cn } from "@/lib/utils/cn";

interface HenriMarkProps {
  /** Rendered px width + height. Defaults to 24 (matches lucide-react icon size). */
  size?: number;
  className?: string;
  /**
   * Accessible name. Defaults to "Henri" when used standalone. Pass `false`
   * when the mark sits next to the visible wordmark — screenreaders shouldn't
   * announce it twice.
   */
  title?: string | false;
}

export function HenriMark({
  size = 24,
  className,
  title = "Henri",
}: HenriMarkProps) {
  const isDecorative = title === false;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={isDecorative ? "presentation" : "img"}
      aria-label={isDecorative ? undefined : (title as string)}
      aria-hidden={isDecorative || undefined}
      className={cn("inline-block", className)}
      fill="none"
    >
      {/* Stamp ring. Stroke-width 3 reads at all sizes; r=29 leaves
          enough negative space inside to keep the H. legible. */}
      <circle
        cx="32"
        cy="32"
        r="29"
        stroke="currentColor"
        strokeWidth="3"
      />
      {/* Letter H — left stem */}
      <rect x="20" y="18" width="5" height="28" fill="currentColor" />
      {/* Letter H — right stem */}
      <rect x="35" y="18" width="5" height="28" fill="currentColor" />
      {/* Letter H — crossbar (slightly above center for optical balance) */}
      <rect x="25" y="30" width="10" height="4" fill="currentColor" />
      {/* Brand period. Offset to the lower-right of the H so it visually
          completes the H. signature even at 16px. */}
      <circle cx="47" cy="44" r="3" fill="currentColor" />
    </svg>
  );
}
