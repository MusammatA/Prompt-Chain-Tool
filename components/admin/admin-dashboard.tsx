"use client";

import { LogOut, ScrollText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase-browser";
import { normalizeThemeMode, resolveTheme, THEME_STORAGE_KEY } from "../../lib/theme";
import type { ThemeMode } from "../../types";
import { FlavorStudio } from "./flavor-studio";
import { ThemeModeToggle } from "./theme-mode-toggle";

type AdminDashboardProps = {
  adminEmail: string;
};

type DashboardTab = "create-flavor" | "caption-archive";

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "create-flavor", label: "Create Humor Flavor" },
  { id: "caption-archive", label: "Caption Archive" },
];

export function AdminDashboard({ adminEmail }: AdminDashboardProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [activeTab, setActiveTab] = useState<DashboardTab>("create-flavor");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const stored = typeof window === "undefined" ? "system" : window.localStorage.getItem(THEME_STORAGE_KEY);
    setThemeMode(normalizeThemeMode(stored));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(themeMode, mediaQuery.matches);
      document.documentElement.dataset.themeMode = themeMode;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, [themeMode]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    setSigningOut(true);
    try {
      await supabase?.auth.signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="panel rounded-[2rem] px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[var(--ink-soft)]">
                Humor Project 3 Studio
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-semibold text-[var(--ink)] sm:text-5xl">Prompt-chain humor tooling</h1>
                <div className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1 text-xs text-[var(--ink-soft)]">
                  {adminEmail || "Administrator"}
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
                Author humor flavors, order their steps, test them against your image set, and review the caption batches
                each flavor produces.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 lg:items-end">
              <ThemeModeToggle value={themeMode} onChange={setThemeMode} />
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>

          <nav className="mt-6 flex flex-wrap gap-3">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon = tab.id === "create-flavor" ? Sparkles : ScrollText;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`pill-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold ${
                    active
                      ? "bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-white shadow-panel"
                      : "border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </header>

        <FlavorStudio activeTab={activeTab} />
      </div>
    </main>
  );
}
