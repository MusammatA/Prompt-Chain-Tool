"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase-browser";

async function fetchAdminStatusWithTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch("/api/admin-status", { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function readErrorMessage(error: string) {
  if (error === "not_admin") return "This account is not marked as a superadmin or matrix admin.";
  if (error === "missing_env") return "Missing Supabase environment variables.";
  if (error === "signin_failed") return "Google sign-in failed. Please try again.";
  if (error === "missing_code") return "Missing OAuth callback code.";
  return error;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      if (!supabase) {
        if (!cancelled) {
          setCheckingSession(false);
          setErrorMessage("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        }
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) return;
        if (!session) {
          setCheckingSession(false);
          return;
        }

        const res = await fetchAdminStatusWithTimeout(8000);
        const payload = (await res.json().catch(() => null)) as { canAccessAdmin?: boolean } | null;
        if (cancelled) return;

        if (payload?.canAccessAdmin) {
          router.replace("/admin");
          return;
        }

        await supabase.auth.signOut();
        setCheckingSession(false);
        setErrorMessage("This account does not have admin access.");
      } catch (_error) {
        if (cancelled) return;
        setCheckingSession(false);
        setErrorMessage("Could not verify admin access. Please try again.");
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error") || "";
    if (error) {
      setErrorMessage(readErrorMessage(error));
    }
  }, []);

  async function handleLogin() {
    if (!supabase) {
      setErrorMessage("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setSigningIn(true);
    setErrorMessage("");
    await supabase.auth.signOut();

    const callbackUrl = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      setSigningIn(false);
      setErrorMessage(error.message);
      return;
    }

    if (!data?.url) {
      setSigningIn(false);
      setErrorMessage("Google did not return a redirect URL.");
      return;
    }

    window.location.assign(data.url);
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 sm:px-10">
      <div className="orb orb-a" aria-hidden />
      <div className="orb orb-b" aria-hidden />
      <div className="orb orb-c" aria-hidden />
      <div className="hero-grid" aria-hidden />

      <section className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="panel rounded-[1.75rem] p-8 sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-xs uppercase tracking-[0.28em] text-[var(--ink-soft)]">
              Humor Studio
            </div>
            <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-[0.92] text-[var(--ink)] sm:text-6xl">
              Build humor flavors.
            </h1>
            <div className="mt-8 flex flex-wrap gap-3">
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm text-[var(--ink-soft)]">
                Create
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm text-[var(--ink-soft)]">
                Test
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm text-[var(--ink-soft)]">
                Archive
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm text-[var(--ink-soft)]">
                Admin only
              </span>
            </div>
          </article>

          <aside className="panel-strong rounded-[1.75rem] p-8 sm:p-10">
            <div className="rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface-muted)] p-5">
              <div className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">Admin Login</div>
              <h2 className="mt-3 text-3xl font-semibold">Google</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--ink-soft)]">
                  superadmin
                </span>
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1 text-xs text-[var(--ink-soft)]">
                  matrix_admin
                </span>
              </div>
            </div>

            {checkingSession ? (
              <p className="mt-6 rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                Checking your current session...
              </p>
            ) : null}

            {errorMessage ? <p className="danger-panel mt-6 rounded-[1.3rem] px-4 py-3 text-sm">{errorMessage}</p> : null}

            <button
              type="button"
              onClick={handleLogin}
              disabled={signingIn}
              className="pill-button mt-8 inline-flex w-full items-center justify-center gap-3 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-6 py-4 text-base font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-70"
            >
              {signingIn ? "Redirecting to Google..." : "Sign in with Google"}
            </button>
          </aside>
        </div>
      </section>
    </main>
  );
}
