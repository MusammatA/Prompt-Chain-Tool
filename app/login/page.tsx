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
    <main className="cinema-page relative min-h-screen overflow-hidden px-6 py-10 sm:px-10">
      <div className="orb orb-a" aria-hidden />
      <div className="orb orb-b" aria-hidden />
      <div className="orb orb-c" aria-hidden />
      <div className="hero-grid" aria-hidden />

      <section className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl items-center justify-center">
        <div className="flex w-full flex-col items-center gap-6 text-center">
          <article className="panel w-full rounded-[1.75rem] p-8 shadow-panel sm:p-10">
            <div className="cinema-kicker inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-[rgba(90,148,204,0.08)] px-4 py-2 text-xs text-[var(--brand-3)]">
              Humor Studio
            </div>
            <h1 className="cinema-title mt-6 text-5xl font-semibold text-[#15383f] sm:text-6xl">
              Build humor flavors.
            </h1>
            <div className="mx-auto mt-6 max-w-xl rounded-[1.35rem] border border-[rgba(90,148,204,0.32)] bg-[rgba(90,148,204,0.1)] px-5 py-4 text-sm leading-6 text-[#35515d]">
              Create flavor chains, edit prompt steps, and test captions on images.
            </div>
          </article>

          <aside className="panel-strong w-full max-w-xl rounded-[1.75rem] p-8 text-center shadow-glow sm:p-10">
            <div className="rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface-muted)] p-5 text-center">
              <div className="cinema-kicker text-xs text-[var(--ink-soft)]">Admin Login</div>
              <h2 className="cinema-display mt-3 text-3xl font-semibold">Google</h2>
            </div>

            {checkingSession ? (
              <p className="mt-6 rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-center text-sm text-[var(--ink-soft)]">
                Checking your current session...
              </p>
            ) : null}

            {errorMessage ? <p className="danger-panel mt-6 rounded-[1.3rem] px-4 py-3 text-center text-sm">{errorMessage}</p> : null}

            <button
              type="button"
              onClick={handleLogin}
              disabled={signingIn}
              className="pill-button mt-8 inline-flex w-full items-center justify-center gap-3 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-6 py-4 text-base font-semibold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-70"
            >
              {signingIn ? "Redirecting to Google..." : "Sign in with Google"}
            </button>
          </aside>
        </div>
      </section>
    </main>
  );
}
