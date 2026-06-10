"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/* ── Toggle (switch) primitive ──────────────────────────────────────────
 *
 * Promoted from a local component in
 * `src/app/(dashboard)/dashboard/settings/page.tsx` (2026-06-09) per the
 * brand rule that all components ship from `@/components/ui/*` primitives.
 * Visuals are unchanged from the original so existing consumers render
 * identically.
 *
 * Semantics: `role="switch"` + `aria-checked` (the WAI-ARIA switch
 * pattern). Keyboard: native <button>, so Space/Enter activate and the
 * shared focus-visible ring matches Button / Badge / Input.
 *
 * Note on size: the visual track is 20×36px, below the 44px touch-target
 * floor — pair it with a row-level label/click area when used in dense
 * settings lists (the Settings page rows are 44px+ tall), or pass a
 * className padding bump for standalone use.
 */

export interface ToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Current on/off state. */
  checked: boolean;
  /** Called with the NEXT state when the user activates the switch. */
  onChange: (checked: boolean) => void;
}

const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-primary" : "bg-border",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
);
Toggle.displayName = "Toggle";

export { Toggle };
