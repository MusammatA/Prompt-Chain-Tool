import { createSupabaseBrowserClient } from "../supabase-browser";

export const MISSING_SUPABASE_BROWSER_ENV_MESSAGE =
  "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.";

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unexpected error.";
}

export function getSupabaseBrowserClientOrThrow() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    throw new Error(MISSING_SUPABASE_BROWSER_ENV_MESSAGE);
  }
  return supabase;
}

export async function getCurrentSessionOrThrow() {
  const supabase = getSupabaseBrowserClientOrThrow();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error("No active session found. Please sign in again.");
  }

  return session;
}
