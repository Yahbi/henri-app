"use client";

import { GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * DrawerResizeHandle — the visible drag affordance for the lead drawer.
 *
 * Audit-04-29 priority D step 2: extracted from `LeadDetailDrawer.tsx` so
 * the visual handle is reusable across any future bottom-sheet drawer that
 * shares the `useDrawerResize` hook. JSX-only — all state lives in the hook.
 *
 * Pre-2026-04-27 the handle was a 40×4 pill with no hover state, no tooltip,
 * and no keyboard support — users couldn't tell the banner was resizable.
 * Now: 14px hit target, grip icon + always-visible label, primary-color
 * highlight on hover/focus, full keyboard support.
 *
 * The ARIA contract is `role="separator"` with `aria-valuenow/min/max` so
 * screen readers announce position; pair with `useDrawerResize.onKeyDown`
 * for the Arrow/Home/End/Enter handlers.
 */

interface DrawerResizeHandleProps {
  localHeight: number;
  parentMaxHeight: number;
  minHeight: number;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
}

export function DrawerResizeHandle({
  localHeight,
  parentMaxHeight,
  minHeight,
  onMouseDown,
  onDoubleClick,
  onKeyDown,
  ariaLabel = "Resize lead detail panel — drag, or use arrow keys",
}: DrawerResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-valuenow={localHeight}
      aria-valuemin={minHeight}
      aria-valuemax={parentMaxHeight}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to toggle · arrow keys also work"
      className={cn(
        "group flex justify-center items-center gap-2 py-3 cursor-row-resize select-none shrink-0 touch-none",
        "bg-bg-subtle/30 border-b border-border/40",
        "hover:bg-primary/10 hover:border-primary/30",
        "focus-visible:outline-none focus-visible:bg-primary/15 focus-visible:border-primary/50",
        "transition-colors",
      )}
    >
      <div
        className={cn(
          "h-1 w-12 rounded-full bg-primary/40",
          "group-hover:w-16 group-hover:bg-primary",
          "group-focus-visible:w-16 group-focus-visible:bg-primary",
          "transition-all",
        )}
      />
      <div className="flex items-center gap-1 text-[10px] font-medium text-foreground/70">
        <GripHorizontal className="h-3 w-3" />
        <span>Drag to resize</span>
      </div>
      <div
        className={cn(
          "h-1 w-12 rounded-full bg-primary/40",
          "group-hover:w-16 group-hover:bg-primary",
          "group-focus-visible:w-16 group-focus-visible:bg-primary",
          "transition-all",
        )}
      />
    </div>
  );
}
