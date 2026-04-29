"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Set to true to render the error state (destructive border + ring).
   *  When true we also wire `aria-invalid="true"` on the input so screen
   *  readers announce the invalid state, not just the visual change. */
  error?: boolean;
  /** Optional id of the element describing the error. When present the
   *  input gets `aria-errormessage` pointing to it AND `aria-describedby`
   *  so both axe-core and NVDA pick up the error text regardless of
   *  which ARIA attribute each interprets. Usage:
   *    <Input error errorMessageId="email-error" />
   *    <p id="email-error">Must be a valid email</p>
   */
  errorMessageId?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, errorMessageId, ...props }, ref) => {
    return (
      <input
        type={type}
        aria-invalid={error || undefined}
        aria-errormessage={error ? errorMessageId : undefined}
        aria-describedby={
          error
            ? [errorMessageId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined
            : props["aria-describedby"]
        }
        className={cn(
          // h-11 (44px) — matches Button md and meets WCAG 2.5.5 touch
          // target. Was h-10 (40px) until 2026-04-25; bumped to align with
          // Button's md size and unblock AA touch-target compliance across
          // every form in the app. The 4px delta has no visual impact in
          // dense forms because the type scale already uses text-sm + py-2.
          "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          error &&
            "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
