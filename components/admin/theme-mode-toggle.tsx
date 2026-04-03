"use client";

import { Laptop, MoonStar, SunMedium } from "lucide-react";
import type { ThemeMode } from "../../types";

type ThemeModeToggleProps = {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
};

const OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: typeof Laptop;
}> = [
  { value: "system", label: "System", icon: Laptop },
  { value: "light", label: "Light", icon: SunMedium },
  { value: "dark", label: "Dark", icon: MoonStar },
];

export function ThemeModeToggle({ value, onChange }: ThemeModeToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] p-1">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`pill-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium ${
              active
                ? "bg-[var(--brand)] text-white"
                : "bg-transparent text-[var(--ink-soft)] hover:bg-[var(--surface-strong)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
