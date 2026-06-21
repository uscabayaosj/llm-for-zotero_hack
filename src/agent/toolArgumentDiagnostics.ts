const CONTENT_LIKE_ARGUMENT_KEYS = new Set([
  "body",
  "code",
  "content",
  "contents",
  "data",
  "source",
  "text",
]);

export const MALFORMED_TOOL_ARGUMENTS_KEY =
  "__llmForZoteroMalformedToolArguments";

export type MalformedToolArgumentsDiagnostic = {
  [MALFORMED_TOOL_ARGUMENTS_KEY]: true;
  reason: "invalid_json";
  rawPreview: string;
  rawLength: number;
};

export function isContentLikeToolArgumentKey(key: string): boolean {
  const normalized = key
    .trim()
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
  return CONTENT_LIKE_ARGUMENT_KEYS.has(normalized);
}

function redactContentLikeAssignments(raw: string): string {
  const contentKeyPattern = Array.from(CONTENT_LIKE_ARGUMENT_KEYS).join("|");
  const assignmentPattern = new RegExp(
    `((?:"|')?(?:${contentKeyPattern})(?:"|')?\\s*:\\s*)` +
      `(?:"(?:\\\\.|[^"\\\\])*(?:"|$)|'(?:\\\\.|[^'\\\\])*(?:'|$)|` +
      "`(?:\\\\.|[^`\\\\])*(?:`|$)|[^\\s,}\\]]+)",
    "gi",
  );
  return raw.replace(assignmentPattern, '$1"[redacted]"');
}

export function redactToolArgumentPreview(
  raw: string,
  maxLength = 320,
): string {
  const redacted = redactContentLikeAssignments(raw).replace(/\s+/g, " ");
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}...[truncated ${
    redacted.length - maxLength
  } chars]`;
}

export function createMalformedToolArgumentsDiagnostic(
  raw: unknown,
): MalformedToolArgumentsDiagnostic {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  return {
    [MALFORMED_TOOL_ARGUMENTS_KEY]: true,
    reason: "invalid_json",
    rawPreview: redactToolArgumentPreview(text),
    rawLength: text.length,
  };
}

export function isMalformedToolArgumentsDiagnostic(
  value: unknown,
): value is MalformedToolArgumentsDiagnostic {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[MALFORMED_TOOL_ARGUMENTS_KEY] === true,
  );
}
