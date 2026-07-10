export type StandalonePaperTabLabel = "Paper chat" | "Web chat";

export function resolveStandalonePaperTabLabel(options?: {
  isWebChat?: boolean;
}): StandalonePaperTabLabel {
  if (options?.isWebChat) return "Web chat";
  return "Paper chat";
}
