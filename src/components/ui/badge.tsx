"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/* Badge variants. Tint-on-tone pattern: each semantic variant renders as
 * a ~12% opacity background of the foreground color, yielding a "soft
 * pill" look without needing a separate border. Values reference CSS
 * vars (`--success`, `--warning`, `--hot`, `--warm`, `--cool`) so
 * theme-switching and brand-color updates propagate automatically.
 *
 * On the `cold` variant name: kept as-is despite the --cool color
 * token, because "cold/warm/hot" is the industry-standard sales
 * vocabulary for lead temperature (cold = low-interest, warm = some
 * interest, hot = actively shopping). The color token uses `--cool`
 * because it's a color (blue), but the BADGE name reflects the
 * underlying semantic. Consumers in `leads/page.tsx` and
 * `leads/[id]/page.tsx` type urgency as `"cold"` and pass it straight
 * through — matching that convention is more valuable than
 * token-name consistency. See the design-system audit (2026-04-23)
 * discussion.
 *
 * Note on `destructive` vs Toast `error`: Badge describes an ACTION
 * intent ("delete this", "this cannot be undone"), Toast describes an
 * OUTCOME ("save failed"). They render with the same --destructive
 * token but the names stay separate to match their semantics. See
 * the corresponding note in src/components/ui/toast.tsx. */
const badgeVariants = cva(
  // focus-visible (not :focus) — every other primitive (Button, Input,
  // Select, Dialog) uses :focus-visible so the ring only renders when the
  // user reached this element via keyboard, not on every click. Was :focus
  // until 2026-04-25; switched for cross-primitive consistency.
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground border-border",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        /* Tint-on-tone variants — use `/15` opacity against the token
         * colour so the background reads as a soft pill in any theme.
         * `text-[hsl(var(--X))]` is required (not `text-X`) because the
         * `--success / --warning` tokens are raw HSL triplets and need
         * the hsl() wrapper to materialise as a colour. */
        success:
          "border-transparent bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]",
        warning:
          "border-transparent bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]",
        hot:
          "border-transparent bg-[color-mix(in_srgb,var(--hot)_12%,transparent)] text-[var(--hot)]",
        warm:
          "border-transparent bg-[color-mix(in_srgb,var(--warm)_12%,transparent)] text-[var(--warm)]",
        /* `cold` renders using the --cool color token. See the big
         * comment above for why the names differ. */
        cold:
          "border-transparent bg-[color-mix(in_srgb,var(--cool)_12%,transparent)] text-[var(--cool)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
