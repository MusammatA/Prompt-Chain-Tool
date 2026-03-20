"use client";

import { ListOrdered, LogOut, ScrollText, Sparkles, TestTube2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase-browser";
import { normalizeThemeMode, resolveTheme, THEME_STORAGE_KEY } from "../../lib/theme";
import type { ThemeMode } from "../../types";
import { FlavorStudio } from "./flavor-studio";
import { ThemeModeToggle } from "./theme-mode-toggle";

type AdminDashboardProps = {
  adminEmail: string;
};

type DashboardTab = "flavor" | "steps" | "tester" | "archive";

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "flavor", label: "Flavor" },
  { id: "steps", label: "Steps" },
  { id: "tester", label: "Test" },
  { id: "archive", label: "Archive" },
];

export function AdminDashboard({ adminEmail }: AdminDashboardProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [activeTab, setActiveTab] = useState<DashboardTab>("flavor");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const stored = typeof window === "undefined" ? "light" : window.localStorage.getItem(THEME_STORAGE_KEY);
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
    <main className="cinema-page min-h-screen px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[1320px] space-y-5">
        <header className="panel cinema-banner rounded-[1.75rem] px-5 py-5 shadow-panel sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="cinema-display text-3xl font-semibold text-[var(--ink)] sm:text-4xl">Humor Studio</h1>
                <div className="rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1 text-xs text-[var(--ink-soft)]">
                  {adminEmail || "Administrator"}
                </div>
              </div>
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

          <nav className="mt-5 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon =
                tab.id === "flavor" ? Sparkles : tab.id === "steps" ? ListOrdered : tab.id === "tester" ? TestTube2 : ScrollText;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`pill-button inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold ${
                    active
                      ? "bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-white shadow-glow"
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

        <FlavorStudio activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </main>
  );
}
