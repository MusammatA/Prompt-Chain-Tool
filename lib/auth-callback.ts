import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase-server";
import { canUserAccessAdmin, hasSupabaseEnv } from "./auth";

export async function handleAdminAuthCallback(request: Request) {
  const reqUrl = new URL(request.url);
  const origin = reqUrl.origin;
  const code = reqUrl.searchParams.get("code");

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(`${origin}/login?error=missing_env`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=signin_failed`);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=signin_failed`);
  }

  const canAccessAdmin = await canUserAccessAdmin(supabase, String(user.id));
  if (!canAccessAdmin) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_admin`);
  }

  return NextResponse.redirect(`${origin}/admin`);
}
