"use client";

import { Sun, Moon, Sunset } from "lucide-react";
import { useTheme, type Theme } from "./ThemeProvider";

const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "dusk", icon: Sunset, label: "Dusk" },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    const idx = themes.findIndex((t) => t.value === theme);
    const next = themes[(idx + 1) % themes.length];
    setTheme(next.value);
  };

  const current = themes.find((t) => t.value === theme) ?? themes[0];
  const Icon = current.icon;

  return (
    <button
      onClick={cycle}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Current theme: ${current.label}. Click to switch.`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{current.label}</span>
    </button>
  );
}
