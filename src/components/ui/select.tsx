"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Set to true to render the error state. Also wires `aria-invalid`
   *  and (if provided) `aria-errormessage`. Same contract as Input. */
  error?: boolean;
  /** Optional id of the element describing the error. See Input for
   *  the wiring rationale — both ARIA attributes are set so axe-core
   *  and NVDA both pick up the error text. */
  errorMessageId?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, error, errorMessageId, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          aria-invalid={error || undefined}
          aria-errormessage={error ? errorMessageId : undefined}
          aria-describedby={
            error
              ? [errorMessageId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined
              : props["aria-describedby"]
          }
          className={cn(
            // h-11 (44px) — matches Input + Button md and meets WCAG 2.5.5
            // touch target. See the corresponding note in input.tsx.
            "flex h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            error &&
              "border-destructive focus-visible:ring-destructive",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
