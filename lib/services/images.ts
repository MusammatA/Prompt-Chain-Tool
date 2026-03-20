import type { ImageTestRecord } from "../../types";
import { getSupabaseBrowserClientOrThrow } from "./client";
import { SUPABASE_URL } from "../supabase-config";

type ImageRow = Record<string, unknown>;

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asOptionalString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function isLegacyImageSchemaError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the 'image_url' column") ||
    normalized.includes("could not find the 'public_url' column") ||
    normalized.includes("could not find the 'cdn_url' column") ||
    normalized.includes("could not find the 'created_at' column")
  );
}

function normalizeImageRow(row: ImageRow): ImageTestRecord {
  return {
    ...row,
    id: asString(row.id),
    image_url: asOptionalString(row.image_url),
    public_url: asOptionalString(row.public_url),
    cdn_url: asOptionalString(row.cdn_url),
    url: asOptionalString(row.url),
    created_at: asOptionalString(row.created_at) || asOptionalString(row.created_datetime_utc),
    additional_context: asOptionalString(row.additional_context),
    image_description: asOptionalString(row.image_description),
  };
}

export async function fetchImageTestSet(limit = 60) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const preferLegacyImageSchema =
    SUPABASE_URL.toLowerCase().includes("secure.almostcrackd.ai") ||
    SUPABASE_URL.toLowerCase().includes("qihsgnfjqmkjmoowyfbn.supabase.co");

  if (preferLegacyImageSchema) {
    const legacy = await supabase
      .from("images")
      .select("id, url, created_datetime_utc, additional_context, image_description")
      .order("created_datetime_utc", { ascending: false })
      .limit(limit);

    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []).map((row) => normalizeImageRow(row as ImageRow));
  }

  const modern = await supabase
    .from("images")
    .select("id, image_url, public_url, cdn_url, url, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!modern.error) return (modern.data ?? []).map((row) => normalizeImageRow(row as ImageRow));
  if (!isLegacyImageSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("images")
    .select("id, url, created_datetime_utc, additional_context, image_description")
    .order("created_datetime_utc", { ascending: false })
    .limit(limit);

  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((row) => normalizeImageRow(row as ImageRow));
}
