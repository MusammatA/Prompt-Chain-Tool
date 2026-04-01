import { PIPELINE_BASE_URL } from "../supabase-config";
import { getSupabaseBrowserClientOrThrow } from "./client";
import type {
  HumorFlavor,
  HumorFlavorStep,
  ImageTestRecord,
  PipelineGenerationResponse,
  PipelineGeneratedCaption,
} from "../../types";

type UploadFileResult = {
  imageId: string;
  imageUrl: string;
};

type RegisterUrlResult = {
  imageId: string;
  imageUrl: string;
};

type RunFlavorRequest = {
  accessToken: string;
  flavor: HumorFlavor;
  steps: HumorFlavorStep[];
  selectedImage?: ImageTestRecord | null;
  manualImageUrl?: string;
  uploadFile?: File | null;
};

export type RunFlavorResult = {
  requestPayload: Record<string, unknown>;
  responsePayload: PipelineGenerationResponse;
  captions: string[];
  modelTag: string;
  imageId: string;
  imageUrl: string;
};

const PRESIGNED_URL_TIMEOUT_MS = 20_000;
const IMAGE_UPLOAD_TIMEOUT_MS = 90_000;
const IMAGE_REGISTER_TIMEOUT_MS = 45_000;
const GENERATE_CAPTIONS_TIMEOUT_MS = 180_000;
const SCHEDULED_CAPTION_POLL_TIMEOUT_MS = 90_000;
const SCHEDULED_CAPTION_POLL_INTERVAL_MS = 4_000;

type ErrorEnvelope = {
  message?: string | null;
  error?: boolean;
  statusCode?: number;
  statusMessage?: string | null;
};

function looksLikeHtml(bodyText: string) {
  return /<!doctype\s+html|<html[\s>]/i.test(bodyText);
}

function safeParseJson<T>(bodyText: string) {
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

function readEnvelopeMessage(bodyText: string) {
  const parsed = safeParseJson<ErrorEnvelope>(bodyText);
  return String(parsed?.message || "").trim();
}

function isScheduledResponseText(bodyText: string) {
  const trimmed = bodyText.trim();
  const envelopeMessage = readEnvelopeMessage(trimmed);
  return (
    /^scheduled\b/i.test(trimmed) ||
    /^scheduled\b/i.test(envelopeMessage) ||
    envelopeMessage.includes('Unexpected token \'S\'') ||
    envelopeMessage.includes('"Scheduled "') ||
    /scheduled/i.test(envelopeMessage)
  );
}

function isRecoverableJsonParseResponse(bodyText: string) {
  const trimmed = bodyText.trim();
  const envelopeMessage = readEnvelopeMessage(trimmed);
  const candidate = `${trimmed}\n${envelopeMessage}`;
  return /unexpected token/i.test(candidate) && /not valid json/i.test(candidate);
}

function extractErrorMessage(status: number, bodyText: string, requestTarget?: string) {
  const trimmed = bodyText.trim();
  const fallbackTarget = requestTarget || "upstream service";

  if (status === 504) {
    return `The request to ${fallbackTarget} timed out before the server finished processing it. Please try again or use a simpler flavor/image combination.`;
  }

  if (!trimmed) return `Request failed with status ${status}.`;
  if (looksLikeHtml(trimmed)) {
    return `Request to ${fallbackTarget} failed with status ${status}. The upstream service returned an HTML error page instead of JSON.`;
  }
  return `${status}: ${trimmed.slice(0, 220)}`;
}

function describeRequestTarget(input: RequestInfo | URL) {
  const rawValue =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : "url" in input
          ? String(input.url)
          : "";

  try {
    const parsed = new URL(rawValue);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return rawValue || "request";
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const requestTarget = describeRequestTarget(input);
  const timeoutError = new Error(
    `Request to ${requestTarget} timed out after ${Math.ceil(ms / 1000)} seconds. Please try again.`,
  );
  const timer = setTimeout(() => controller.abort(timeoutError), ms);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildPromptChain(flavor: HumorFlavor, steps: HumorFlavorStep[]) {
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const flavorName = flavor.name || "Untitled flavor";
  return [
    `Humor flavor: ${flavorName}`,
    flavor.description ? `Flavor description: ${flavor.description}` : "",
    ...ordered.map(
      (step) =>
        [
          `Step ${step.step_order}: ${step.title.trim()}${step.output_label ? ` -> ${step.output_label.trim()}` : ""}`,
          step.system_prompt?.trim() ? `System prompt:\n${step.system_prompt.trim()}` : "",
          step.instruction.trim() ? `User prompt:\n${step.instruction.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getImageUrl(record?: ImageTestRecord | null) {
  if (!record) return "";
  return String(record.cdn_url || record.public_url || record.image_url || record.url || "").trim();
}

function getCaptionText(item: PipelineGeneratedCaption | null | undefined) {
  const candidates = [
    item?.content,
    item?.caption_text,
    item?.caption,
    item?.text,
    item?.generated_caption,
    item?.meme_text,
    item?.output,
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }

  return "";
}

function extractGeneratedCaptions(payload: PipelineGenerationResponse) {
  if (Array.isArray(payload.captions)) return payload.captions;
  if (payload.data && Array.isArray(payload.data.captions)) return payload.data.captions;
  if (payload.caption && typeof payload.caption === "object") return [payload.caption];
  if (payload.data?.caption && typeof payload.data.caption === "object") return [payload.data.caption];
  if (payload.content || payload.caption_text) {
    return [
      {
        content: payload.content ?? null,
        caption_text: payload.caption_text ?? null,
      },
    ];
  }
  return [] as PipelineGeneratedCaption[];
}

function extractModelTag(payload: PipelineGenerationResponse) {
  return String(payload.model || payload.modelTag || payload.model_name || payload.generator || "caption-pipeline-v1");
}

function getCaptionTextFromRow(row: Record<string, unknown>) {
  const candidates = [row.caption_text, row.content, row.text, row.generated_caption, row.output];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return "";
}

function getRowCreatedAt(row: Record<string, unknown>) {
  const raw = String(row.created_datetime_utc || row.created_at || "").trim();
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseRecoveredCaptionRows(
  rows: Array<Record<string, unknown>>,
  options: {
    imageId: string;
    requestStartedAtMs: number;
    baselineCaptionIds: Set<string>;
  },
) {
  const { imageId, requestStartedAtMs, baselineCaptionIds } = options;
  const requestFloorMs = requestStartedAtMs - 10_000;

  const withIds = rows.filter((row) => String(row.id || "").trim());
  const sameImage = withIds.filter((row) => String(row.image_id || "").trim() === imageId);
  const recent = withIds.filter((row) => getRowCreatedAt(row) >= requestFloorMs);
  const sameImageRecent = sameImage.filter((row) => getRowCreatedAt(row) >= requestFloorMs);
  const unseen = withIds.filter((row) => !baselineCaptionIds.has(String(row.id || "").trim()));
  const sameImageUnseen = sameImage.filter((row) => !baselineCaptionIds.has(String(row.id || "").trim()));
  const recentUnseen = recent.filter((row) => !baselineCaptionIds.has(String(row.id || "").trim()));

  return (
    sameImageUnseen.length
      ? sameImageUnseen
      : sameImageRecent.length
        ? sameImageRecent
        : recentUnseen.length
          ? recentUnseen
          : sameImage.length
            ? sameImage
            : recent.length
              ? recent
              : unseen.length
                ? unseen
                : []
  );
}

async function fetchLegacyCaptionRowsForFlavor(humorFlavorId: string, limit = 40) {
  if (!humorFlavorId) return [] as Array<Record<string, unknown>>;

  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("captions")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .order("created_datetime_utc", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function fetchLegacyCaptionRowsForImage(humorFlavorId: string, imageId: string) {
  if (!humorFlavorId || !imageId) return [] as Array<Record<string, unknown>>;

  const supabase = getSupabaseBrowserClientOrThrow();
  const { data, error } = await supabase
    .from("captions")
    .select("*")
    .eq("humor_flavor_id", humorFlavorId)
    .eq("image_id", imageId)
    .order("created_datetime_utc", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function pollForScheduledCaptions(humorFlavorId: string, imageId: string, baselineCaptionIds: Set<string>) {
  const deadline = Date.now() + SCHEDULED_CAPTION_POLL_TIMEOUT_MS;
  const requestStartedAtMs = Date.now();

  while (Date.now() < deadline) {
    const [flavorRows, imageRows] = await Promise.all([
      fetchLegacyCaptionRowsForFlavor(humorFlavorId, 40),
      fetchLegacyCaptionRowsForImage(humorFlavorId, imageId),
    ]);
    const rows = imageRows.length ? imageRows : flavorRows;
    const candidateRows = chooseRecoveredCaptionRows(rows, {
      imageId,
      requestStartedAtMs,
      baselineCaptionIds,
    });
    const captions = candidateRows.map((row) => getCaptionTextFromRow(row)).filter(Boolean);
    if (captions.length) {
      return {
        responsePayload: {
          generator: "scheduled-caption-fallback",
          data: {
            captions: captions.map((caption_text) => ({ caption_text })),
          },
        } satisfies PipelineGenerationResponse,
        captions,
      };
    }

    await new Promise((resolve) => window.setTimeout(resolve, SCHEDULED_CAPTION_POLL_INTERVAL_MS));
  }

  const fallbackRows = await fetchLegacyCaptionRowsForFlavor(humorFlavorId, 40);
  const fallbackCandidates = chooseRecoveredCaptionRows(fallbackRows, {
    imageId,
    requestStartedAtMs,
    baselineCaptionIds,
  });
  const fallbackCaptions = fallbackCandidates.map((row) => getCaptionTextFromRow(row)).filter(Boolean);
  if (fallbackCaptions.length) {
    return {
      responsePayload: {
        generator: "scheduled-caption-fallback",
        data: {
          captions: fallbackCaptions.map((caption_text) => ({ caption_text })),
        },
      } satisfies PipelineGenerationResponse,
      captions: fallbackCaptions,
    };
  }

  return null;
}

async function uploadFileToPipeline(accessToken: string, file: File): Promise<UploadFileResult> {
  const presignedUrlEndpoint = `${PIPELINE_BASE_URL}/pipeline/generate-presigned-url`;
  const step1Res = await fetchWithTimeout(
    presignedUrlEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contentType: file.type }),
    },
    PRESIGNED_URL_TIMEOUT_MS,
  );

  if (!step1Res.ok) {
    throw new Error(extractErrorMessage(step1Res.status, await step1Res.text(), describeRequestTarget(presignedUrlEndpoint)));
  }

  const step1Data = (await step1Res.json()) as { presignedUrl?: string; cdnUrl?: string };
  if (!step1Data.presignedUrl || !step1Data.cdnUrl) {
    throw new Error("The pipeline did not return a usable upload URL.");
  }

  const step2Res = await fetchWithTimeout(
    step1Data.presignedUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    },
    IMAGE_UPLOAD_TIMEOUT_MS,
  );

  if (!step2Res.ok) {
    throw new Error(extractErrorMessage(step2Res.status, await step2Res.text(), describeRequestTarget(step1Data.presignedUrl)));
  }

  const registered = await registerRemoteImage(accessToken, step1Data.cdnUrl);
  return {
    imageId: registered.imageId,
    imageUrl: registered.imageUrl,
  };
}

async function registerRemoteImage(accessToken: string, imageUrl: string): Promise<RegisterUrlResult> {
  const registerEndpoint = `${PIPELINE_BASE_URL}/pipeline/upload-image-from-url`;
  const res = await fetchWithTimeout(
    registerEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageUrl,
        isCommonUse: false,
      }),
    },
    IMAGE_REGISTER_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(extractErrorMessage(res.status, await res.text(), describeRequestTarget(registerEndpoint)));
  }

  const data = (await res.json()) as { imageId?: string };
  if (!data.imageId) {
    throw new Error("The pipeline did not return an image id.");
  }

  return {
    imageId: data.imageId,
    imageUrl,
  };
}

export async function runFlavorPromptChain(request: RunFlavorRequest): Promise<RunFlavorResult> {
  const { accessToken, flavor, steps, selectedImage, manualImageUrl, uploadFile } = request;
  const orderedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);

  if (!orderedSteps.length) {
    throw new Error("Add at least one step before testing a humor flavor.");
  }

  let imageId = String(selectedImage?.id || "").trim();
  let imageUrl = getImageUrl(selectedImage);

  if (uploadFile) {
    const uploaded = await uploadFileToPipeline(accessToken, uploadFile);
    imageId = uploaded.imageId;
    imageUrl = uploaded.imageUrl;
  } else if (manualImageUrl?.trim()) {
    const registered = await registerRemoteImage(accessToken, manualImageUrl.trim());
    imageId = registered.imageId;
    imageUrl = registered.imageUrl;
  } else if (imageUrl) {
    const registered = await registerRemoteImage(accessToken, imageUrl);
    imageId = registered.imageId;
    imageUrl = registered.imageUrl;
  }

  if (!imageId) {
    throw new Error("Choose a test-set image, paste an image URL, or upload a file before running the prompt chain.");
  }

  let baselineCaptionIds = new Set<string>();
  try {
    const baselineRows = await fetchLegacyCaptionRowsForImage(flavor.id, imageId);
    baselineCaptionIds = new Set(
      baselineRows.map((row) => String(row.id || "").trim()).filter(Boolean),
    );
  } catch {
    baselineCaptionIds = new Set<string>();
  }

  const requestPayload = {
    imageId,
    humorFlavorId: flavor.id,
    humorFlavorName: flavor.name,
    promptChain: buildPromptChain(flavor, orderedSteps),
    steps: orderedSteps.map((step) => ({
      id: step.id,
      order: step.step_order,
      title: step.title,
      systemPrompt: step.system_prompt ?? null,
      instruction: step.instruction,
      outputLabel: step.output_label ?? null,
    })),
  };

  const generateCaptionsEndpoint = `${PIPELINE_BASE_URL}/pipeline/generate-captions`;
  const res = await fetchWithTimeout(
    generateCaptionsEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    },
    GENERATE_CAPTIONS_TIMEOUT_MS,
  );

  if (!res.ok) {
    const bodyText = await res.text();
    if (isScheduledResponseText(bodyText) || isRecoverableJsonParseResponse(bodyText)) {
      const scheduledResult = await pollForScheduledCaptions(flavor.id, imageId, baselineCaptionIds);
      if (scheduledResult) {
        return {
          requestPayload,
          responsePayload: scheduledResult.responsePayload,
          captions: scheduledResult.captions,
          modelTag: "scheduled-caption-fallback",
          imageId,
          imageUrl,
        };
      }
    }

    throw new Error(extractErrorMessage(res.status, bodyText, describeRequestTarget(generateCaptionsEndpoint)));
  }

  const responseText = await res.text();
  const responsePayload = safeParseJson<PipelineGenerationResponse>(responseText);
  if (!responsePayload) {
    if (isScheduledResponseText(responseText) || isRecoverableJsonParseResponse(responseText)) {
      const scheduledResult = await pollForScheduledCaptions(flavor.id, imageId, baselineCaptionIds);
      if (scheduledResult) {
        return {
          requestPayload,
          responsePayload: scheduledResult.responsePayload,
          captions: scheduledResult.captions,
          modelTag: "scheduled-caption-fallback",
          imageId,
          imageUrl,
        };
      }
    }

    throw new Error("The caption API returned a non-JSON response.");
  }

  const captions = extractGeneratedCaptions(responsePayload)
    .map((item) => getCaptionText(item))
    .filter(Boolean);

  return {
    requestPayload,
    responsePayload,
    captions,
    modelTag: extractModelTag(responsePayload),
    imageId,
    imageUrl,
  };
}
