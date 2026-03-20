import type {
  GeneratedFlavorCaption,
  HumorFlavor,
  HumorFlavorStep,
  PromptChainRun,
} from "../../types";
import { getSupabaseBrowserClientOrThrow } from "./client";
import { SUPABASE_URL } from "../supabase-config";

type FlavorInput = {
  name: string;
  slug?: string;
  description?: string;
  notes?: string;
  status?: string;
};

type StepInput = {
  humor_flavor_id: string;
  title: string;
  instruction: string;
  step_order: number;
  output_label?: string;
  system_prompt?: string;
  llm_temperature?: number | null;
  llm_input_type_id?: number;
  llm_output_type_id?: number;
  llm_model_id?: number;
  humor_flavor_step_type_id?: number;
};

type RunInput = {
  humor_flavor_id: string;
  image_id?: string;
  image_url?: string;
  status?: string;
  pipeline_model?: string;
  request_payload?: unknown;
  raw_response?: unknown;
  created_by?: string;
};

type CaptionInput = {
  humor_flavor_run_id: string;
  humor_flavor_id: string;
  image_id?: string;
  caption_text: string;
  rank_index: number;
  profile_id?: string;
};

type RowRecord = Record<string, unknown>;

const LEGACY_DEFAULT_MODEL_ID = 16;
const LEGACY_GENERAL_STEP_TYPE_ID = 3;
const LEGACY_IMAGE_INPUT_TYPE_ID = 1;
const LEGACY_TEXT_INPUT_TYPE_ID = 2;
const LEGACY_STRING_OUTPUT_TYPE_ID = 1;
const LEGACY_ARRAY_OUTPUT_TYPE_ID = 2;
const PREFER_LEGACY_HUMOR_SCHEMA =
  SUPABASE_URL.toLowerCase().includes("secure.almostcrackd.ai") ||
  SUPABASE_URL.toLowerCase().includes("qihsgnfjqmkjmoowyfbn.supabase.co");

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asOptionalString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function slugToTitle(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isMissingTableError(message: string, tableName: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(`could not find the table 'public.${tableName.toLowerCase()}'`);
}

function isMissingColumnError(message: string, columnName: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(`could not find the '${columnName.toLowerCase()}' column`) || normalized.includes(`column ${columnName.toLowerCase()}`);
}

function isLegacyFlavorSchemaError(message: string) {
  return (
    isMissingColumnError(message, "name") ||
    isMissingColumnError(message, "updated_at") ||
    isMissingColumnError(message, "notes") ||
    isMissingColumnError(message, "status")
  );
}

function isLegacyStepSchemaError(message: string) {
  return (
    isMissingColumnError(message, "title") ||
    isMissingColumnError(message, "instruction") ||
    isMissingColumnError(message, "step_order") ||
    isMissingColumnError(message, "output_label")
  );
}

function normalizeFlavorRow(row: RowRecord): HumorFlavor {
  const id = asString(row.id);
  const slug = asOptionalString(row.slug);
  const description = asOptionalString(row.description);
  const derivedName =
    asOptionalString(row.name) ||
    asOptionalString(row.title) ||
    (slug ? slugToTitle(slug) : null) ||
    (description ? description.slice(0, 60) : null) ||
    `Flavor ${id || "Untitled"}`;

  const hasModernColumns = Object.prototype.hasOwnProperty.call(row, "name") || Object.prototype.hasOwnProperty.call(row, "status");

  return {
    ...row,
    id,
    name: derivedName,
    slug,
    description,
    notes: asOptionalString(row.notes),
    status: asOptionalString(row.status) || "draft",
    created_at: asOptionalString(row.created_at) || asOptionalString(row.created_datetime_utc),
    updated_at:
      asOptionalString(row.updated_at) ||
      asOptionalString(row.modified_datetime_utc) ||
      asOptionalString(row.created_datetime_utc),
    schema_variant: hasModernColumns ? "modern" : "legacy",
  };
}

function combineLegacyPrompts(systemPrompt: string | null, userPrompt: string | null, fallback: string | null) {
  if (userPrompt) return userPrompt;
  if (systemPrompt) return systemPrompt;
  return fallback || "";
}

function normalizeStepRow(row: RowRecord): HumorFlavorStep {
  const stepOrder = asNumber(row.step_order ?? row.order_by) ?? 1;
  const systemPrompt = asOptionalString(row.llm_system_prompt);
  const userPrompt = asOptionalString(row.llm_user_prompt) || asOptionalString(row.instruction);
  const title = asOptionalString(row.title) || asOptionalString(row.description) || `Step ${stepOrder}`;
  const hasModernColumns =
    Object.prototype.hasOwnProperty.call(row, "title") || Object.prototype.hasOwnProperty.call(row, "instruction");

  return {
    ...row,
    id: asString(row.id),
    humor_flavor_id: asString(row.humor_flavor_id),
    title,
    instruction: combineLegacyPrompts(systemPrompt, userPrompt, asOptionalString(row.description)),
    step_order: stepOrder,
    output_label: asOptionalString(row.output_label),
    created_at: asOptionalString(row.created_at) || asOptionalString(row.created_datetime_utc),
    updated_at:
      asOptionalString(row.updated_at) ||
      asOptionalString(row.modified_datetime_utc) ||
      asOptionalString(row.created_datetime_utc),
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    llm_temperature: asNumber(row.llm_temperature),
    llm_input_type_id: asNumber(row.llm_input_type_id),
    llm_output_type_id: asNumber(row.llm_output_type_id),
    llm_model_id: asNumber(row.llm_model_id),
    humor_flavor_step_type_id: asNumber(row.humor_flavor_step_type_id),
    schema_variant: hasModernColumns ? "modern" : "legacy",
  };
}

function getLegacyRunId(row: RowRecord) {
  const chainId = asOptionalString(row.llm_prompt_chain_id);
  if (chainId) return `legacy-chain-${chainId}`;

  const imageId = asOptionalString(row.image_id) || "image";
  const createdAt = asOptionalString(row.created_datetime_utc) || asOptionalString(row.created_at) || "unknown";
  return `legacy-batch-${imageId}-${createdAt}`;
}

function normalizeCaptionRows(rows: RowRecord[], runIdOverride?: string) {
  const nextRankByRunId = new Map<string, number>();

  return rows.map((row) => {
    const humorFlavorRunId = runIdOverride || asOptionalString(row.humor_flavor_run_id) || getLegacyRunId(row);
    const nextRank = (nextRankByRunId.get(humorFlavorRunId) || 0) + 1;
    nextRankByRunId.set(humorFlavorRunId, nextRank);

    return {
      ...row,
      id: asString(row.id),
      humor_flavor_run_id: humorFlavorRunId,
      humor_flavor_id: asString(row.humor_flavor_id),
      image_id: asOptionalString(row.image_id),
      caption_text: asOptionalString(row.caption_text) || asOptionalString(row.content) || "",
      rank_index: asNumber(row.rank_index) ?? nextRank,
      created_at: asOptionalString(row.created_at) || asOptionalString(row.created_datetime_utc),
      source_table: Object.prototype.hasOwnProperty.call(row, "content") ? "captions" : "humor_flavor_captions",
    } satisfies GeneratedFlavorCaption;
  });
}

function synthesizeLegacyRuns(rows: RowRecord[]) {
  const runs = new Map<string, PromptChainRun>();

  rows.forEach((row) => {
    const runId = getLegacyRunId(row);
    if (runs.has(runId)) return;

    runs.set(runId, {
      id: runId,
      humor_flavor_id: asString(row.humor_flavor_id),
      image_id: asOptionalString(row.image_id),
      image_url: null,
      status: "completed",
      pipeline_model: asOptionalString(row.llm_prompt_chain_id)
        ? `Prompt Chain ${asString(row.llm_prompt_chain_id)}`
        : "Legacy caption archive",
      request_payload: null,
      raw_response: null,
      created_at: asOptionalString(row.created_datetime_utc) || asOptionalString(row.created_at),
      created_by: asOptionalString(row.profile_id),
      schema_variant: "legacy",
    });
  });

  return [...runs.values()].sort((left, right) =>
    String(right.created_at || "").localeCompare(String(left.created_at || "")),
  );
}

function normalizeFlavorInput(input: FlavorInput) {
  return {
    name: input.name.trim(),
    slug: input.slug?.trim() || null,
    description: input.description?.trim() || null,
    notes: input.notes?.trim() || null,
    status: input.status?.trim() || "draft",
  };
}

function buildLegacyFlavorPayload(input: FlavorInput) {
  const normalized = normalizeFlavorInput(input);
  return {
    slug: normalized.slug || normalized.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, ""),
    description: normalized.description || normalized.name,
  };
}

function buildLegacyStepPayload(
  input: StepInput | Partial<Omit<StepInput, "humor_flavor_id">>,
  options: { includeDefaults: boolean },
) {
  const stepOrder = asNumber(input.step_order) ?? 1;
  const title = asString(input.title) || `Step ${stepOrder}`;
  const instruction = asString(input.instruction);
  const systemPrompt = asOptionalString(input.system_prompt);
  const basePayload: RowRecord = {
    description: title,
    order_by: stepOrder,
    llm_user_prompt: instruction || null,
    llm_system_prompt: systemPrompt,
  };

  const maybeTemperature = asNumber(input.llm_temperature);
  if (maybeTemperature !== null) basePayload.llm_temperature = maybeTemperature;

  const llmInputTypeId = asNumber(input.llm_input_type_id);
  const llmOutputTypeId = asNumber(input.llm_output_type_id);
  const llmModelId = asNumber(input.llm_model_id);
  const stepTypeId = asNumber(input.humor_flavor_step_type_id);

  if (options.includeDefaults) {
    basePayload.llm_input_type_id = llmInputTypeId ?? (stepOrder === 1 ? LEGACY_IMAGE_INPUT_TYPE_ID : LEGACY_TEXT_INPUT_TYPE_ID);
    basePayload.llm_output_type_id =
      llmOutputTypeId ??
      (/captions?|array|list|json/i.test(`${title}\n${instruction}`) ? LEGACY_ARRAY_OUTPUT_TYPE_ID : LEGACY_STRING_OUTPUT_TYPE_ID);
    basePayload.llm_model_id = llmModelId ?? LEGACY_DEFAULT_MODEL_ID;
    basePayload.humor_flavor_step_type_id = stepTypeId ?? LEGACY_GENERAL_STEP_TYPE_ID;
  } else {
    if (llmInputTypeId !== null) basePayload.llm_input_type_id = llmInputTypeId;
    if (llmOutputTypeId !== null) basePayload.llm_output_type_id = llmOutputTypeId;
    if (llmModelId !== null) basePayload.llm_model_id = llmModelId;
    if (stepTypeId !== null) basePayload.humor_flavor_step_type_id = stepTypeId;
  }

  return basePayload;
}

async function fetchLegacyCaptionRows(humorFlavorId: string, limit = 200) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("captions")
    .select("id, created_datetime_utc, content, image_id, humor_flavor_id, llm_prompt_chain_id, profile_id")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_datetime_utc", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as RowRecord[];
}

export async function fetchHumorFlavors(limit = 100) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("humor_flavors")
      .select("*")
      .order("created_datetime_utc", { ascending: false })
      .limit(limit);

    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []).map((row) => normalizeFlavorRow(row as RowRecord));
  }

  const modern = await supabase.from("humor_flavors").select("*").order("updated_at", { ascending: false }).limit(limit);

  if (!modern.error) return (modern.data ?? []).map((row) => normalizeFlavorRow(row as RowRecord));
  if (!isLegacyFlavorSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("humor_flavors")
    .select("*")
    .order("created_datetime_utc", { ascending: false })
    .limit(limit);

  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((row) => normalizeFlavorRow(row as RowRecord));
}

export async function createHumorFlavor(input: FlavorInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase.from("humor_flavors").insert(buildLegacyFlavorPayload(input)).select("*").single();
    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeFlavorRow(legacy.data as RowRecord);
  }

  const modern = await supabase.from("humor_flavors").insert(normalizeFlavorInput(input)).select("*").single();

  if (!modern.error) return normalizeFlavorRow(modern.data as RowRecord);
  if (!isLegacyFlavorSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase.from("humor_flavors").insert(buildLegacyFlavorPayload(input)).select("*").single();
  if (legacy.error) throw new Error(legacy.error.message);
  return normalizeFlavorRow(legacy.data as RowRecord);
}

export async function updateHumorFlavor(id: string, input: Partial<FlavorInput>) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("humor_flavors")
      .update({
        slug: input.slug?.trim() || null,
        description: input.description?.trim() || input.name?.trim() || null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeFlavorRow(legacy.data as RowRecord);
  }

  const modern = await supabase
    .from("humor_flavors")
    .update({
      name: input.name?.trim(),
      slug: input.slug?.trim() || null,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      status: input.status?.trim() || null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (!modern.error) return normalizeFlavorRow(modern.data as RowRecord);
  if (!isLegacyFlavorSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("humor_flavors")
    .update({
      slug: input.slug?.trim() || null,
      description: input.description?.trim() || input.name?.trim() || null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (legacy.error) throw new Error(legacy.error.message);
  return normalizeFlavorRow(legacy.data as RowRecord);
}

export async function deleteHumorFlavor(id: string) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { error } = await supabase.from("humor_flavors").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchHumorFlavorSteps(humorFlavorId: string) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("humor_flavor_steps")
      .select("*")
      .eq("humor_flavor_id", humorFlavorId)
      .order("order_by", { ascending: true });

    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []).map((row) => normalizeStepRow(row as RowRecord));
  }

  const modern = await supabase
    .from("humor_flavor_steps")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("step_order", { ascending: true });

  if (!modern.error) return (modern.data ?? []).map((row) => normalizeStepRow(row as RowRecord));
  if (!isLegacyStepSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("humor_flavor_steps")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("order_by", { ascending: true });

  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((row) => normalizeStepRow(row as RowRecord));
}

export async function createHumorFlavorStep(input: StepInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("humor_flavor_steps")
      .insert({
        humor_flavor_id: input.humor_flavor_id,
        ...buildLegacyStepPayload(input, { includeDefaults: true }),
      })
      .select("*")
      .single();

    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeStepRow(legacy.data as RowRecord);
  }

  const modern = await supabase
    .from("humor_flavor_steps")
    .insert({
      humor_flavor_id: input.humor_flavor_id,
      title: input.title.trim(),
      instruction: input.instruction.trim(),
      step_order: input.step_order,
      output_label: input.output_label?.trim() || null,
    })
    .select("*")
    .single();

  if (!modern.error) return normalizeStepRow(modern.data as RowRecord);
  if (!isLegacyStepSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("humor_flavor_steps")
    .insert({
      humor_flavor_id: input.humor_flavor_id,
      ...buildLegacyStepPayload(input, { includeDefaults: true }),
    })
    .select("*")
    .single();

  if (legacy.error) throw new Error(legacy.error.message);
  return normalizeStepRow(legacy.data as RowRecord);
}

export async function updateHumorFlavorStep(id: string, input: Partial<Omit<StepInput, "humor_flavor_id">>) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("humor_flavor_steps")
      .update(buildLegacyStepPayload(input, { includeDefaults: false }))
      .eq("id", id)
      .select("*")
      .single();

    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeStepRow(legacy.data as RowRecord);
  }

  const modern = await supabase
    .from("humor_flavor_steps")
    .update({
      title: input.title?.trim(),
      instruction: input.instruction?.trim(),
      step_order: input.step_order,
      output_label: input.output_label?.trim() || null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (!modern.error) return normalizeStepRow(modern.data as RowRecord);
  if (!isLegacyStepSchemaError(modern.error.message)) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("humor_flavor_steps")
    .update(buildLegacyStepPayload(input, { includeDefaults: false }))
    .eq("id", id)
    .select("*")
    .single();

  if (legacy.error) throw new Error(legacy.error.message);
  return normalizeStepRow(legacy.data as RowRecord);
}

export async function deleteHumorFlavorStep(id: string) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { error } = await supabase.from("humor_flavor_steps").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function reorderHumorFlavorSteps(humorFlavorId: string, stepIdsInOrder: string[]) {
  const supabase = getSupabaseBrowserClientOrThrow();

  for (let index = 0; index < stepIdsInOrder.length; index += 1) {
    const stepId = stepIdsInOrder[index];
    if (PREFER_LEGACY_HUMOR_SCHEMA) {
      const legacy = await supabase
        .from("humor_flavor_steps")
        .update({ order_by: index + 1 })
        .eq("id", stepId)
        .eq("humor_flavor_id", humorFlavorId);

      if (legacy.error) throw new Error(legacy.error.message);
      continue;
    }

    const modern = await supabase
      .from("humor_flavor_steps")
      .update({ step_order: index + 1 })
      .eq("id", stepId)
      .eq("humor_flavor_id", humorFlavorId);

    if (!modern.error) continue;
    if (!isLegacyStepSchemaError(modern.error.message)) throw new Error(modern.error.message);

    const legacy = await supabase
      .from("humor_flavor_steps")
      .update({ order_by: index + 1 })
      .eq("id", stepId)
      .eq("humor_flavor_id", humorFlavorId);

    if (legacy.error) throw new Error(legacy.error.message);
  }
}

export async function fetchPromptChainRuns(humorFlavorId: string, limit = 40) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    return synthesizeLegacyRuns(await fetchLegacyCaptionRows(humorFlavorId, Math.max(limit * 12, 120)));
  }

  const modern = await supabase
    .from("humor_flavor_runs")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!modern.error) {
    return ((modern.data ?? []) as RowRecord[]).map(
      (row) =>
        ({
          ...(row as PromptChainRun),
          id: asString(row.id),
          humor_flavor_id: asString(row.humor_flavor_id),
          image_id: asOptionalString(row.image_id),
          image_url: asOptionalString(row.image_url),
          created_at: asOptionalString(row.created_at),
          created_by: asOptionalString(row.created_by),
          schema_variant: "modern",
        }) satisfies PromptChainRun,
    );
  }

  if (!isMissingTableError(modern.error.message, "humor_flavor_runs")) throw new Error(modern.error.message);
  return synthesizeLegacyRuns(await fetchLegacyCaptionRows(humorFlavorId, Math.max(limit * 12, 120)));
}

export async function fetchGeneratedFlavorCaptions(humorFlavorId: string, limit = 200) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    return normalizeCaptionRows(await fetchLegacyCaptionRows(humorFlavorId, limit));
  }

  const modern = await supabase
    .from("humor_flavor_captions")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!modern.error) return normalizeCaptionRows((modern.data ?? []) as RowRecord[]);
  if (!isMissingTableError(modern.error.message, "humor_flavor_captions")) throw new Error(modern.error.message);

  return normalizeCaptionRows(await fetchLegacyCaptionRows(humorFlavorId, limit));
}

export async function createPromptChainRun(input: RunInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    return {
      id: `legacy-run-${Date.now()}`,
      humor_flavor_id: input.humor_flavor_id,
      image_id: input.image_id ?? null,
      image_url: input.image_url ?? null,
      status: input.status ?? "completed",
      pipeline_model: input.pipeline_model ?? "Legacy caption archive",
      request_payload: input.request_payload ?? null,
      raw_response: input.raw_response ?? null,
      created_at: new Date().toISOString(),
      created_by: input.created_by ?? null,
      schema_variant: "legacy",
    } satisfies PromptChainRun;
  }

  const modern = await supabase
    .from("humor_flavor_runs")
    .insert({
      humor_flavor_id: input.humor_flavor_id,
      image_id: input.image_id ?? null,
      image_url: input.image_url ?? null,
      status: input.status ?? "completed",
      pipeline_model: input.pipeline_model ?? null,
      request_payload: input.request_payload ?? null,
      raw_response: input.raw_response ?? null,
      created_by: input.created_by ?? null,
    })
    .select("*")
    .single();

  if (!modern.error) {
    return {
      ...(modern.data as PromptChainRun),
      id: asString(modern.data.id),
      humor_flavor_id: asString(modern.data.humor_flavor_id),
      created_at: asOptionalString((modern.data as RowRecord).created_at),
      schema_variant: "modern",
    } satisfies PromptChainRun;
  }

  if (!isMissingTableError(modern.error.message, "humor_flavor_runs")) throw new Error(modern.error.message);

  return {
    id: `legacy-run-${Date.now()}`,
    humor_flavor_id: input.humor_flavor_id,
    image_id: input.image_id ?? null,
    image_url: input.image_url ?? null,
    status: input.status ?? "completed",
    pipeline_model: input.pipeline_model ?? "Legacy caption archive",
    request_payload: input.request_payload ?? null,
    raw_response: input.raw_response ?? null,
    created_at: new Date().toISOString(),
    created_by: input.created_by ?? null,
    schema_variant: "legacy",
  } satisfies PromptChainRun;
}

export async function createGeneratedFlavorCaptions(items: CaptionInput[]) {
  if (items.length === 0) return [] as GeneratedFlavorCaption[];

  const supabase = getSupabaseBrowserClientOrThrow();
  if (PREFER_LEGACY_HUMOR_SCHEMA) {
    const legacy = await supabase
      .from("captions")
      .insert(
        items.map((item) => ({
          content: item.caption_text.trim(),
          humor_flavor_id: item.humor_flavor_id,
          image_id: item.image_id ?? null,
          profile_id: item.profile_id ?? null,
          is_public: false,
          is_featured: false,
        })),
      )
      .select("id, created_datetime_utc, content, image_id, humor_flavor_id, llm_prompt_chain_id, profile_id");

    if (legacy.error) throw new Error(legacy.error.message);
    return normalizeCaptionRows((legacy.data ?? []) as RowRecord[], items[0]?.humor_flavor_run_id);
  }

  const modern = await supabase
    .from("humor_flavor_captions")
    .insert(
      items.map((item) => ({
        humor_flavor_run_id: item.humor_flavor_run_id,
        humor_flavor_id: item.humor_flavor_id,
        image_id: item.image_id ?? null,
        caption_text: item.caption_text.trim(),
        rank_index: item.rank_index,
      })),
    )
    .select("*");

  if (!modern.error) return normalizeCaptionRows((modern.data ?? []) as RowRecord[]);
  if (!isMissingTableError(modern.error.message, "humor_flavor_captions")) throw new Error(modern.error.message);

  const legacy = await supabase
    .from("captions")
    .insert(
      items.map((item) => ({
        content: item.caption_text.trim(),
        humor_flavor_id: item.humor_flavor_id,
        image_id: item.image_id ?? null,
        profile_id: item.profile_id ?? null,
        is_public: false,
        is_featured: false,
      })),
    )
    .select("id, created_datetime_utc, content, image_id, humor_flavor_id, llm_prompt_chain_id, profile_id");

  if (legacy.error) throw new Error(legacy.error.message);
  return normalizeCaptionRows((legacy.data ?? []) as RowRecord[], items[0]?.humor_flavor_run_id);
}
