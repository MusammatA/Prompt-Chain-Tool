export type DatabaseRow = Record<string, unknown>;

export type ThemeMode = "system" | "light" | "dark";

export interface Profile extends DatabaseRow {
  id: string;
  email?: string | null;
  full_name?: string | null;
  username?: string | null;
  is_superadmin?: boolean | null;
  is_matrix_admin?: boolean | null;
}

export interface AdminStatus {
  authenticated: boolean;
  canAccessAdmin: boolean;
  email: string;
  reason?: string;
}

export interface HumorFlavor extends DatabaseRow {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  schema_variant?: "modern" | "legacy";
}

export interface HumorFlavorStep extends DatabaseRow {
  id: string;
  humor_flavor_id: string;
  title: string;
  instruction: string;
  step_order: number;
  output_label?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  system_prompt?: string | null;
  user_prompt?: string | null;
  llm_temperature?: number | null;
  llm_input_type_id?: number | null;
  llm_output_type_id?: number | null;
  llm_model_id?: number | null;
  humor_flavor_step_type_id?: number | null;
  schema_variant?: "modern" | "legacy";
}

export interface ImageTestRecord extends DatabaseRow {
  id: string;
  image_url?: string | null;
  public_url?: string | null;
  cdn_url?: string | null;
  url?: string | null;
  created_at?: string | null;
  additional_context?: string | null;
  image_description?: string | null;
}

export interface PromptChainRun extends DatabaseRow {
  id: string;
  humor_flavor_id: string;
  image_id?: string | null;
  image_url?: string | null;
  status?: string | null;
  pipeline_model?: string | null;
  request_payload?: unknown;
  raw_response?: unknown;
  created_at?: string | null;
  created_by?: string | null;
  schema_variant?: "modern" | "legacy";
}

export interface GeneratedFlavorCaption extends DatabaseRow {
  id: string;
  humor_flavor_run_id: string;
  humor_flavor_id: string;
  image_id?: string | null;
  caption_text: string;
  rank_index?: number | null;
  created_at?: string | null;
  source_table?: string | null;
}

export interface PipelineUploadRegistration {
  imageId: string;
}

export interface PipelineGeneratedCaption {
  id?: string;
  content?: string | null;
  caption_text?: string | null;
  caption?: string | null;
  text?: string | null;
  generated_caption?: string | null;
  meme_text?: string | null;
  output?: string | null;
}

export interface PipelineGenerationResponse extends DatabaseRow {
  model?: string | null;
  modelTag?: string | null;
  model_name?: string | null;
  generator?: string | null;
  captions?: PipelineGeneratedCaption[] | null;
  data?: {
    captions?: PipelineGeneratedCaption[] | null;
    caption?: PipelineGeneratedCaption | null;
  } | null;
  caption?: PipelineGeneratedCaption | null;
  content?: string | null;
  caption_text?: string | null;
}
