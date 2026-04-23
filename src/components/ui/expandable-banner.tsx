"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

type Tone = "error" | "warning" | "info" | "success" | "storm";

const TONE_CLASSES: Record<Tone, string> = {
  error: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  info: "bg-primary/10 text-primary border-primary/30",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  storm: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40",
};

interface ExpandableBannerProps {
  /** Short line always visible. */
  title: ReactNode;
  /** Optional detail block revealed when expanded. */
  children?: ReactNode;
  /** Color/iconography tone. Defaults to "info". */
  tone?: Tone;
  /** Leading icon element (from lucide-react etc.). */
  icon?: ReactNode;
  /** If true, start expanded. Defaults to false. */
  defaultExpanded?: boolean;
  /** If true, render a dismiss "×" button. Defaults to false. */
  dismissible?: boolean;
  /** Callback when user clicks the dismiss button. */
  onDismiss?: () => void;
  /** Extra classes on the outer wrapper. */
  className?: string;
}

/**
 * A banner that always shows a single-line title and can expand/collapse to
 * reveal longer detail content. Used for the map error banner, storm-mode
 * banner, and any other inline-alert surface that needs more room than a
 * single line.
 *
 * Safe to mount standalone — no context or layout assumptions.
 */
export function ExpandableBanner({
  title,
  children,
  tone = "info",
  icon,
  defaultExpanded = false,
  dismissible = false,
  onDismiss,
  className,
}: ExpandableBannerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const hasDetails = !!children;
  const toneCls = TONE_CLASSES[tone];

  return (
    <div
      className={`border-b text-sm ${toneCls}${className ? ` ${className}` : ""}`}
      role={tone === "error" || tone === "storm" ? "alert" : "status"}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="flex-1 min-w-0 truncate">{title}</div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            className="shrink-0 p-1 rounded hover:bg-foreground/10 transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
        {dismissible && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              onDismiss?.();
            }}
            aria-label="Dismiss"
            className="shrink-0 p-1 rounded hover:bg-foreground/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {hasDetails && (
        <div
          // Keep content in the DOM and just toggle visibility via grid-rows
          // animation — no layout-thrashing mount/unmount on each toggle. This
          // also avoids forcing parent map canvases to resize while animating.
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          aria-hidden={!expanded}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 pt-0 border-t border-current/10 text-xs leading-relaxed">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
