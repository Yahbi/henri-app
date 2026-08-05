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
 * for the Arrow/Home/End/Enter handlers. Up/Down (not Left/Right) are the
 * correct keys here: APG's window-splitter pattern binds the axis the
 * splitter MOVES along, and a horizontal separator moves vertically.
 *
 * Drag runs on pointer events, so the always-visible "Drag to resize"
 * label is honest on touch and pen too — it used to be mouse-only while
 * `touch-none` advertised a gesture nothing listened for. `touch-none` is
 * load-bearing for that: without it the browser claims a touch-drag as a
 * scroll and fires pointercancel before the first move lands.
 */

type StartDrag = (e: React.PointerEvent<HTMLDivElement>) => void;

interface DrawerResizeHandleBaseProps {
  localHeight: number;
  parentMaxHeight: number;
  minHeight: number;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
}

/* The drag starter is required, but `LeadDetailDrawer` still passes it as
 * `onMouseDown` (see the deprecated alias on `UseDrawerResizeResult`). The
 * union makes "exactly one of the two" a compile error rather than a
 * comment — a handle rendered with neither would look draggable and do
 * nothing, which is the same class of lie this pass is here to remove. */
type DrawerResizeHandleProps = DrawerResizeHandleBaseProps &
  (
    | { onPointerDown: StartDrag; onMouseDown?: never }
    /** @deprecated pass `onPointerDown` instead. */
    | { onMouseDown: StartDrag; onPointerDown?: never }
  );

export function DrawerResizeHandle({
  localHeight,
  parentMaxHeight,
  minHeight,
  onPointerDown,
  onMouseDown,
  onDoubleClick,
  onKeyDown,
  ariaLabel = "Resize lead detail panel — drag, or use up and down arrow keys",
}: DrawerResizeHandleProps) {
  const startDrag = onPointerDown ?? onMouseDown;
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-valuenow={localHeight}
      aria-valuemin={minHeight}
      aria-valuemax={parentMaxHeight}
      // Raw px reads as a bare number; spell out the unit so the
      // announcement is "420 pixels" rather than "420".
      aria-valuetext={`${localHeight} pixels`}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to toggle · up/down arrows also work"
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
