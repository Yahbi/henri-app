"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { EventData, Step } from "react-joyride";
import { useUser } from "@/hooks/useUser";
import { useTheme } from "@/components/ThemeProvider";
import { CONTRACTOR_TOUR_STEPS, type TourStep } from "@/lib/tutorial/steps";

// react-joyride uses window/document at module-eval. Loading via
// dynamic+ssr:false dodges the "document is not defined" RSC crash.
// In v3 the package exports `Joyride` as a named export, so we
// resolve `.Joyride` from the dynamic module.
const Joyride = dynamic(
  () => import("react-joyride").then((m) => m.Joyride),
  { ssr: false },
);

const STORAGE_REPLAY_KEY = "henri:tutorial:requested-replay";

/* ─── Theme palette for the tooltip ────────────────────────────────────
 * Joyride's `options` color props (primaryColor, textColor, backgroundColor,
 * arrowColor, overlayColor) only accept resolved CSS color strings — they
 * don't read CSS variables, and they're set once at render. So we resolve
 * Henri's three theme tokens to concrete colors and re-render Joyride
 * whenever the active theme changes.
 *
 * Keep these in sync with the [data-theme="..."] blocks in globals.css —
 * specifically `--card` (tooltip background), `--foreground` (tooltip
 * text), `--background` (the surface the overlay dims). primaryColor is
 * the same #D4886A in every theme (terracotta is brand-locked) so it
 * doesn't need a per-theme entry. */
const TOOLTIP_PALETTE = {
  light: {
    background: "#FFFFFF",          // --card
    foreground: "#1C1A16",          // --foreground
    border: "rgba(28, 26, 22, 0.10)",
    overlay: "rgba(28, 26, 22, 0.45)",
    shadow: "0 12px 40px -8px rgba(28, 26, 22, 0.20), 0 4px 12px -2px rgba(28, 26, 22, 0.08)",
  },
  dusk: {
    // Voyager-like warm grey. Pulled from globals.css [data-theme="dusk"]
    // when we land on it; if the file ships dusk variables later, keep
    // these in sync. Until dusk has its own block they alias to a halfway
    // tone between light and dark — still readable, brand-coherent.
    background: "#2B2924",          // ~midpoint of light card and dark card
    foreground: "#F2F0EB",
    border: "rgba(242, 240, 235, 0.12)",
    overlay: "rgba(13, 12, 10, 0.55)",
    shadow: "0 18px 48px -10px rgba(0, 0, 0, 0.45), 0 6px 16px -2px rgba(0, 0, 0, 0.25)",
  },
  dark: {
    background: "#1C1B18",          // --card (dark)
    foreground: "#F2F0EB",          // --foreground (dark)
    border: "rgba(242, 240, 235, 0.12)",
    overlay: "rgba(0, 0, 0, 0.65)",
    shadow: "0 18px 48px -10px rgba(0, 0, 0, 0.55), 0 6px 16px -2px rgba(0, 0, 0, 0.35)",
  },
} as const;

/**
 * Mounts the contractor first-run guided tour. Renders nothing until:
 *   - the user is signed in
 *   - profile.onboarding_completed === true
 *   - profile.tutorial_completed_at IS NULL  (first run)  OR  the
 *     "replay requested" localStorage flag is set (settings button)
 *
 * Cross-route stepping: if a step's `route` differs from the current
 * pathname we navigate, pause the tour, then resume on the new page
 * after a short settle delay.
 *
 * Skip/close: react-joyride v3 emits `tour:end` for finish + skip + close
 * — all three terminate the tour the same way: POST /api/profile/tutorial
 * to flip the DB timestamp so we don't re-fire on next login.
 *
 * Theme: the tooltip card adapts to Henri's light / dusk / dark themes
 * via the TOOLTIP_PALETTE above. When the user toggles the theme switcher
 * mid-tour, the next render picks up the new palette.
 */
export function ContractorTour() {
  const { profile, refreshProfile } = useUser();
  const { theme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [steps] = useState<TourStep[]>(CONTRACTOR_TOUR_STEPS);

  /** Resolved tooltip palette for the current theme. */
  const palette = useMemo(() => TOOLTIP_PALETTE[theme] ?? TOOLTIP_PALETTE.light, [theme]);

  /**
   * Mark the tour completed (or skipped — same outcome). Best-effort:
   * if the API fails (offline, column missing pre-migration, etc.) the
   * in-memory state ends so the user isn't trapped in a stuck dialog.
   */
  const markComplete = useCallback(async () => {
    setRun(false);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_REPLAY_KEY);
      }
      await fetch("/api/profile/tutorial", { method: "POST" });
      await refreshProfile();
    } catch {
      // graceful — local state already false
    }
  }, [refreshProfile]);

  /**
   * Decide whether to start the tour. Two triggers:
   *   1. First-run: profile loaded, onboarding_completed, no
   *      tutorial_completed_at, currently on a /dashboard route.
   *   2. Replay: localStorage flag set by the settings button.
   */
  useEffect(() => {
    if (!profile) return;
    if (typeof window === "undefined") return;

    const replayRequested = window.localStorage.getItem(STORAGE_REPLAY_KEY) === "1";
    const onDashboardish = pathname?.startsWith("/dashboard") ?? false;
    if (!onDashboardish && !run) return;

    if (replayRequested) {
      setStepIndex(0);
      setRun(true);
      return;
    }

    const completedAt = profile.tutorial_completed_at ?? null;
    const eligible = profile.onboarding_completed === true && completedAt == null;
    if (eligible && !run) {
      setStepIndex(0);
      setRun(true);
    }
  }, [profile, pathname, run]);

  /**
   * react-joyride v3 onEvent callback. We listen for `tour:end` (terminator)
   * + `step:after` (advances). On step:after we decide whether to navigate
   * to a new route or just bump stepIndex.
   */
  const handleEvent = useCallback(
    (data: EventData) => {
      const { type, action, index } = data;

      if (type === "tour:end") {
        markComplete();
        return;
      }

      if (type === "step:after") {
        const next = action === "prev" ? index - 1 : index + 1;
        if (next < 0 || next >= steps.length) {
          markComplete();
          return;
        }
        const nextStep = steps[next];
        if (nextStep.route && nextStep.route !== pathname) {
          // Cross-route step: navigate, pause, resume after settle.
          setRun(false);
          router.push(nextStep.route);
          window.setTimeout(() => {
            setStepIndex(next);
            setRun(true);
          }, 600);
          return;
        }
        setStepIndex(next);
      }
    },
    [steps, pathname, router, markComplete],
  );

  if (!profile) return null;

  return (
    <Joyride
      steps={steps as Step[]}
      stepIndex={stepIndex}
      run={run}
      continuous
      onEvent={handleEvent}
      locale={{
        back: "Back",
        close: "Close",
        last: "Finish",
        next: "Next",
        skip: "Skip tutorial",
        open: "Open tutorial",
        nextWithProgress: "Next ({current} of {total})",
      }}
      options={{
        // Theme-resolved colors — re-rendered when `theme` changes (palette
        // is memoized off the active theme via useTheme()).
        primaryColor: "#D4886A",
        textColor: palette.foreground,
        backgroundColor: palette.background,
        arrowColor: palette.background,
        overlayColor: palette.overlay,
        zIndex: 10000,
        showProgress: true,
        skipBeacon: true,
        skipScroll: true,
        // v3 default `buttons` is ['back','close','primary'] — no skip
        // button. Add 'skip' so the user can bail at any step, not just
        // on the final/close path.
        buttons: ["back", "skip", "primary"],
      }}
      styles={{
        // Per-element overrides on top of the options.* color tokens.
        // Spec'd here (instead of options.*) for things that don't have
        // a top-level option: tooltip rounding, padding, button hover
        // states, theme-aware border + shadow on the floating card.
        tooltip: {
          borderRadius: 14,
          padding: 24,
          border: `1px solid ${palette.border}`,
          boxShadow: palette.shadow,
          fontFamily: "var(--font-body, system-ui, sans-serif)",
        },
        tooltipContainer: {
          textAlign: "left" as const,
        },
        tooltipTitle: {
          fontFamily: "var(--font-heading, Fraunces, serif)",
          fontSize: 19,
          fontWeight: 400,
          letterSpacing: "-0.01em",
          marginBottom: 8,
        },
        tooltipContent: {
          fontSize: 14,
          lineHeight: 1.55,
          padding: 0,
          opacity: 0.92,
        },
        tooltipFooter: {
          marginTop: 18,
        },
        buttonPrimary: {
          backgroundColor: "#D4886A",
          color: "#FFFFFF",
          fontWeight: 600,
          fontSize: 13,
          borderRadius: 8,
          padding: "8px 16px",
          letterSpacing: "0.01em",
        },
        buttonBack: {
          color: theme === "light" ? "#6E6C62" : "#9E9C92",
          fontSize: 13,
          fontWeight: 500,
          marginRight: 8,
        },
        buttonSkip: {
          color: theme === "light" ? "#6E6C62" : "#9E9C92",
          fontSize: 12,
          fontWeight: 500,
          textDecoration: "none",
        },
        buttonClose: {
          // The X close button on each step — match the muted text color
          // so it doesn't compete with the primary CTA.
          color: theme === "light" ? "#6E6C62" : "#9E9C92",
          height: 12,
          width: 12,
          padding: 4,
          right: 12,
          top: 12,
        },
      }}
    />
  );
}
