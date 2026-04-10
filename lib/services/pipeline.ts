import { PIPELINE_BASE_URL } from "../supabase-config";
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
  onStatus?: (message: string) => void;
};

type PipelineStepPayload = {
  id: string;
  order: number;
  title: string;
  systemPrompt: string | null;
  instruction: string;
  outputLabel: string | null;
};

export type RunFlavorResult = {
  requestPayload: Record<string, unknown>;
  responsePayload: PipelineGenerationResponse;
  captions: string[];
  modelTag: string;
  imageId: string;
  imageUrl: string;
};

type GenerateCaptionsPayload = Record<string, unknown>;
type GenerateCaptionsResponseCandidate =
  | PipelineGenerationResponse
  | PipelineGeneratedCaption[]
  | (Record<string, unknown> & {
      records?: PipelineGeneratedCaption[] | null;
      data?: PipelineGeneratedCaption[] | PipelineGenerationResponse["data"] | null;
    });

const PRESIGNED_URL_TIMEOUT_MS = 20_000;
const IMAGE_UPLOAD_TIMEOUT_MS = 90_000;
const IMAGE_REGISTER_TIMEOUT_MS = 45_000;
const GENERATE_CAPTIONS_TIMEOUT_MS = 30_000;
const SCHEDULED_CAPTION_POLL_TIMEOUT_MS = 90_000;
const SCHEDULED_CAPTION_POLL_INTERVAL_MS = 4_000;
const RECOVERY_ROUTE_TIMEOUT_MS = 15_000;
const EARLY_RECOVERY_POLL_TIMEOUT_MS = 18_000;

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

function buildFinalCaptionJsonInstruction(instruction: string) {
  const trimmed = instruction.trim();
  const jsonReminder =
    'Return only valid JSON with this exact shape: {"captions":["caption 1","caption 2","caption 3","caption 4","caption 5"]}. Do not include markdown, labels, numbering, or any extra text.';

  if (/\"captions\"\s*:\s*\[/i.test(trimmed) || /valid json/i.test(trimmed)) {
    return trimmed;
  }

  return [trimmed, jsonReminder].filter(Boolean).join("\n\n");
}

function normalizePipelineSteps(steps: HumorFlavorStep[]) {
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);

  return ordered.map((step, index) => {
    const isFinalStep = index === ordered.length - 1;
    return {
      id: step.id,
      order: step.step_order,
      title: step.title,
      systemPrompt: step.system_prompt ?? null,
      instruction: isFinalStep ? buildFinalCaptionJsonInstruction(step.instruction) : step.instruction,
      outputLabel: step.output_label ?? null,
    } satisfies PipelineStepPayload;
  });
}

function buildPromptChain(flavor: HumorFlavor, steps: PipelineStepPayload[]) {
  const flavorName = flavor.name || "Untitled flavor";
  return [
    `Humor flavor: ${flavorName}`,
    flavor.description ? `Flavor description: ${flavor.description}` : "",
    ...steps.map(
      (step) =>
        [
          `Step ${step.order}: ${step.title.trim()}${step.outputLabel ? ` -> ${step.outputLabel.trim()}` : ""}`,
          step.systemPrompt?.trim() ? `System prompt:\n${step.systemPrompt.trim()}` : "",
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

function normalizeGenerationResponse(payload: GenerateCaptionsResponseCandidate): PipelineGenerationResponse {
  if (Array.isArray(payload)) {
    return { captions: payload };
  }

  if (Array.isArray(payload.records)) {
    const { records, data, ...rest } = payload;
    return {
      ...rest,
      captions: records,
    };
  }

  if (Array.isArray(payload.data)) {
    const { data, ...rest } = payload;
    return {
      ...rest,
      data: {
        captions: data,
      },
    };
  }

  return payload as PipelineGenerationResponse;
}

function extractGeneratedCaptions(payload: GenerateCaptionsResponseCandidate) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.data)) return payload.data;
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

function shouldRetryWithLegacyPayload(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /(^|\s)(500|502|503|504):/.test(message) ||
    /server error/i.test(message) ||
    /timed out/i.test(message) ||
    /timeout/i.test(message) ||
    /unexpected token/i.test(message) ||
    /non-json response/i.test(message) ||
    /html error page/i.test(message)
  );
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

async function fetchRecoveryCaptionRowsForFlavor(humorFlavorId: string, limit = 40) {
  if (!humorFlavorId) return [] as Array<Record<string, unknown>>;

  const url = `/api/caption-recovery?flavorId=${encodeURIComponent(humorFlavorId)}&limit=${encodeURIComponent(String(limit))}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
    RECOVERY_ROUTE_TIMEOUT_MS,
  );

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(extractErrorMessage(res.status, bodyText, describeRequestTarget(url)));
  }

  const payload = safeParseJson<{ rows?: Array<Record<string, unknown>> }>(bodyText);
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

async function pollForScheduledCaptions(
  humorFlavorId: string,
  imageId: string,
  baselineCaptionIds: Set<string>,
  timeoutMs = SCHEDULED_CAPTION_POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  const requestStartedAtMs = Date.now();

  while (Date.now() < deadline) {
    const rows = await fetchRecoveryCaptionRowsForFlavor(humorFlavorId, 40);
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

  const fallbackRows = await fetchRecoveryCaptionRowsForFlavor(humorFlavorId, 40);
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

async function requestGeneratedCaptionsFromApi(options: {
  accessToken: string;
  payload: GenerateCaptionsPayload;
  imageId: string;
  imageUrl: string;
  flavorId: string;
  baselineCaptionIds: Set<string>;
}) {
  const { accessToken, payload, imageId, imageUrl, flavorId, baselineCaptionIds } = options;
  const generateCaptionsEndpoint = `${PIPELINE_BASE_URL}/pipeline/generate-captions`;
  const res = await fetchWithTimeout(
    generateCaptionsEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    GENERATE_CAPTIONS_TIMEOUT_MS,
  );

  if (!res.ok) {
    const bodyText = await res.text();
    if (isScheduledResponseText(bodyText) || isRecoverableJsonParseResponse(bodyText)) {
      const scheduledResult = await pollForScheduledCaptions(flavorId, imageId, baselineCaptionIds);
      if (scheduledResult) {
        return {
          requestPayload: payload,
          responsePayload: scheduledResult.responsePayload,
          captions: scheduledResult.captions,
          modelTag: "scheduled-caption-fallback",
          imageId,
          imageUrl,
        } satisfies RunFlavorResult;
      }
    }

    throw new Error(extractErrorMessage(res.status, bodyText, describeRequestTarget(generateCaptionsEndpoint)));
  }

  const responseText = await res.text();
  const parsed = safeParseJson<GenerateCaptionsResponseCandidate>(responseText);
  if (!parsed) {
    if (isScheduledResponseText(responseText) || isRecoverableJsonParseResponse(responseText)) {
      const scheduledResult = await pollForScheduledCaptions(flavorId, imageId, baselineCaptionIds);
      if (scheduledResult) {
        return {
          requestPayload: payload,
          responsePayload: scheduledResult.responsePayload,
          captions: scheduledResult.captions,
          modelTag: "scheduled-caption-fallback",
          imageId,
          imageUrl,
        } satisfies RunFlavorResult;
      }
    }

    throw new Error("The caption API returned a non-JSON response.");
  }

  const responsePayload = normalizeGenerationResponse(parsed);
  const captions = extractGeneratedCaptions(parsed)
    .map((item) => getCaptionText(item))
    .filter(Boolean);

  return {
    requestPayload: payload,
    responsePayload,
    captions,
    modelTag: extractModelTag(responsePayload),
    imageId,
    imageUrl,
  } satisfies RunFlavorResult;
}

function createEarlyRecoveryAttempt(options: {
  payload: GenerateCaptionsPayload;
  imageId: string;
  imageUrl: string;
  flavorId: string;
  baselineCaptionIds: Set<string>;
}) {
  const { payload, imageId, imageUrl, flavorId, baselineCaptionIds } = options;

  return new Promise<RunFlavorResult>((resolve) => {
    void pollForScheduledCaptions(flavorId, imageId, baselineCaptionIds, EARLY_RECOVERY_POLL_TIMEOUT_MS)
      .then((scheduledResult) => {
        if (!scheduledResult) return;

        resolve({
          requestPayload: payload,
          responsePayload: scheduledResult.responsePayload,
          captions: scheduledResult.captions,
          modelTag: "scheduled-caption-fallback",
          imageId,
          imageUrl,
        } satisfies RunFlavorResult);
      })
      .catch(() => {
        // Ignore recovery polling errors here and let the main API attempt decide the result.
      });
  });
}

async function requestGeneratedCaptions(options: {
  accessToken: string;
  payload: GenerateCaptionsPayload;
  imageId: string;
  imageUrl: string;
  flavorId: string;
  baselineCaptionIds: Set<string>;
}) {
  const apiAttempt = requestGeneratedCaptionsFromApi(options);
  const recoveryAttempt = createEarlyRecoveryAttempt(options);

  const result = await Promise.race([
    apiAttempt.then(
      (value) => ({ kind: "api" as const, value }),
      (error) => ({ kind: "error" as const, error }),
    ),
    recoveryAttempt.then((value) => ({ kind: "recovery" as const, value })),
  ]);

  if (result.kind === "recovery") {
    void apiAttempt.catch(() => undefined);
    return result.value;
  }

  if (result.kind === "api") {
    return result.value;
  }

  throw result.error;
}

export async function runFlavorPromptChain(request: RunFlavorRequest): Promise<RunFlavorResult> {
  const { accessToken, flavor, steps, selectedImage, manualImageUrl, uploadFile, onStatus } = request;
  const orderedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);
  const pipelineSteps = normalizePipelineSteps(orderedSteps);

  if (!orderedSteps.length) {
    throw new Error("Add at least one step before testing a humor flavor.");
  }

  let imageId = String(selectedImage?.id || "").trim();
  let imageUrl = getImageUrl(selectedImage);

  if (uploadFile) {
    onStatus?.("Uploading image");
    const uploaded = await uploadFileToPipeline(accessToken, uploadFile);
    imageId = uploaded.imageId;
    imageUrl = uploaded.imageUrl;
  } else if (manualImageUrl?.trim()) {
    onStatus?.("Registering image URL");
    const registered = await registerRemoteImage(accessToken, manualImageUrl.trim());
    imageId = registered.imageId;
    imageUrl = registered.imageUrl;
  } else if (imageUrl) {
    onStatus?.("Registering selected image");
    const registered = await registerRemoteImage(accessToken, imageUrl);
    imageId = registered.imageId;
    imageUrl = registered.imageUrl;
  }

  if (!imageId) {
    throw new Error("Choose a test-set image, paste an image URL, or upload a file before running the prompt chain.");
  }

  let baselineCaptionIds = new Set<string>();
  try {
    onStatus?.("Checking saved captions");
    const baselineRows = await fetchRecoveryCaptionRowsForFlavor(flavor.id, 40);
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
    promptChain: buildPromptChain(flavor, pipelineSteps),
    steps: pipelineSteps,
  };

  try {
    onStatus?.("Running flavor");
    return await requestGeneratedCaptions({
      accessToken,
      payload: requestPayload,
      imageId,
      imageUrl,
      flavorId: flavor.id,
      baselineCaptionIds,
    });
  } catch (primaryError) {
    if (!shouldRetryWithLegacyPayload(primaryError)) {
      throw primaryError;
    }

    const recoveredPrimaryResult = await pollForScheduledCaptions(
      flavor.id,
      imageId,
      baselineCaptionIds,
      10_000,
    );
    if (recoveredPrimaryResult) {
      onStatus?.("Recovered saved captions");
      return {
        requestPayload,
        responsePayload: recoveredPrimaryResult.responsePayload,
        captions: recoveredPrimaryResult.captions,
        modelTag: "scheduled-caption-fallback",
        imageId,
        imageUrl,
      };
    }

    const legacyPayload = { imageId };
    onStatus?.("Retrying simple caption mode");
    const legacyResult = await requestGeneratedCaptions({
      accessToken,
      payload: legacyPayload,
      imageId,
      imageUrl,
      flavorId: flavor.id,
      baselineCaptionIds,
    });

    return {
      ...legacyResult,
      requestPayload: {
        mode: "legacy-image-id-fallback",
        originalPromptChainPayload: requestPayload,
        legacyPayload,
      },
    };
  }
}
