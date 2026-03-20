"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileImage,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  TestTube2,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import type {
  GeneratedFlavorCaption,
  HumorFlavor,
  HumorFlavorStep,
  ImageTestRecord,
  PromptChainRun,
} from "../../types";
import {
  createGeneratedFlavorCaptions,
  createHumorFlavor,
  createHumorFlavorStep,
  createPromptChainRun,
  deleteHumorFlavor,
  deleteHumorFlavorStep,
  fetchGeneratedFlavorCaptions,
  fetchHumorFlavors,
  fetchHumorFlavorSteps,
  fetchPromptChainRuns,
  reorderHumorFlavorSteps,
  updateHumorFlavor,
  updateHumorFlavorStep,
} from "../../lib/services/humor-flavors";
import { fetchImageTestSet } from "../../lib/services/images";
import { runFlavorPromptChain, type RunFlavorResult } from "../../lib/services/pipeline";
import { getCurrentSessionOrThrow, getErrorMessage } from "../../lib/services/client";

type WorkflowTab = "flavor" | "steps" | "tester" | "archive";

type FlavorStudioProps = {
  activeTab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
};

type FlavorDraft = {
  name: string;
  slug: string;
  description: string;
  notes: string;
  status: string;
};

type StepDraft = {
  title: string;
  instruction: string;
  system_prompt: string;
  output_label: string;
};

type LatestRunState = RunFlavorResult & {
  persistedRunId?: string;
  storageWarning?: string;
};

const EMPTY_FLAVOR_DRAFT: FlavorDraft = {
  name: "",
  slug: "",
  description: "",
  notes: "",
  status: "draft",
};

const EMPTY_STEP_DRAFT: StepDraft = {
  title: "",
  instruction: "",
  system_prompt: "",
  output_label: "",
};

const WORKFLOW_STEPS: Array<{ id: WorkflowTab; title: string; hint: string }> = [
  { id: "flavor", title: "Flavor", hint: "Save the flavor basics first." },
  { id: "steps", title: "Steps", hint: "Write and order the prompt steps." },
  { id: "tester", title: "Tester", hint: "Run the flavor against an image." },
  { id: "archive", title: "Archive", hint: "Review saved caption batches." },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatStepPreview(step: HumorFlavorStep) {
  return [
    `Step ${step.step_order}: ${step.title}${step.output_label ? ` -> ${step.output_label}` : ""}`,
    step.system_prompt?.trim() ? `System prompt:\n${step.system_prompt.trim()}` : "",
    step.instruction.trim() ? `User prompt:\n${step.instruction.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getImageUrl(record?: ImageTestRecord | null) {
  return String(record?.cdn_url || record?.public_url || record?.image_url || record?.url || "").trim();
}

function applyFlavorDraft(flavor: HumorFlavor | null): FlavorDraft {
  if (!flavor) return { ...EMPTY_FLAVOR_DRAFT };
  return {
    name: String(flavor.name || ""),
    slug: String(flavor.slug || ""),
    description: String(flavor.description || ""),
    notes: String(flavor.notes || ""),
    status: String(flavor.status || "draft"),
  };
}

function defaultNewFlavorDraft() {
  return {
    ...EMPTY_FLAVOR_DRAFT,
    name: "Untitled Humor Flavor",
    slug: `flavor-${Date.now()}`,
  };
}

export function FlavorStudio({ activeTab, onTabChange }: FlavorStudioProps) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loadingFlavorData, setLoadingFlavorData] = useState(false);
  const [savingFlavor, setSavingFlavor] = useState(false);
  const [stepActionId, setStepActionId] = useState("");
  const [flavors, setFlavors] = useState<HumorFlavor[]>([]);
  const [steps, setSteps] = useState<HumorFlavorStep[]>([]);
  const [runs, setRuns] = useState<PromptChainRun[]>([]);
  const [captions, setCaptions] = useState<GeneratedFlavorCaption[]>([]);
  const [images, setImages] = useState<ImageTestRecord[]>([]);
  const [selectedFlavorId, setSelectedFlavorId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [isCreatingFlavor, setIsCreatingFlavor] = useState(false);
  const [flavorDraft, setFlavorDraft] = useState<FlavorDraft>(EMPTY_FLAVOR_DRAFT);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [globalError, setGlobalError] = useState("");
  const [imageLibraryError, setImageLibraryError] = useState("");
  const [flashMessage, setFlashMessage] = useState("");
  const [selectedImageId, setSelectedImageId] = useState("");
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [runningTest, setRunningTest] = useState(false);
  const [runError, setRunError] = useState("");
  const [latestRun, setLatestRun] = useState<LatestRunState | null>(null);

  const selectedFlavor = flavors.find((item) => item.id === selectedFlavorId) ?? null;
  const usesLegacyFlavorSchema = selectedFlavor?.schema_variant === "legacy";
  const selectedImage = images.find((item) => item.id === selectedImageId) ?? null;
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? runs[0] ?? null;
  const orderedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);
  const visibleCaptions = selectedRun
    ? captions.filter((item) => item.humor_flavor_run_id === selectedRun.id)
    : captions;
  const activeStepIndex = Math.max(
    0,
    WORKFLOW_STEPS.findIndex((step) => step.id === activeTab),
  );
  const promptChainPreview = orderedSteps
    .map((step) => formatStepPreview(step))
    .join("\n\n");

  async function loadBaseData(preferredFlavorId?: string) {
    setBootstrapping(true);
    setGlobalError("");
    setImageLibraryError("");

    const [flavorResult, imageResult] = await Promise.allSettled([fetchHumorFlavors(), fetchImageTestSet(48)]);
    let nextFlavors: HumorFlavor[] = [];

    if (flavorResult.status === "fulfilled") {
      nextFlavors = flavorResult.value;
      setFlavors(nextFlavors);
    } else {
      setFlavors([]);
      setGlobalError(getErrorMessage(flavorResult.reason));
    }

    if (imageResult.status === "fulfilled") {
      setImages(imageResult.value);
    } else {
      setImages([]);
      setImageLibraryError(getErrorMessage(imageResult.reason));
    }

    const nextSelectedFlavorId =
      preferredFlavorId && nextFlavors.some((item) => item.id === preferredFlavorId)
        ? preferredFlavorId
        : nextFlavors[0]?.id || "";

    if (nextSelectedFlavorId) {
      setSelectedFlavorId(nextSelectedFlavorId);
      setIsCreatingFlavor(false);
    } else {
      setSelectedFlavorId("");
      setIsCreatingFlavor(true);
      setFlavorDraft(defaultNewFlavorDraft());
    }

    setBootstrapping(false);
  }

  async function loadFlavorData(flavorId: string) {
    if (!flavorId) {
      setSteps([]);
      setRuns([]);
      setCaptions([]);
      setSelectedRunId("");
      return;
    }

    setLoadingFlavorData(true);
    setGlobalError("");

    try {
      const [stepsData, runData, captionData] = await Promise.all([
        fetchHumorFlavorSteps(flavorId),
        fetchPromptChainRuns(flavorId),
        fetchGeneratedFlavorCaptions(flavorId),
      ]);

      setSteps(stepsData);
      setRuns(runData);
      setCaptions(captionData);
      setSelectedRunId(runData[0]?.id || "");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      setSteps([]);
      setRuns([]);
      setCaptions([]);
      setSelectedRunId("");
    } finally {
      setLoadingFlavorData(false);
    }
  }

  useEffect(() => {
    void loadBaseData();
  }, []);

  useEffect(() => {
    if (!selectedFlavorId) return;
    const flavor = flavors.find((item) => item.id === selectedFlavorId) ?? null;
    if (flavor) {
      setFlavorDraft(applyFlavorDraft(flavor));
      setIsCreatingFlavor(false);
    }
  }, [flavors, selectedFlavorId]);

  useEffect(() => {
    void loadFlavorData(selectedFlavorId);
  }, [selectedFlavorId]);

  function selectFlavor(flavorId: string) {
    startTransition(() => {
      setSelectedFlavorId(flavorId);
      setIsCreatingFlavor(false);
      setRunError("");
      setLatestRun(null);
    });
  }

  function beginCreateFlavor() {
    setIsCreatingFlavor(true);
    setSelectedFlavorId("");
    setFlavorDraft(defaultNewFlavorDraft());
    setSteps([]);
    setRuns([]);
    setCaptions([]);
    setSelectedRunId("");
    setFlashMessage("");
    setGlobalError("");
    setRunError("");
    setLatestRun(null);
    onTabChange("flavor");
  }

  async function handleRefreshAll() {
    const flavorIdToKeep = isCreatingFlavor ? undefined : selectedFlavorId;
    await loadBaseData(flavorIdToKeep);
    if (flavorIdToKeep) {
      await loadFlavorData(flavorIdToKeep);
    }
  }

  async function handleSaveFlavor() {
    const name = flavorDraft.name.trim();
    if (!name) {
      setGlobalError("A humor flavor name is required before you can continue.");
      return;
    }

    setSavingFlavor(true);
    setGlobalError("");
    setFlashMessage("");

    try {
      const payload = {
        name,
        slug: flavorDraft.slug.trim() || slugify(name),
        description: flavorDraft.description,
        notes: flavorDraft.notes,
        status: flavorDraft.status,
      };

      const savedFlavor =
        selectedFlavorId && !isCreatingFlavor
          ? await updateHumorFlavor(selectedFlavorId, payload)
          : await createHumorFlavor(payload);

      setSelectedFlavorId(savedFlavor.id);
      setIsCreatingFlavor(false);
      await loadBaseData(savedFlavor.id);
      await loadFlavorData(savedFlavor.id);
      setFlashMessage(`Saved ${savedFlavor.name}. Next: add the ordered steps for this flavor.`);
      onTabChange("steps");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setSavingFlavor(false);
    }
  }

  async function handleDeleteFlavor() {
    if (!selectedFlavor) return;
    if (!window.confirm(`Delete "${selectedFlavor.name}" and all of its steps, runs, and captions?`)) return;

    setSavingFlavor(true);
    setGlobalError("");
    setFlashMessage("");

    try {
      await deleteHumorFlavor(selectedFlavor.id);
      const remainingFlavors = flavors.filter((item) => item.id !== selectedFlavor.id);
      setFlavors(remainingFlavors);
      setSteps([]);
      setRuns([]);
      setCaptions([]);
      setSelectedRunId("");
      setLatestRun(null);

      if (remainingFlavors.length > 0) {
        const nextFlavorId = remainingFlavors[0].id;
        setSelectedFlavorId(nextFlavorId);
        setIsCreatingFlavor(false);
        setFlashMessage(`Deleted ${selectedFlavor.name}.`);
      } else {
        beginCreateFlavor();
        setFlashMessage(`Deleted ${selectedFlavor.name}. Start the next flavor below.`);
      }

      onTabChange("flavor");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setSavingFlavor(false);
    }
  }

  async function handleCreateStep() {
    if (!selectedFlavorId) {
      setGlobalError("Save the flavor basics before adding steps.");
      onTabChange("flavor");
      return;
    }

    if (!newStepDraft.title.trim() || !newStepDraft.instruction.trim()) {
      setGlobalError("Each step needs both a title and an instruction.");
      return;
    }

    setStepActionId("new-step");
    setGlobalError("");
    setFlashMessage("");

    try {
      const created = await createHumorFlavorStep({
        humor_flavor_id: selectedFlavorId,
        title: newStepDraft.title,
        instruction: newStepDraft.instruction,
        system_prompt: newStepDraft.system_prompt,
        output_label: newStepDraft.output_label,
        step_order: orderedSteps.length + 1,
      });
      setSteps((current) => [...current, created].sort((a, b) => a.step_order - b.step_order));
      setNewStepDraft({ ...EMPTY_STEP_DRAFT });
      setFlashMessage("Saved the new step. Add more, reorder them, then continue to the tester.");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setStepActionId("");
    }
  }

  async function handleSaveStep(step: HumorFlavorStep) {
    setStepActionId(step.id);
    setGlobalError("");
    setFlashMessage("");

    try {
      const updated = await updateHumorFlavorStep(step.id, {
        title: step.title,
        instruction: step.instruction,
        system_prompt: step.system_prompt || "",
        output_label: step.output_label || "",
        step_order: step.step_order,
        llm_input_type_id: step.llm_input_type_id || undefined,
        llm_output_type_id: step.llm_output_type_id || undefined,
        llm_model_id: step.llm_model_id || undefined,
        humor_flavor_step_type_id: step.humor_flavor_step_type_id || undefined,
        llm_temperature: step.llm_temperature ?? undefined,
      });
      setSteps((current) => current.map((item) => (item.id === updated.id ? updated : item)).sort((a, b) => a.step_order - b.step_order));
      setFlashMessage(`Saved step ${updated.step_order}.`);
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setStepActionId("");
    }
  }

  async function handleDeleteStep(stepId: string) {
    const step = steps.find((item) => item.id === stepId);
    if (!step) return;
    if (!window.confirm(`Delete step ${step.step_order}: ${step.title}?`)) return;

    setStepActionId(stepId);
    setGlobalError("");
    setFlashMessage("");

    try {
      await deleteHumorFlavorStep(stepId);
      const remaining = steps
        .filter((item) => item.id !== stepId)
        .sort((a, b) => a.step_order - b.step_order)
        .map((item, index) => ({ ...item, step_order: index + 1 }));
      setSteps(remaining);
      await reorderHumorFlavorSteps(
        selectedFlavorId,
        remaining.map((item) => item.id),
      );
      setFlashMessage("Deleted the step and re-numbered the chain.");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
    } finally {
      setStepActionId("");
    }
  }

  async function moveStep(stepId: string, direction: -1 | 1) {
    const index = orderedSteps.findIndex((item) => item.id === stepId);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= orderedSteps.length) return;

    const reordered = [...orderedSteps];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const normalized = reordered.map((item, orderIndex) => ({ ...item, step_order: orderIndex + 1 }));
    setSteps(normalized);
    setStepActionId(stepId);
    setGlobalError("");
    setFlashMessage("");

    try {
      await reorderHumorFlavorSteps(
        selectedFlavorId,
        normalized.map((item) => item.id),
      );
      setFlashMessage("Updated the step order.");
    } catch (error) {
      setGlobalError(getErrorMessage(error));
      await loadFlavorData(selectedFlavorId);
    } finally {
      setStepActionId("");
    }
  }

  function goToTester() {
    if (!selectedFlavorId) {
      setGlobalError("Save the flavor details first.");
      onTabChange("flavor");
      return;
    }

    if (!orderedSteps.length) {
      setGlobalError("Add at least one step before moving to the tester.");
      return;
    }

    setGlobalError("");
    onTabChange("tester");
  }

  async function handleRunFlavor() {
    if (!selectedFlavor) {
      setRunError("Save or select a humor flavor before testing.");
      onTabChange("flavor");
      return;
    }

    if (!orderedSteps.length) {
      setRunError("Add at least one step before testing.");
      onTabChange("steps");
      return;
    }

    setRunningTest(true);
    setRunError("");
    setFlashMessage("");
    setGlobalError("");

    try {
      const session = await getCurrentSessionOrThrow();
      const result = await runFlavorPromptChain({
        accessToken: session.access_token,
        flavor: selectedFlavor,
        steps: orderedSteps,
        selectedImage,
        manualImageUrl,
        uploadFile,
      });

      let persistedRunId = "";
      let storageWarning = "";

      try {
        const runRecord = await createPromptChainRun({
          humor_flavor_id: selectedFlavor.id,
          image_id: result.imageId,
          image_url: result.imageUrl,
          status: result.captions.length ? "completed" : "empty",
          pipeline_model: result.modelTag,
          request_payload: result.requestPayload,
          raw_response: result.responsePayload,
          created_by: session.user.id,
        });
        persistedRunId = runRecord.id;

        const createdCaptionRows = await createGeneratedFlavorCaptions(
          result.captions.map((caption, index) => ({
            humor_flavor_run_id: runRecord.id,
            humor_flavor_id: selectedFlavor.id,
            image_id: result.imageId,
            caption_text: caption,
            rank_index: index + 1,
            profile_id: session.user.id,
          })),
        );

        setRuns((current) => [runRecord, ...current]);
        setCaptions((current) => [...createdCaptionRows, ...current]);
        setSelectedRunId(runRecord.id);
      } catch (storageError) {
        storageWarning = getErrorMessage(storageError);
      }

      setLatestRun({
        ...result,
        persistedRunId,
        storageWarning,
      });
      setUploadFile(null);
      setManualImageUrl("");
      setFlashMessage(
        result.captions.length
          ? `Generated ${result.captions.length} caption${result.captions.length === 1 ? "" : "s"} with ${selectedFlavor.name}. Review them in the archive.`
          : `The pipeline responded, but no captions were returned for ${selectedFlavor.name}.`,
      );
      onTabChange("archive");
    } catch (error) {
      setRunError(getErrorMessage(error));
    } finally {
      setRunningTest(false);
    }
  }

  function canEnterTab(tab: WorkflowTab) {
    if (tab === "flavor") return true;
    if (tab === "steps") return Boolean(selectedFlavorId);
    if (tab === "tester") return Boolean(selectedFlavorId && orderedSteps.length > 0);
    return Boolean(selectedFlavorId);
  }

  function handleWorkflowStepClick(tab: WorkflowTab) {
    if (!canEnterTab(tab)) {
      if (tab === "steps") {
        setGlobalError("Save the flavor basics before moving to the next screen.");
      } else if (tab === "tester") {
        setGlobalError("Add and order the flavor steps before opening the tester.");
      } else {
        setGlobalError("Save and test a flavor before opening the archive.");
      }
      return;
    }

    setGlobalError("");
    onTabChange(tab);
  }

  function renderSidebar() {
    return (
      <aside className="space-y-5">
        <section className="panel rounded-[2rem] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Flavor Directory</p>
              <h2 className="mt-3 text-2xl font-semibold">Pick your active flavor</h2>
            </div>
            <button
              type="button"
              onClick={() => void handleRefreshAll()}
              className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-strong)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          <button
            type="button"
            onClick={beginCreateFlavor}
            className="pill-button mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-4 py-3 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            New flavor
          </button>

          <div className="mt-5 space-y-3">
            {bootstrapping ? (
              <p className="rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 text-sm text-[var(--ink-soft)]">
                Loading flavors...
              </p>
            ) : flavors.length === 0 ? (
              <p className="rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 text-sm text-[var(--ink-soft)]">
                No saved flavors yet. Start by filling out the first screen.
              </p>
            ) : (
              flavors.map((flavor) => {
                const active = flavor.id === selectedFlavorId && !isCreatingFlavor;
                return (
                  <button
                    key={flavor.id}
                    type="button"
                    onClick={() => selectFlavor(flavor.id)}
                    className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${
                      active
                        ? "border-transparent bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-white shadow-panel"
                        : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{flavor.name}</p>
                        <p className={`mt-1 text-xs ${active ? "text-white/80" : "text-[var(--ink-soft)]"}`}>
                          {flavor.slug || "no-slug"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                          active ? "bg-white/15 text-white" : "bg-[var(--surface-strong)] text-[var(--ink-soft)]"
                        }`}
                      >
                        {flavor.status || "draft"}
                      </span>
                    </div>
                    <p className={`mt-3 text-sm leading-6 ${active ? "text-white/90" : "text-[var(--ink-soft)]"}`}>
                      {flavor.description || "No description yet."}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="panel rounded-[2rem] p-5">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Wizard Progress</p>
          <div className="mt-4 space-y-3">
            {WORKFLOW_STEPS.map((step, index) => {
              const active = step.id === activeTab;
              const complete =
                step.id === "flavor"
                  ? Boolean(selectedFlavorId)
                  : step.id === "steps"
                    ? orderedSteps.length > 0
                    : step.id === "tester"
                      ? runs.length > 0 || latestRun !== null
                      : Boolean(selectedFlavorId);

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => handleWorkflowStepClick(step.id)}
                  className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${
                    active
                      ? "border-transparent bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-white shadow-panel"
                      : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        active
                          ? "bg-white/15 text-white"
                          : complete
                            ? "bg-[var(--brand)] text-white"
                            : "bg-[var(--surface-strong)] text-[var(--ink-soft)]"
                      }`}
                    >
                      {complete && !active ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{step.title}</p>
                      <p className={`mt-1 text-xs leading-5 ${active ? "text-white/80" : "text-[var(--ink-soft)]"}`}>{step.hint}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </aside>
    );
  }

  function renderStageHeader(title: string, description: string) {
    return (
      <section className="panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Step {activeStepIndex + 1} of {WORKFLOW_STEPS.length}</p>
            <h2 className="mt-3 text-3xl font-semibold">{title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">{description}</p>
          </div>
          {loadingFlavorData ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading flavor data
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderFlavorStage() {
    return (
      <div className="space-y-5">
        {renderStageHeader(
          "Save the humor flavor basics",
          "Fill out the flavor identity first. Once this is saved, the wizard automatically moves to the step-building screen.",
        )}

        <section className="panel rounded-[2rem] p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Flavor name</span>
              <input
                value={flavorDraft.name}
                onChange={(event) =>
                  setFlavorDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    slug: current.slug || slugify(event.target.value),
                  }))
                }
                placeholder="Observational chaos"
                className="w-full rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Slug</span>
              <input
                value={flavorDraft.slug}
                onChange={(event) => setFlavorDraft((current) => ({ ...current, slug: slugify(event.target.value) }))}
                placeholder="observational-chaos"
                className="w-full rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Description</span>
              <textarea
                value={flavorDraft.description}
                onChange={(event) => setFlavorDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="What kind of humor should this flavor produce?"
                rows={3}
                className="w-full rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Internal notes</span>
              <textarea
                value={flavorDraft.notes}
                onChange={(event) => setFlavorDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Prompt-writing reminders, style notes, or guardrails."
                rows={4}
                className="w-full rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Status</span>
              <select
                value={flavorDraft.status}
                onChange={(event) => setFlavorDraft((current) => ({ ...current, status: event.target.value }))}
                className="w-full rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSaveFlavor()}
              disabled={savingFlavor}
              className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {savingFlavor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingFlavor ? "Saving..." : selectedFlavorId && !isCreatingFlavor ? "Save and continue to steps" : "Create flavor and continue"}
            </button>
            {selectedFlavor ? (
              <button
                type="button"
                onClick={() => void handleDeleteFlavor()}
                disabled={savingFlavor}
                className="danger-button pill-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Trash2 className="h-4 w-4" />
                Delete flavor
              </button>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  function renderStepsStage() {
    if (!selectedFlavorId) {
      return (
        <div className="space-y-5">
          {renderStageHeader("Save the flavor first", "The wizard needs the flavor record before it can attach ordered steps.")}
          <section className="panel rounded-[2rem] p-6">
            <button
              type="button"
              onClick={() => onTabChange("flavor")}
              className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-5 py-3 text-sm font-semibold text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Go to flavor details
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderStageHeader(
          "Build the ordered steps",
          usesLegacyFlavorSchema
            ? "Your live Supabase project stores steps as prompt records, so this screen maps each step to a title, an optional system prompt, and a user prompt."
            : "Add every instruction that belongs in this humor flavor. You can reorder, edit, and delete steps here before moving on.",
        )}

        <section className="panel rounded-[2rem] p-5 sm:p-6">
          <div className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Active flavor</p>
            <h3 className="mt-2 text-xl font-semibold">{selectedFlavor?.name}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{selectedFlavor?.description || "No description yet."}</p>
            {usesLegacyFlavorSchema ? (
              <p className="mt-3 text-xs leading-5 text-[var(--ink-soft)]">
                Legacy schema detected: this project saves step prompts to the closest existing fields in `humor_flavor_steps`.
              </p>
            ) : null}
          </div>

          <div className="mt-6 space-y-4">
            {orderedSteps.length === 0 ? (
              <p className="rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 text-sm text-[var(--ink-soft)]">
                No steps yet. Add the description step, the joke step, and the final caption-generation step to start.
              </p>
            ) : (
              orderedSteps.map((step, index) => (
                <article key={step.id} className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-sm font-semibold text-white">
                        {step.step_order}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Step in chain</p>
                        <p className="text-sm text-[var(--ink-soft)]">Move steps up or down to control the prompt order.</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={index === 0 || stepActionId === step.id}
                        onClick={() => void moveStep(step.id, -1)}
                        className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-xs font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={index === orderedSteps.length - 1 || stepActionId === step.id}
                        onClick={() => void moveStep(step.id, 1)}
                        className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-xs font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        Move down
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Title</span>
                      <input
                        value={step.title}
                        onChange={(event) =>
                          setSteps((current) =>
                            current.map((item) => (item.id === step.id ? { ...item, title: event.target.value } : item)),
                          )
                        }
                        className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                      />
                    </label>
                    {usesLegacyFlavorSchema ? (
                      <div className="rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-xs leading-6 text-[var(--ink-soft)]">
                        Output labels are preview-only in the rebuilt schema and are not stored in this legacy Supabase step table.
                      </div>
                    ) : (
                      <label className="space-y-2">
                        <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Output label</span>
                        <input
                          value={step.output_label || ""}
                          onChange={(event) =>
                            setSteps((current) =>
                              current.map((item) => (item.id === step.id ? { ...item, output_label: event.target.value } : item)),
                            )
                          }
                          placeholder="image_description"
                          className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                        />
                      </label>
                    )}
                  </div>

                  {usesLegacyFlavorSchema ? (
                    <label className="mt-4 block space-y-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">System prompt</span>
                      <textarea
                        value={step.system_prompt || ""}
                        onChange={(event) =>
                          setSteps((current) =>
                            current.map((item) =>
                              item.id === step.id ? { ...item, system_prompt: event.target.value } : item,
                            ),
                          )
                        }
                        rows={4}
                        placeholder="Optional system behavior for this step."
                        className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                      />
                    </label>
                  ) : null}

                  <label className="mt-4 block space-y-2">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                      {usesLegacyFlavorSchema ? "User prompt" : "Instruction"}
                    </span>
                    <textarea
                      value={step.instruction}
                      onChange={(event) =>
                        setSteps((current) =>
                          current.map((item) => (item.id === step.id ? { ...item, instruction: event.target.value } : item)),
                        )
                      }
                      rows={4}
                      className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSaveStep(step)}
                      disabled={stepActionId === step.id}
                      className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {stepActionId === step.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save step
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteStep(step.id)}
                      disabled={stepActionId === step.id}
                      className="danger-button pill-button inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete step
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <Plus className="h-5 w-5 text-[var(--brand)]" />
              <div>
                <h3 className="text-xl font-semibold">Add a new step</h3>
                <p className="text-sm text-[var(--ink-soft)]">Create the next instruction for this flavor.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Step title</span>
                <input
                  value={newStepDraft.title}
                  onChange={(event) => setNewStepDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Describe the image"
                  className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                />
              </label>
              {usesLegacyFlavorSchema ? (
                <div className="rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-xs leading-6 text-[var(--ink-soft)]">
                  New steps save to the legacy prompt-step schema using sensible defaults for input type, output type, and model.
                </div>
              ) : (
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Output label</span>
                  <input
                    value={newStepDraft.output_label}
                    onChange={(event) => setNewStepDraft((current) => ({ ...current, output_label: event.target.value }))}
                    placeholder="funny_take"
                    className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                  />
                </label>
              )}
            </div>
            {usesLegacyFlavorSchema ? (
              <label className="mt-4 block space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">System prompt</span>
                <textarea
                  value={newStepDraft.system_prompt}
                  onChange={(event) => setNewStepDraft((current) => ({ ...current, system_prompt: event.target.value }))}
                  rows={4}
                  placeholder="Optional system behavior for this step."
                  className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                />
              </label>
            ) : null}
            <label className="mt-4 block space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                {usesLegacyFlavorSchema ? "User prompt" : "Instruction"}
              </span>
              <textarea
                value={newStepDraft.instruction}
                onChange={(event) => setNewStepDraft((current) => ({ ...current, instruction: event.target.value }))}
                rows={4}
                placeholder="Take the output from step 1 and say something funny about it."
                className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleCreateStep()}
              disabled={stepActionId === "new-step"}
              className="pill-button mt-4 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {stepActionId === "new-step" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add step
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onTabChange("flavor")}
              className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-strong)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to flavor
            </button>
            <button
              type="button"
              onClick={goToTester}
              disabled={orderedSteps.length === 0}
              className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-3))] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              Continue to tester
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderTesterStage() {
    if (!selectedFlavorId || orderedSteps.length === 0) {
      return (
        <div className="space-y-5">
          {renderStageHeader("Build the chain before testing", "The tester only unlocks after the flavor exists and has at least one ordered step.")}
          <section className="panel rounded-[2rem] p-6">
            <button
              type="button"
              onClick={() => onTabChange(selectedFlavorId ? "steps" : "flavor")}
              className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-5 py-3 text-sm font-semibold text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              {selectedFlavorId ? "Go to steps" : "Go to flavor"}
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderStageHeader(
          "Test the humor flavor",
          "Use a test-set image, pasted URL, or upload. When the test succeeds, the wizard moves to the archive automatically.",
        )}

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="panel rounded-[2rem] p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Prompt Chain Preview</p>
            <pre className="mt-5 max-h-[560px] overflow-auto rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-xs leading-6 text-[var(--ink-soft)] whitespace-pre-wrap">
              {promptChainPreview || "No steps yet. Add steps to preview the humor flavor prompt chain."}
            </pre>
          </section>

          <section className="panel rounded-[2rem] p-5 sm:p-6">
            <div className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Active flavor</p>
              <h3 className="mt-2 text-xl font-semibold">{selectedFlavor?.name}</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{orderedSteps.length} ordered step{orderedSteps.length === 1 ? "" : "s"}</p>
            </div>

            <div className="mt-5 space-y-4">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Image test set</span>
                <select
                  value={selectedImageId}
                  onChange={(event) => {
                    setSelectedImageId(event.target.value);
                    setUploadFile(null);
                  }}
                  className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                >
                  <option value="">Choose from images table</option>
                  {images.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.id}
                    </option>
                  ))}
                </select>
              </label>

              {imageLibraryError ? (
                <p className="danger-panel rounded-[1.1rem] px-3 py-3 text-sm">
                  Could not read the image test set: {imageLibraryError}
                </p>
              ) : null}

              {selectedImage ? (
                <div className="overflow-hidden rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)]">
                  {getImageUrl(selectedImage) ? (
                    <img src={getImageUrl(selectedImage)} alt="" className="h-44 w-full object-cover" />
                  ) : (
                    <div className="flex h-44 items-center justify-center text-sm text-[var(--ink-soft)]">No preview URL on this image row.</div>
                  )}
                  <div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--ink-soft)]">
                    <FileImage className="h-4 w-4" />
                    Selected image id: {selectedImage.id}
                  </div>
                </div>
              ) : null}

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Or paste image URL</span>
                <input
                  value={manualImageUrl}
                  onChange={(event) => {
                    setManualImageUrl(event.target.value);
                    if (event.target.value.trim()) {
                      setSelectedImageId("");
                      setUploadFile(null);
                    }
                  }}
                  placeholder="https://..."
                  className="w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 outline-none transition focus:border-[var(--brand)]"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Or upload image file</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setUploadFile(file);
                    if (file) {
                      setSelectedImageId("");
                      setManualImageUrl("");
                    }
                  }}
                  className="block w-full rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm"
                />
                {uploadFile ? <p className="text-xs text-[var(--ink-soft)]">Selected file: {uploadFile.name}</p> : null}
              </label>
            </div>

            {runError ? <p className="danger-panel mt-5 rounded-[1.2rem] px-4 py-3 text-sm">{runError}</p> : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onTabChange("steps")}
                className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-strong)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to steps
              </button>
              <button
                type="button"
                onClick={() => void handleRunFlavor()}
                disabled={runningTest}
                className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-3))] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {runningTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                {runningTest ? "Testing flavor..." : "Generate captions"}
              </button>
            </div>

            {latestRun ? (
              <div className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Latest result</p>
                    <h3 className="mt-2 text-xl font-semibold">{latestRun.captions.length} caption{latestRun.captions.length === 1 ? "" : "s"} returned</h3>
                  </div>
                  <div className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-xs text-[var(--ink-soft)]">
                    Model: {latestRun.modelTag}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {latestRun.captions.length === 0 ? (
                    <p className="text-sm text-[var(--ink-soft)]">The API returned a response, but no caption strings were extracted.</p>
                  ) : (
                    latestRun.captions.map((caption, index) => (
                      <div key={`${caption}-${index}`} className="rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm leading-6">
                        <span className="mr-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">#{index + 1}</span>
                        {caption}
                      </div>
                    ))
                  )}
                </div>
                {latestRun.storageWarning ? (
                  <p className="danger-panel mt-4 rounded-[1rem] px-3 py-3 text-sm">
                    The test run succeeded, but saving the archive failed: {latestRun.storageWarning}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  function renderArchiveStage() {
    if (!selectedFlavorId) {
      return (
        <div className="space-y-5">
          {renderStageHeader("Save a flavor before reviewing results", "The archive belongs to a specific flavor, so start at the first screen if nothing is selected.")}
          <section className="panel rounded-[2rem] p-6">
            <button
              type="button"
              onClick={() => onTabChange("flavor")}
              className="pill-button inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-5 py-3 text-sm font-semibold text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Go to flavor
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderStageHeader(
          "Read the saved caption batches",
          usesLegacyFlavorSchema
            ? "Review the closest saved archive we can read from this Supabase project. Legacy caption rows are grouped into batches so you can still inspect outputs by flavor."
            : "Review prompt-chain runs and the exact captions that a specific flavor produced.",
        )}

        <section className="panel rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Active flavor</p>
              <h3 className="mt-2 text-xl font-semibold">{selectedFlavor?.name}</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{runs.length} saved run{runs.length === 1 ? "" : "s"}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onTabChange("tester")}
                className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-strong)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to tester
              </button>
              <button
                type="button"
                onClick={() => void loadFlavorData(selectedFlavorId)}
                disabled={loadingFlavorData}
                className="pill-button inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loadingFlavorData ? "animate-spin" : ""}`} />
                Refresh archive
              </button>
            </div>
          </div>

          {runs.length === 0 ? (
            <p className="mt-6 rounded-[1.3rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              No saved runs yet for {selectedFlavor?.name}. Go to the tester and generate captions first.
            </p>
          ) : (
            <div className="mt-6 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <aside className="space-y-3">
                {runs.map((run) => {
                  const active = run.id === (selectedRun?.id || "");
                  const runCaptions = captions.filter((item) => item.humor_flavor_run_id === run.id);
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${
                        active
                          ? "border-transparent bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] text-white shadow-panel"
                          : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--surface-strong)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{formatTimestamp(run.created_at)}</p>
                          <p className={`mt-1 text-xs ${active ? "text-white/80" : "text-[var(--ink-soft)]"}`}>
                            {run.pipeline_model || "caption-pipeline-v1"}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                            active ? "bg-white/15 text-white" : "bg-[var(--surface-strong)] text-[var(--ink-soft)]"
                          }`}
                        >
                          {runCaptions.length} caption{runCaptions.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className={`mt-3 text-xs ${active ? "text-white/80" : "text-[var(--ink-soft)]"}`}>
                        Image id: {run.image_id || "not saved"}
                      </p>
                    </button>
                  );
                })}
              </aside>

              <div className="space-y-5">
                {selectedRun ? (
                  <>
                    <section className="rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Run summary</p>
                          <h3 className="mt-2 text-2xl font-semibold">{selectedFlavor?.name}</h3>
                          <p className="mt-2 text-sm text-[var(--ink-soft)]">
                            Created {formatTimestamp(selectedRun.created_at)} using {selectedRun.pipeline_model || "caption-pipeline-v1"}.
                          </p>
                          {selectedRun.schema_variant === "legacy" ? (
                            <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                              This batch was reconstructed from the legacy `captions` table because the newer run archive tables are not present in the connected Supabase project.
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-xs text-[var(--ink-soft)]">
                          Status: {selectedRun.status || "completed"}
                        </div>
                      </div>

                      {selectedRun.image_url ? (
                        <div className="mt-4 overflow-hidden rounded-[1.3rem] border border-[var(--line)]">
                          <img src={selectedRun.image_url} alt="" className="h-52 w-full object-cover" />
                        </div>
                      ) : null}

                      {selectedRun.schema_variant === "legacy" ? null : (
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Request payload</p>
                            <pre className="mt-2 max-h-[280px] overflow-auto rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] p-3 text-xs leading-6 text-[var(--ink-soft)] whitespace-pre-wrap">
                              {stringifyJson(selectedRun.request_payload)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">Raw response</p>
                            <pre className="mt-2 max-h-[280px] overflow-auto rounded-[1rem] border border-[var(--line)] bg-[var(--surface-strong)] p-3 text-xs leading-6 text-[var(--ink-soft)] whitespace-pre-wrap">
                              {stringifyJson(selectedRun.raw_response)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
                      <div className="flex items-center gap-3">
                        <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                        <h3 className="text-2xl font-semibold">Generated captions</h3>
                      </div>
                      <div className="mt-4 space-y-3">
                        {visibleCaptions.length === 0 ? (
                          <p className="text-sm text-[var(--ink-soft)]">No caption rows were archived for this run.</p>
                        ) : (
                          visibleCaptions.map((caption) => (
                            <article
                              key={caption.id}
                              className="rounded-[1.1rem] border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm leading-6"
                            >
                              <span className="mr-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                                #{caption.rank_index || "-"}
                              </span>
                              {caption.caption_text}
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  </>
                ) : (
                  <section className="rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface-muted)] p-5 text-sm text-[var(--ink-soft)]">
                    Choose a saved run to inspect its captions and payloads.
                  </section>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <article className="panel rounded-[1.75rem] p-5">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Flavors</p>
          <p className="mt-3 text-4xl font-semibold">{flavors.length}</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Reusable humor approaches currently available.</p>
        </article>
        <article className="panel rounded-[1.75rem] p-5">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Steps</p>
          <p className="mt-3 text-4xl font-semibold">{steps.length}</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Ordered instructions in the active prompt chain.</p>
        </article>
        <article className="panel rounded-[1.75rem] p-5">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--ink-soft)]">Archived Captions</p>
          <p className="mt-3 text-4xl font-semibold">{captions.length}</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">Saved outputs tied to the active humor flavor.</p>
        </article>
      </div>

      {globalError ? <p className="danger-panel rounded-[1.4rem] px-4 py-3 text-sm">{globalError}</p> : null}

      {flashMessage ? (
        <p className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink)]">
          {flashMessage}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        {renderSidebar()}

        <div className="space-y-5">
          {activeTab === "flavor"
            ? renderFlavorStage()
            : activeTab === "steps"
              ? renderStepsStage()
              : activeTab === "tester"
                ? renderTesterStage()
                : renderArchiveStage()}
        </div>
      </div>
    </section>
  );
}
