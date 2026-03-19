import type { ImageTestRecord } from "../../types";
import { getSupabaseBrowserClientOrThrow } from "./client";

export async function fetchImageTestSet(limit = 60) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("images")
    .select("id, image_url, public_url, cdn_url, url, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as ImageTestRecord[];
}
