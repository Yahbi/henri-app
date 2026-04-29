"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface FocusTrapProps {
  children: ReactNode;
  active: boolean;
  /** Restore focus to this element when trap deactivates */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Traps Tab / Shift+Tab focus within its children when active.
 * Returns focus to the triggering element on deactivation.
 */
export function FocusTrap({ children, active, restoreFocusRef }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    // Store the currently focused element to restore later
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element inside
    const container = containerRef.current;
    if (!container) return;

    // Snapshot the restore-target ref at effect-start so the cleanup
    // sees the same element we opened against — not whatever the ref
    // has been mutated to by the time the modal closes.
    const restoreTargetAtOpen =
      restoreFocusRef?.current ?? previousFocusRef.current;

    const firstFocusable = getFocusableElements(container)[0];
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 0);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if at first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if at last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus using the snapshot, not a mutated ref value.
      if (restoreTargetAtOpen && typeof restoreTargetAtOpen.focus === "function") {
        restoreTargetAtOpen.focus();
      }
    };
  }, [active, restoreFocusRef]);

  return (
    <div ref={containerRef}>
      {children}
    </div>
  );
}

/** Get all focusable elements within a container */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.closest("[hidden]") && el.offsetParent !== null,
  );
}
