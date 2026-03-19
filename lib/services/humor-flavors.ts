import type {
  GeneratedFlavorCaption,
  HumorFlavor,
  HumorFlavorStep,
  PromptChainRun,
} from "../../types";
import { getSupabaseBrowserClientOrThrow } from "./client";

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
};

function normalizeFlavorInput(input: FlavorInput) {
  return {
    name: input.name.trim(),
    slug: input.slug?.trim() || null,
    description: input.description?.trim() || null,
    notes: input.notes?.trim() || null,
    status: input.status?.trim() || "draft",
  };
}

export async function fetchHumorFlavors(limit = 100) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("humor_flavors")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as HumorFlavor[];
}

export async function createHumorFlavor(input: FlavorInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const payload = normalizeFlavorInput(input);
  const { data, error } = await supabase.from("humor_flavors").insert(payload).select("*").single();

  if (error) throw new Error(error.message);
  return data as HumorFlavor;
}

export async function updateHumorFlavor(id: string, input: Partial<FlavorInput>) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
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

  if (error) throw new Error(error.message);
  return data as HumorFlavor;
}

export async function deleteHumorFlavor(id: string) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { error } = await supabase.from("humor_flavors").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchHumorFlavorSteps(humorFlavorId: string) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("humor_flavor_steps")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("step_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as HumorFlavorStep[];
}

export async function createHumorFlavorStep(input: StepInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
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

  if (error) throw new Error(error.message);
  return data as HumorFlavorStep;
}

export async function updateHumorFlavorStep(id: string, input: Partial<Omit<StepInput, "humor_flavor_id">>) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
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

  if (error) throw new Error(error.message);
  return data as HumorFlavorStep;
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
    const { error } = await supabase
      .from("humor_flavor_steps")
      .update({ step_order: index + 1 })
      .eq("id", stepId)
      .eq("humor_flavor_id", humorFlavorId);

    if (error) throw new Error(error.message);
  }
}

export async function fetchPromptChainRuns(humorFlavorId: string, limit = 40) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("humor_flavor_runs")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as PromptChainRun[];
}

export async function fetchGeneratedFlavorCaptions(humorFlavorId: string, limit = 200) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("humor_flavor_captions")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as GeneratedFlavorCaption[];
}

export async function createPromptChainRun(input: RunInput) {
  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
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

  if (error) throw new Error(error.message);
  return data as PromptChainRun;
}

export async function createGeneratedFlavorCaptions(items: CaptionInput[]) {
  if (items.length === 0) return [] as GeneratedFlavorCaption[];

  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
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

  if (error) throw new Error(error.message);
  return (data ?? []) as GeneratedFlavorCaption[];
}
