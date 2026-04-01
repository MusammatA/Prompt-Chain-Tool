import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canUserAccessAdmin, hasSupabaseEnv } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { SUPABASE_URL } from "../../../lib/supabase-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ rows: [], error: "Missing Supabase environment variables." }, { status: 200 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return NextResponse.json({ rows: [], error: "Missing service role configuration." }, { status: 200 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    return NextResponse.json({ rows: [], error: "Not authenticated." }, { status: 401 });
  }

  const canAccess = await canUserAccessAdmin(supabase, String(user.id));
  if (!canAccess) {
    return NextResponse.json({ rows: [], error: "Forbidden." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const flavorId = String(searchParams.get("flavorId") || "").trim();
  const requestedLimit = Number(searchParams.get("limit") || "40");
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(60, requestedLimit)) : 40;

  if (!flavorId) {
    return NextResponse.json({ rows: [], error: "Missing flavorId." }, { status: 400 });
  }

  const serviceClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error: queryError } = await serviceClient
    .from("captions")
    .select("id, created_datetime_utc, content, image_id, humor_flavor_id")
    .eq("humor_flavor_id", flavorId)
    .order("created_datetime_utc", { ascending: false })
    .limit(limit);

  if (queryError) {
    return NextResponse.json({ rows: [], error: queryError.message }, { status: 200 });
  }

  return NextResponse.json({ rows: data ?? [] }, { status: 200 });
}
