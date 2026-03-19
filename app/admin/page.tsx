import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { canUserAccessAdmin, hasSupabaseEnv } from "../../lib/auth";
import { AdminDashboard } from "../../components/admin/admin-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
  if (!hasSupabaseEnv()) {
    redirect("/login?error=missing_env");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    redirect("/login");
  }

  const canAccessAdmin = await canUserAccessAdmin(supabase, String(user.id));
  if (!canAccessAdmin) {
    redirect("/unauthorized");
  }

  return <AdminDashboard adminEmail={String(user.email || "").trim()} />;
}
