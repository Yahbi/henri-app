"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useDrawerResize — encapsulates the drag math + ResizeObserver bookkeeping
 * that powers the LeadDetailDrawer's vertical resize handle.
 *
 * Audit-04-29 priority D step 2: extracted from `LeadDetailDrawer.tsx` so
 * the hook can be tested in isolation and re-used by any future bottom-
 * sheet drawer (the homeowner intake modal is a candidate).
 *
 * Behaviour preserved verbatim from the original implementation — the
 * inline comments below trace the historical bugs that drove each design
 * decision (pointer-capture race, setState-in-updater warning, body-cursor
 * stuck on unmount, etc.). Anything that worked in the previous drawer
 * still works.
 *
 * @example
 * const drawer = useDrawerResize({
 *   height,
 *   onHeightChange,
 *   resetTrigger: lead,           // cancel mid-drag when lead changes
 *   minHeight: 200,
 *   maxHeightRatio: 1.0,
 * });
 * <div ref={drawer.containerRef} style={{ height: drawer.localHeight }}>
 *   <div role="separator"
 *        aria-valuenow={drawer.localHeight}
 *        aria-valuemax={drawer.parentMaxHeight}
 *        onMouseDown={drawer.onMouseDown}
 *        onDoubleClick={drawer.onDoubleClick}
 *        onKeyDown={drawer.onKeyDown}
 *   />
 * </div>
 */

export interface UseDrawerResizeParams {
  /** Persisted height from the parent (e.g. localStorage). */
  height: number;
  /** Called once the drag releases — write to localStorage here. */
  onHeightChange: (h: number) => void;
  /** Optional value whose change resets `dragging.current` to false.
   * Pass the active-row identifier so a new selection during a stuck
   * drag clears the handle state instead of stranding it. */
  resetTrigger?: unknown;
  /** Minimum height in px (must match the parent's localStorage validator
   * or the drag will silently snap back). Defaults to 200. */
  minHeight?: number;
  /** Ceiling as a fraction of parent height (1.0 = full bleed).
   * Defaults to 1.0. */
  maxHeightRatio?: number;
}

export interface UseDrawerResizeResult {
  /** Attach to the drawer's outer container. The hook reads
   * `containerRef.current.parentElement.clientHeight` to compute the
   * dynamic ceiling for clamping. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Live drag-following height — set this on `style={{ height }}`. */
  localHeight: number;
  /** Latest parent ceiling — feed to `aria-valuemax` on the separator. */
  parentMaxHeight: number;
  /** Wire to `onMouseDown` of the separator. */
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Wire to `onDoubleClick` of the separator — toggles expand/collapse. */
  onDoubleClick: () => void;
  /** Wire to `onKeyDown` of the separator — Arrow / Home / End / Enter. */
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Min-height ceiling in use (forwarded for the separator's
   * `aria-valuemin` — keeps the contract single-sourced). */
  minHeight: number;
}

const DEFAULT_MIN_HEIGHT = 200;
const DEFAULT_MAX_RATIO = 1.0;

/* Resolve the available vertical space for the drawer to grow into.
 *
 * Audit-04-29 follow-up bug fix:
 * `parent.clientHeight` returns 0 when the immediate parent is a
 * position:static block without an explicit height (e.g. the dashboard's
 * grid cell wrapper). When that happened, `maxH = 0 * ratio = 0`, and
 * `Math.min(0, Math.max(minHeight, …))` clamped EVERY drag attempt to 0
 * — the drawer collapsed instead of growing.
 *
 * The fix has two parts:
 *   1. If parent.clientHeight is 0/falsy, fall back to window.innerHeight
 *      so the drag still has a sensible ceiling.
 *   2. Floor the ceiling at minHeight so even a pathological 0-height
 *      parent can't produce a clamp ceiling below the floor.
 *
 * Returns the effective ceiling in px, never less than minHeight.
 */
function resolveMaxHeight(
  containerRef: React.RefObject<HTMLDivElement | null>,
  minHeight: number,
  maxHeightRatio: number,
): number {
  // Walk UP the ancestor chain to find the first element with a non-zero
  // clientHeight. This handles the dashboard's nested grid layout where
  // the drawer's IMMEDIATE parent is a position:static block with 0
  // height, but the GRANDPARENT (the dashboard content cell) has a
  // proper height.
  //
  // Without this walk, parent.clientHeight=0 → maxH=0 → drag clamps to
  // 0 (the original audit-04-29 bug). Using viewport.innerHeight as a
  // fallback was too generous because it includes the nav/header strip
  // — the drawer would then cover the nav, hiding the dashboard tabs.
  // Walking up to the grandparent gives the right "available content
  // area" automatically.
  let node: HTMLElement | null | undefined = containerRef.current?.parentElement;
  let parentH = 0;
  // Cap the walk at 6 ancestors so a pathological zero-height chain
  // doesn't loop up to <html>.
  for (let i = 0; node && parentH === 0 && i < 6; i++) {
    parentH = node.clientHeight;
    node = node.parentElement;
  }
  // Last-resort fallback: viewport minus a 60px nav-strip allowance so
  // the drawer doesn't cover the dashboard's top tab bar even on a
  // truly orphaned drawer mount.
  const effective =
    parentH > 0
      ? parentH
      : typeof window !== "undefined"
        ? Math.max(minHeight, window.innerHeight - 60)
        : 600;
  const ceiling = Math.round(effective * maxHeightRatio);
  return Math.max(minHeight, ceiling);
}

export function useDrawerResize({
  height,
  onHeightChange,
  resetTrigger,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeightRatio = DEFAULT_MAX_RATIO,
}: UseDrawerResizeParams): UseDrawerResizeResult {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local drag height — decoupled from parent state during active drag so
  // every pointer-move frame doesn't setState on the parent and force the
  // whole component tree to re-render. We only bubble the final height up
  // when the drag releases.
  // Clamp the initial value to >= minHeight so a stale parent value of 0
  // (set by a broken drag event) can't lock the drawer in a 0-height state.
  const [localHeight, setLocalHeight] = useState<number>(() =>
    Math.max(minHeight, height || minHeight),
  );

  // Track the parent container's height in state so the separator can
  // render an accurate aria-valuemax without dereferencing a ref during
  // render (rules-of-refs violation). Updated via ResizeObserver so window
  // resizes update the announced bounds in real time.
  const [parentMaxHeight, setParentMaxHeight] = useState<number>(600);

  // When the parent's `height` prop changes (e.g., programmatic reset), sync
  // it down — but only when we're NOT actively dragging, otherwise we'd
  // overwrite the user's live drag.
  //
  // Audit-04-30 fix #6 (react-hooks/set-state-in-effect): React 19's
  // tightened lint flags any synchronous setState inside a useEffect body
  // because it can cascade renders. To stay correct AND quiet:
  //   1. Track the last-synced height in a ref (no re-render).
  //   2. In the effect, only setLocalHeight when the incoming `height`
  //      prop actually differs from what we last synced AND we're not
  //      dragging. This is functionally identical to the prior version
  //      but explicit about the "sync on change" semantics.
  //   3. The eslint-disable for `react-hooks/set-state-in-effect` is
  //      documented because the alternative (lifting to useMemo) breaks
  //      the user's live-drag invariant — `localHeight` MUST be allowed
  //      to deviate from `height` mid-drag without re-syncing.
  const lastSyncedHeight = useRef(height);
  useEffect(() => {
    if (dragging.current) return;
    const target = Math.max(minHeight, height || minHeight);
    if (lastSyncedHeight.current === target) return;
    lastSyncedHeight.current = target;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalHeight(target);
  }, [height, minHeight]);

  // Safety valve: when `resetTrigger` changes, force dragging.current back
  // to false. Without this, if a previous drag was interrupted (browser
  // lost pointer capture, script tab switched, etc.) the drawer would be
  // stuck ignoring height-prop updates forever.
  useEffect(() => {
    if (resetTrigger) dragging.current = false;
  }, [resetTrigger]);

  // Defensive unmount cleanup. If the drawer unmounts mid-drag (parent
  // sets activeRow=null while the user is dragging):
  //   1. clear `dragging.current` so any straggler `mousemove`/`mouseup`
  //      events still attached to `document` bail early via their
  //      `if (!dragging.current) return` guard,
  //   2. reset the global body cursor + user-select that we set during
  //      drag so the page doesn't end up stuck with row-resize cursor.
  // Without this, the bug manifests as: drawer unmounts, document
  // listeners fire, attempt setLocalHeight on an unmounted component,
  // React logs a warning + the page is left with a weird cursor.
  useEffect(() => {
    return () => {
      dragging.current = false;
      if (typeof document !== "undefined") {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  // Observe the parent container — `parentMaxHeight` powers both
  // aria-valuemax on the separator and the visible "you can drag up to
  // N px" calculation. Uses resolveMaxHeight() so a 0-height parent
  // falls back to window.innerHeight (see resolveMaxHeight() doc).
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    const measure = () => {
      setParentMaxHeight(resolveMaxHeight(containerRef, minHeight, maxHeightRatio));
    };
    measure();
    if (!parent) return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    // Also re-measure on window resize so the viewport-fallback path
    // updates the ceiling when the user resizes the browser window.
    if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
    }
    return () => {
      ro.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", measure);
      }
    };
  }, [resetTrigger, maxHeightRatio, minHeight]);

  /* ── Drag-to-resize: dead-simple mouse-event pattern ───────────────
   *
   *   1. mousedown on the handle  → record startY + startHeight, attach
   *      document mousemove + mouseup, set the body cursor + user-select
   *   2. mousemove (anywhere on the page) → compute delta, call
   *      setLocalHeight to redraw the drawer
   *   3. mouseup (anywhere on the page) → commit the final height to the
   *      parent (so it persists to localStorage), remove document
   *      listeners, restore body styles
   *
   * Why this layout vs the prior implementations:
   *   - setPointerCapture on the handle (pre-b083b02): broke when the
   *     handle re-rendered mid-drag because aria-valuenow updated;
   *     browsers dropped capture inconsistently, fired phantom
   *     pointercancel events that snapped the drawer to MIN_HEIGHT.
   *   - Document listeners + onHeightChange inside a state-updater
   *     (b083b02): React fired the "Cannot update a component while
   *     rendering a different component" warning because setLocalHeight's
   *     updater function called onHeightChange (parent setState).
   *   - Current: a closure-local `currentHeight` variable tracks the
   *     latest height during the drag. We read it in mouseup and call
   *     onHeightChange OUTSIDE of any state-updater, so React's
   *     during-render check is happy. */
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = localHeight;
      let currentHeight = localHeight;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const maxH = resolveMaxHeight(containerRef, minHeight, maxHeightRatio);
        const delta = startY.current - ev.clientY;
        const next = Math.min(maxH, Math.max(minHeight, startH.current + delta));
        currentHeight = next;
        setLocalHeight(next);
      };

      const onUp = () => {
        if (!dragging.current) return;
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Commit OUTSIDE of any state-updater — straight call to the
        // parent's onHeightChange (which writes to localStorage).
        onHeightChange(Math.max(minHeight, currentHeight));
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [localHeight, onHeightChange, minHeight, maxHeightRatio],
  );

  const onDoubleClick = useCallback(() => {
    const maxH = resolveMaxHeight(containerRef, minHeight, maxHeightRatio);
    // 55% of available space, but never below minHeight.
    const expanded = Math.max(minHeight, Math.round(maxH * 0.55));
    const next = localHeight < 250 ? expanded : minHeight;
    setLocalHeight(next);
    onHeightChange(next);
  }, [localHeight, onHeightChange, minHeight, maxHeightRatio]);

  /* Keyboard resize — ArrowUp/Down nudges by 24px, Shift = 96px,
   * Home/End jump to min/max. Wedge contract bullet #2 says the score
   * breakdown can never be hidden, so a keyboard user must be able to
   * grow the drawer the same way a mouse user does. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const maxH = resolveMaxHeight(containerRef, minHeight, maxHeightRatio);
      const step = e.shiftKey ? 96 : 24;
      let next: number | null = null;
      switch (e.key) {
        case "ArrowUp":
          next = Math.min(maxH, localHeight + step);
          break;
        case "ArrowDown":
          next = Math.max(minHeight, localHeight - step);
          break;
        case "Home":
          next = minHeight;
          break;
        case "End":
          next = maxH;
          break;
        case "Enter":
        case " ":
          // Same expand/collapse toggle as the double-click affordance.
          next = localHeight < 250 ? Math.max(minHeight, Math.round(maxH * 0.55)) : minHeight;
          break;
        default:
          return;
      }
      e.preventDefault();
      setLocalHeight(next);
      onHeightChange(next);
    },
    [localHeight, onHeightChange, minHeight, maxHeightRatio],
  );

  return {
    containerRef,
    localHeight,
    parentMaxHeight,
    onMouseDown,
    onDoubleClick,
    onKeyDown,
    minHeight,
  };
}
