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
    <main className="cinema-page min-h-screen px-6 py-10 sm:px-10">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="w-full space-y-6">
          <header className="space-y-4 text-center">
            <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              Prompt Chain Tool
            </div>
            <h1 className="text-4xl font-semibold text-[var(--ink)] sm:text-5xl">Write something actually funny.</h1>
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-[var(--ink-soft)]">
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">Build flavors</span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">Test captions</span>
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">Review runs</span>
            </div>
          </header>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_380px]">
            <article className="panel rounded-[1.5rem] p-6 sm:p-8">
              <div className="cinema-kicker text-xs font-medium text-[var(--ink-soft)]">Examples</div>
              <div className="mt-4 space-y-4">
                <div className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-left text-sm leading-6 text-[var(--ink)]">
                  “They said they wanted a better fit. I already rewrote my personality twice.”
                </div>
                <div className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-left text-sm leading-6 text-[var(--ink)]">
                  “I’m not failing. I’m exploring alternative academic outcomes.”
                </div>
              </div>
            </article>

            <aside className="panel-strong rounded-[1.5rem] p-6 sm:p-8">
              <div className="space-y-2">
                <div className="cinema-kicker text-xs font-medium text-[var(--ink-soft)]">Admin Login</div>
                <h2 className="text-2xl font-semibold text-[var(--ink)]">Continue with Google</h2>
                <div className="rounded-[1rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                  Build flavors. Edit steps. Test image captions.
                </div>
              </div>

              {checkingSession ? (
                <p className="mt-5 rounded-[1rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                  Checking your session...
                </p>
              ) : null}

              {errorMessage ? <p className="danger-panel mt-5 rounded-[1rem] px-4 py-3 text-sm">{errorMessage}</p> : null}

              <button
                type="button"
                onClick={handleLogin}
                disabled={signingIn}
                className="pill-button mt-6 inline-flex w-full items-center justify-center rounded-full bg-[var(--brand)] px-6 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {signingIn ? "Redirecting..." : "Sign in with Google"}
              </button>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
