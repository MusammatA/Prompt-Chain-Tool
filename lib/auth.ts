import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config";

type AccessRow = {
  id?: unknown;
  is_superadmin?: unknown;
  is_matrix_admin?: unknown;
};

export function hasAdminAccess(row: AccessRow | null, expectedId: string) {
  if (!row) return false;
  if (String(row.id || "").trim() !== expectedId) return false;
  return row.is_superadmin === true || row.is_matrix_admin === true;
}

export async function fetchAdminAccessForUser(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("id, is_superadmin, is_matrix_admin")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;
  return data as AccessRow | null;
}

export async function canUserAccessAdmin(client: SupabaseClient, userId: string) {
  if (!userId) return false;

  const directRow = await fetchAdminAccessForUser(client, userId);
  if (hasAdminAccess(directRow, userId)) return true;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return false;
  }

  const serviceClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceRow = await fetchAdminAccessForUser(serviceClient, userId);
  return hasAdminAccess(serviceRow, userId);
}

export function hasSupabaseEnv() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
