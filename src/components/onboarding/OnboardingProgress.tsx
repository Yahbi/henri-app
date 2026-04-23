"use client";

import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";

const steps = [
  { label: "License", step: 1 },
  { label: "Plan", step: 2 },
  { label: "Payment", step: 3 },
  { label: "Territory", step: 4 },
] as const;

interface OnboardingProgressProps {
  currentStep: 1 | 2 | 3 | 4;
}

export function OnboardingProgress({ currentStep }: OnboardingProgressProps) {
  const currentLabel = steps.find((s) => s.step === currentStep)?.label ?? "";
  return (
    <div
      className="flex items-center gap-0"
      role="progressbar"
      aria-valuenow={currentStep}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuetext={`Step ${currentStep} of ${steps.length}: ${currentLabel}`}
      aria-label="Onboarding progress"
    >
      {steps.map(({ label, step }, idx) => {
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;
        const isUpcoming = step > currentStep;

        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  isCompleted && "bg-primary text-primary-foreground",
                  isActive && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  isUpcoming && "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Completed: {label}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">{step}</span>
                    <span className="sr-only">
                      {isActive ? `Current step: ${label}` : `Upcoming step: ${label}`}
                    </span>
                  </>
                )}
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  "text-xs font-medium",
                  isCompleted && "text-primary",
                  isActive && "text-foreground",
                  isUpcoming && "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div
                aria-hidden="true"
                className={cn(
                  "w-10 sm:w-16 h-0.5 mx-2 mt-[-1.25rem]",
                  step < currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
