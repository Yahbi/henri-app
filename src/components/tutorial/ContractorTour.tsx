"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { EventData, Step } from "react-joyride";
import { useUser } from "@/hooks/useUser";
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
 * Skip/close: react-joyride v3 emits `tour:end` (finished) and
 * `tour:skip` (skip button or close X) — both terminate the tour the
 * same way: POST /api/profile/tutorial to flip the DB timestamp so
 * we don't re-fire on next login.
 */
export function ContractorTour() {
  const { profile, refreshProfile } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [steps] = useState<TourStep[]>(CONTRACTOR_TOUR_STEPS);

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
   * react-joyride v3 onEvent callback. We listen for `tour:end` and
   * `tour:skip` (terminating events) plus `step:after` (advances).
   * On step:after we decide whether to navigate to a new route or
   * just bump stepIndex.
   */
  const handleEvent = useCallback(
    (data: EventData) => {
      const { type, action, index } = data;

      // v3 emits a single terminator: tour:end. Whether the user skipped,
      // closed, or finished, we mark complete the same way (the column
      // gates auto-fire on next login regardless of how the tour ended).
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
        // v3 lifts these from top-level props into the options bag.
        // primaryColor/textColor/overlayColor/zIndex used to live under
        // styles.options in v2; in v3 they're top-level options.
        primaryColor: "#D4886A",
        textColor: "#0d0c0a",
        backgroundColor: "#ffffff",
        arrowColor: "#ffffff",
        overlayColor: "rgba(13, 12, 10, 0.55)",
        zIndex: 10000,
        showProgress: true,
        skipBeacon: true,
        // Don't auto-scroll the page — most steps anchor to the top
        // toolbar; staying still feels less jarring.
        skipScroll: true,
        // v3 default `buttons` array is ['back','close','primary'] — no
        // skip button. Add 'skip' so the user can bail at any step,
        // not just on the final/close path.
        buttons: ["back", "skip", "primary"],
      }}
    />
  );
}
