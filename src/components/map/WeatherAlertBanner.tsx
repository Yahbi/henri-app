"use client";

import { useState } from "react";
import { AlertTriangle, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WeatherAlert } from "@/hooks/useOverlayData";

interface WeatherAlertBannerProps {
  alerts: WeatherAlert[];
  className?: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  Extreme: { bg: "bg-red-500/15", border: "border-red-500/40", icon: "text-red-600" },
  Severe: { bg: "bg-orange-500/15", border: "border-orange-500/40", icon: "text-orange-600" },
  Moderate: { bg: "bg-amber-500/15", border: "border-amber-500/40", icon: "text-amber-600" },
  Minor: { bg: "bg-blue-500/10", border: "border-blue-500/30", icon: "text-blue-600" },
};

function getStyles(severity: string) {
  return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.Minor;
}

export function WeatherAlertBanner({ alerts, className }: WeatherAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Mount-time reference so expiry countdowns are stable per render
  const [mountNow] = useState(() => Date.now());

  if (alerts.length === 0 || dismissed) return null;

  const primary = alerts[0];
  const styles = getStyles(primary.severity);

  return (
    <div className={cn("rounded-lg border shadow-sm", styles.bg, styles.border, className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <AlertTriangle className={cn("h-4 w-4 shrink-0", styles.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {primary.event}
            {alerts.length > 1 && (
              <span className="text-muted-foreground font-normal ml-1">
                +{alerts.length - 1} more
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {primary.areas}
          </p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/5 transition-colors"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-black/5 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-border/50">
          {alerts.map((alert) => {
            const s = getStyles(alert.severity);
            const expires = new Date(alert.expires);
            const timeLeft = Math.max(0, Math.round((expires.getTime() - mountNow) / 3_600_000));

            return (
              <div key={alert.id} className="pt-2">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className={cn("h-3 w-3", s.icon)} />
                  <span className="text-xs font-medium text-foreground">{alert.event}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {timeLeft > 0 ? `${timeLeft}h remaining` : "Expired"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {alert.headline}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
