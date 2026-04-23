import { cn } from "@/lib/utils/cn";

type Urgency = "hot" | "warm" | "cool" | "cold";
type Size = "sm" | "md" | "lg";

interface LeadScoreBadgeProps {
  score: number;
  urgency: Urgency;
  size?: Size;
}

const urgencyStyles: Record<Urgency, string> = {
  hot: "text-hot ring-hot/30",
  warm: "text-warm ring-warm/30",
  cool: "text-cool ring-cool/30",
  cold: "text-cool ring-cool/30",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
};

export function LeadScoreBadge({
  score,
  urgency,
  size = "md",
}: LeadScoreBadgeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full ring-2 font-bold bg-background",
        urgencyStyles[urgency],
        sizeStyles[size],
      )}
      role="status"
      aria-label={`Lead score ${clamped}, urgency ${urgency}`}
    >
      {clamped}
    </div>
  );
}
