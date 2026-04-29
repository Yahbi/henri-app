"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground shadow-sm",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        link: "text-primary underline-offset-4 hover:underline",
        // Use named shadow tokens (defined in globals.css `@theme inline`)
        // instead of arbitrary `shadow-[hsl(var(--primary)/X)]` values.
        // Same visual output; the arbitrary-value form trips a Tailwind
        // v4 + Turbopack 16.2.3 PostCSS parser bug.
        glow: "bg-primary text-primary-foreground shadow-glow-button hover:shadow-glow-button-hover hover:bg-primary/90",
      },
      size: {
        /* `sm` stays at h-8 (32px) for tight contexts — tables, filter
         * chips, inline lead-card actions — where the button is NOT the
         * only path to the action and 44px would destroy information
         * density. Only use sm in contexts that also expose the same
         * action via another 44px-or-larger affordance. */
        sm: "h-8 px-3 text-xs rounded-md",
        /* `md` bumped from h-10 (40px) → h-11 (44px) on 2026-04-23 to
         * meet WCAG 2.5.5 "Target Size (Enhanced)" + Apple HIG 44pt
         * minimum. Most primary CTAs on the app use this default size;
         * contractors use Henri on phones on job sites, so missed taps
         * are real. Padding bumped to px-5 so the click area scales
         * with the height (tallest-meets-widest).*/
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base rounded-md",
        /* Icon-only buttons — same 44px bump as md. Accessibility-first;
         * the trade-off is slightly chunkier icon clusters. */
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** When true, renders a spinner, disables clicks, and sets aria-busy. */
  loading?: boolean;
  /** Label announced to screen readers while loading. Defaults to "Loading". */
  loadingText?: string;
}

/** Inline spinner used by the Button when `loading` is true. */
function ButtonSpinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    // Slot can't reliably compose with the spinner + screen-reader wrappers,
    // so when `loading` is requested we always render a real <button>.
    const Comp = asChild && !loading ? Slot : "button";
    const isDisabled = disabled || loading;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        aria-busy={loading || undefined}
        disabled={isDisabled}
        {...props}
      >
        {loading ? (
          <>
            <ButtonSpinner />
            <span className="sr-only">{loadingText ?? "Loading"}</span>
            <span aria-hidden="true">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
