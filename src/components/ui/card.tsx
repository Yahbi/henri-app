"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Card variants:
 * - `default`: opaque card background + 1px border + subtle shadow.
 *   The workhorse. Use on dashboard panels, settings sections, every
 *   page-level block that needs a visual boundary.
 * - `elevated`: same background, no border, stronger shadow. Use when
 *   the card is floating above content (e.g. a context menu surface,
 *   modal preview, or stat card that needs prominence).
 * - `translucent`: semi-opaque background + backdrop-blur. Use on
 *   overlays over hero imagery where the content beneath should still
 *   read through. Renamed from `glass` on 2026-04-23 — `glass` was
 *   idiomatic but opaque to newcomers.
 * - `bordered`: transparent background + 2px border. Use for empty
 *   states and tabular summaries where the card is a grouping device
 *   rather than a visual surface.
 * - `gradient`: soft terracotta-to-accent gradient. Reserve for
 *   emphasis moments (featured pricing card, "what's new" tile).
 */
/* Shadow tokens used here:
 *   `shadow-card`           — default Card depth (raw value lives in
 *                             globals.css `--shadow-card`).
 *   `shadow-card-elevated`  — `elevated` variant: stronger drop shadow
 *                             for floating surfaces (context menus,
 *                             featured stat cards).
 *   `shadow-card-hover`     — interactive hover lift; only applied when
 *                             `hover={true}` is passed.
 *
 * Was `shadow-sm` / `shadow-lg` / `hover:shadow-md` (Tailwind defaults)
 * until the 2026-04-25 design-system audit. Switching to semantic tokens
 * means future depth tuning happens in one place (globals.css) instead
 * of touching every Card consumer. */
const cardVariants = cva("rounded-xl text-card-foreground", {
  variants: {
    variant: {
      default: "bg-card border border-border shadow-card",
      elevated: "bg-card shadow-card-elevated",
      translucent: "bg-card/80 backdrop-blur-sm border border-border",
      bordered: "bg-transparent border-2 border-border",
      gradient:
        "bg-gradient-to-br from-primary/10 to-accent/10 border border-border",
    },
    hover: {
      true: "hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    hover: false,
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, hover, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, hover, className }))}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-heading text-2xl font-normal leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardVariants,
};
