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
};

export type RunFlavorResult = {
  requestPayload: Record<string, unknown>;
  responsePayload: PipelineGenerationResponse;
  captions: string[];
  modelTag: string;
  imageId: string;
  imageUrl: string;
};

function extractErrorMessage(status: number, bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed) return `Request failed with status ${status}.`;
  return `${status}: ${trimmed.slice(0, 220)}`;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
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

async function uploadFileToPipeline(accessToken: string, file: File): Promise<UploadFileResult> {
  const step1Res = await fetchWithTimeout(
    `${PIPELINE_BASE_URL}/pipeline/generate-presigned-url`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contentType: file.type }),
    },
    20000,
  );

  if (!step1Res.ok) {
    throw new Error(extractErrorMessage(step1Res.status, await step1Res.text()));
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
    45000,
  );

  if (!step2Res.ok) {
    throw new Error(extractErrorMessage(step2Res.status, await step2Res.text()));
  }

  const registered = await registerRemoteImage(accessToken, step1Data.cdnUrl);
  return {
    imageId: registered.imageId,
    imageUrl: registered.imageUrl,
  };
}

async function registerRemoteImage(accessToken: string, imageUrl: string): Promise<RegisterUrlResult> {
  const res = await fetchWithTimeout(
    `${PIPELINE_BASE_URL}/pipeline/upload-image-from-url`,
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
    20000,
  );

  if (!res.ok) {
    throw new Error(extractErrorMessage(res.status, await res.text()));
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
  } else if (!imageId && imageUrl) {
    const registered = await registerRemoteImage(accessToken, imageUrl);
    imageId = registered.imageId;
    imageUrl = registered.imageUrl;
  }

  if (!imageId) {
    throw new Error("Choose a test-set image, paste an image URL, or upload a file before running the prompt chain.");
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

  const res = await fetchWithTimeout(
    `${PIPELINE_BASE_URL}/pipeline/generate-captions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    },
    45000,
  );

  if (!res.ok) {
    throw new Error(extractErrorMessage(res.status, await res.text()));
  }

  const responsePayload = (await res.json()) as PipelineGenerationResponse;
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
