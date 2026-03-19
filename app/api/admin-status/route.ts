import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { canUserAccessAdmin, hasSupabaseEnv } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      {
        authenticated: false,
        canAccessAdmin: false,
        email: "",
        reason: "Missing Supabase environment variables.",
      },
      { status: 200 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    return NextResponse.json({ authenticated: false, canAccessAdmin: false, email: "" }, { status: 200 });
  }

  const canAccessAdmin = await canUserAccessAdmin(supabase, String(user.id));
  return NextResponse.json(
    {
      authenticated: true,
      canAccessAdmin,
      email: String(user.email || "").trim(),
    },
    { status: 200 },
  );
}
