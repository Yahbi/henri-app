/**
 * Henri full logo lockup — mark + serif wordmark.
 *
 * Use this in nav bars and hero areas. Wraps in a Link by default
 * (pointing to "/"); pass `href={null}` to render as a static span,
 * useful inside a parent that already wraps a link (e.g. footer).
 *
 * The mark and wordmark both inherit `text-primary` (terracotta
 * `#D4886A` per brand rule). To invert on dark surfaces — like the
 * dashboard top bar or the OG image — wrap in a parent with
 * `text-background` or override via className.
 *
 * Layout:
 *   - mark size 28px (matches `text-xl` line-height) so the two glyphs
 *     sit on the same optical baseline without manual adjustment.
 *   - gap-2 (8px) — tighter than the default `gap-3` because the mark's
 *     stamp ring already creates breathing room around the wordmark.
 */

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { HenriMark } from "./HenriMark";

interface HenriLogoProps {
  /** Where the logo links. Pass `null` to render as a static span. Defaults to `/`. */
  href?: string | null;
  /** Add Tailwind classes to the outer wrapper (size, color, etc). */
  className?: string;
  /** Hide the icon mark, keep just the wordmark. Useful in tight footers. */
  wordmarkOnly?: boolean;
  /** Override mark size in pixels. Defaults to 28 (pairs with `text-xl`). */
  markSize?: number;
}

export function HenriLogo({
  href = "/",
  className,
  wordmarkOnly = false,
  markSize = 28,
}: HenriLogoProps) {
  const inner = (
    <>
      {!wordmarkOnly && <HenriMark size={markSize} title={false} />}
      <span className="font-heading text-xl font-medium tracking-tight">
        Henri.
      </span>
    </>
  );

  const wrapperClass = cn(
    "inline-flex items-center gap-2 text-primary",
    className,
  );

  if (href === null) {
    return <span className={wrapperClass}>{inner}</span>;
  }

  return (
    <Link href={href} aria-label="Henri home" className={wrapperClass}>
      {inner}
    </Link>
  );
}
