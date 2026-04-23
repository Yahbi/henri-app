"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  content: string;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
}

const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, side = "top", children, ...props }, ref) => {
    const positionClasses: Record<string, string> = {
      top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
      bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
      left: "right-full top-1/2 -translate-y-1/2 mr-2",
      right: "left-full top-1/2 -translate-y-1/2 ml-2",
    };

    const arrowClasses: Record<string, string> = {
      top: "top-full left-1/2 -translate-x-1/2 border-t-popover border-x-transparent border-b-transparent",
      bottom:
        "bottom-full left-1/2 -translate-x-1/2 border-b-popover border-x-transparent border-t-transparent",
      left: "left-full top-1/2 -translate-y-1/2 border-l-popover border-y-transparent border-r-transparent",
      right:
        "right-full top-1/2 -translate-y-1/2 border-r-popover border-y-transparent border-l-transparent",
    };

    const tooltipId = React.useId();
    return (
      <div
        ref={ref}
        className={cn("relative inline-flex group", className)}
        aria-describedby={tooltipId}
        tabIndex={0}
        {...props}
      >
        {children}
        <div
          role="tooltip"
          id={tooltipId}
          className={cn(
            // Visible on hover, keyboard focus (focus-within), or long-press (touch).
            "pointer-events-none absolute z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200",
            positionClasses[side]
          )}
        >
          <div className="rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md border border-border whitespace-nowrap">
            {content}
          </div>
          <div
            className={cn(
              "absolute h-0 w-0 border-4",
              arrowClasses[side]
            )}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }
);
Tooltip.displayName = "Tooltip";

export { Tooltip };
