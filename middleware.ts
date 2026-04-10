import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { canUserAccessAdmin, hasSupabaseEnv } from "./lib/auth";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./lib/supabase-config";

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function middleware(req: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(new URL("/login?error=missing_env", req.url));
  }

  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: {
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    },
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options as never);
        });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const canAccessAdmin = await canUserAccessAdmin(supabase, String(user.id));
  if (canAccessAdmin) {
    return response;
  }

  const denied = NextResponse.redirect(new URL("/unauthorized", req.url));
  req.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith("sb-")) {
      denied.cookies.set(name, "", { path: "/", expires: new Date(0) });
    }
  });
  return denied;
}

export const config = {
  matcher: ["/admin/:path*"],
};
