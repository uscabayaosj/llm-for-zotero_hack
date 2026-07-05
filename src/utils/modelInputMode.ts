import type { ModelInputMode } from "../shared/types";

export type ModelInputModeOption = "auto" | ModelInputMode;

export const MODEL_INPUT_MODE_OPTIONS: readonly ModelInputModeOption[] = [
  "auto",
  "text_only",
  "vision_allowed",
] as const;

const RUNTIMES_WITH_MANUAL_INPUT_MODE = new Set(["api_key"]);

export function isManualInputModeSupportedForRuntime(
  runtimeMode: unknown,
): boolean {
  return (
    typeof runtimeMode !== "string" ||
    RUNTIMES_WITH_MANUAL_INPUT_MODE.has(runtimeMode)
  );
}

export function getModelInputModeOptionsForRuntime(
  runtimeMode: unknown,
): readonly ModelInputModeOption[] {
  return isManualInputModeSupportedForRuntime(runtimeMode)
    ? MODEL_INPUT_MODE_OPTIONS
    : [];
}

export function normalizeModelInputMode(
  value: unknown,
): ModelInputMode | undefined {
  if (value === "text_only" || value === "vision_allowed") return value;
  return undefined;
}

export function normalizeModelInputModeForRuntime(
  value: unknown,
  runtimeMode: unknown,
): ModelInputMode | undefined {
  if (!isManualInputModeSupportedForRuntime(runtimeMode)) return undefined;
  const inputMode = normalizeModelInputMode(value);
  return inputMode;
}

export function resolveModelInputMode(value: unknown): ModelInputModeOption {
  return normalizeModelInputMode(value) || "auto";
}

export function getModelInputModeLabel(
  mode: ModelInputModeOption,
): "Auto" | "Text only" | "Vision allowed" {
  if (mode === "text_only") return "Text only";
  if (mode === "vision_allowed") return "Vision allowed";
  return "Auto";
}
