import {
  callLLM,
  type ChatParams,
  type ReasoningConfig,
} from "../../utils/llmClient";
import type { ProviderProtocol } from "../../utils/providerProtocol";
import { tokenizeRetrievalQuery } from "./retrievalTokenizer";
import {
  buildCanonicalReferenceQuery,
  parseDocumentReferences,
  type QueryReference,
} from "../../shared/documentReferences";

export type DocumentReadIntent = "targeted" | "full-once";

export type RetrievalQueryPlan = {
  originalQuery: string;
  variants: string[];
  effectiveQueries: string[];
  lexicalTerms: string[];
  semanticQuery: string;
  variantLimitHit: boolean;
  notes: string[];
  readIntent: DocumentReadIntent;
  references: QueryReference[];
};

export type DocumentQueryPlan = RetrievalQueryPlan;

export const RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT = 6;
export const RETRIEVAL_QUERY_VARIANT_HARD_LIMIT = 8;
const RETRIEVAL_QUERY_VARIANT_MAX_CHARS = 160;
const RETRIEVAL_SEMANTIC_QUERY_MAX_CHARS = 700;
const RETRIEVAL_QUERY_PLAN_TIMEOUT_MS = 2500;

function normalizeQueryText(value: unknown, maxChars = 0): string {
  const normalized = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  if (!maxChars || normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).trim();
}

function normalizeComparableQuery(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function clampVariantLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT;
  }
  return Math.max(
    1,
    Math.min(RETRIEVAL_QUERY_VARIANT_HARD_LIMIT, Math.floor(parsed)),
  );
}

function normalizeVariants(params: {
  originalQuery: string;
  variants?: unknown[];
  maxVariants?: number;
}): { variants: string[]; variantLimitHit: boolean } {
  const maxVariants = clampVariantLimit(params.maxVariants);
  const originalComparable = normalizeComparableQuery(params.originalQuery);
  const seen = new Set<string>(originalComparable ? [originalComparable] : []);
  const out: string[] = [];
  let nonEmptyCount = 0;
  for (const value of params.variants || []) {
    const normalized = normalizeQueryText(
      value,
      RETRIEVAL_QUERY_VARIANT_MAX_CHARS,
    );
    if (!normalized) continue;
    nonEmptyCount += 1;
    const comparable = normalizeComparableQuery(normalized);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    if (out.length >= maxVariants) continue;
    out.push(normalized);
  }
  return {
    variants: out,
    variantLimitHit: nonEmptyCount > out.length,
  };
}

function buildSemanticQuery(effectiveQueries: string[]): string {
  const joined = effectiveQueries
    .map((query, index) => (index === 0 ? query : `Variant: ${query}`))
    .filter(Boolean)
    .join("\n");
  return normalizeQueryText(joined, RETRIEVAL_SEMANTIC_QUERY_MAX_CHARS);
}

export function buildRetrievalQueryPlan(params: {
  query: string;
  queryVariants?: unknown[];
  maxVariants?: number;
  notes?: string[];
  readIntent?: DocumentReadIntent;
  references?: QueryReference[];
}): RetrievalQueryPlan {
  const originalQuery = normalizeQueryText(params.query);
  const references =
    params.references || parseDocumentReferences(originalQuery);
  const normalized = normalizeVariants({
    originalQuery,
    variants: [
      ...(params.queryVariants || []),
      ...references.map(buildCanonicalReferenceQuery),
    ],
    maxVariants: params.maxVariants,
  });
  const effectiveQueries = [originalQuery, ...normalized.variants].filter(
    Boolean,
  );
  const lexicalTerms = Array.from(
    new Set(effectiveQueries.flatMap((query) => tokenizeRetrievalQuery(query))),
  );
  const notes = [...(params.notes || [])];
  if (normalized.variantLimitHit) {
    notes.push(
      `Query variants were capped at ${clampVariantLimit(params.maxVariants)}.`,
    );
  }
  if (!normalized.variants.length) {
    notes.push("No query variants were used.");
  }
  return {
    originalQuery,
    variants: normalized.variants,
    effectiveQueries,
    lexicalTerms,
    semanticQuery: buildSemanticQuery(effectiveQueries),
    variantLimitHit: normalized.variantLimitHit,
    notes,
    readIntent:
      params.readIntent ||
      (detectExplicitFullReadIntent(originalQuery) ? "full-once" : "targeted"),
    references,
  };
}

export function buildRetrievalQueryPlanCacheKey(
  queryPlan: RetrievalQueryPlan,
): string {
  return [queryPlan.originalQuery, ...queryPlan.variants]
    .map((entry) =>
      normalizeComparableQuery(entry)
        .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" || ")
    .slice(0, 300);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || "",
    trimmed.match(/\{[\s\S]*\}/)?.[0] || "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next extraction shape.
    }
  }
  return null;
}

function isValidPlannerOutput(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> & {
  readIntent: DocumentReadIntent;
  variants: unknown[];
} {
  return Boolean(
    value &&
    (value.readIntent === "targeted" || value.readIntent === "full-once") &&
    Array.isArray(value.variants) &&
    value.variants.every((variant) => typeof variant === "string"),
  );
}

function isLikelyExactLookupQuery(query: string): boolean {
  const lower = query.toLocaleLowerCase();
  if (/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i.test(query)) return true;
  if (/\b(?:doi|pmid|pmcid|isbn|issn|arxiv|citation key)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(?:exact phrase|literal phrase|verbatim|exact quote|quote exactly)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(?:title|author)\b/.test(lower) &&
    /\b(?:find|lookup|look up|search|open|locate)\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Conservative local fallback for explicit full-reading commands.
 * The model planner remains the primary multilingual classifier when configured.
 */
export function detectExplicitFullReadIntent(query: string): boolean {
  const normalized = normalizeQueryText(query).toLocaleLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:read|use|analy[sz]e|review|process|send|provide)\b[^.!?\n]{0,48}\b(?:the\s+)?(?:full\s*[- ]?text|entire|whole|complete)\b(?:[^.!?\n]{0,32}\b(?:paper|article|document|text|pdf)\b)?/i.test(
      normalized,
    ) ||
    /\b(?:cover\s+to\s+cover|every\s+(?:section|page)|from\s+start\s+to\s+finish)\b/i.test(
      normalized,
    ) ||
    /(?:通读|阅读全文|完整阅读|阅读完整|阅读全部|分析全文|使用全文|发送全文|整篇(?:论文|文章)|全文(?:内容|阅读)?|从头到尾)/u.test(
      normalized,
    ) ||
    /(?:全文を読む|論文全体|全体を読む|最初から最後まで)/u.test(normalized) ||
    /(?:전문을?\s*읽|전체\s*(?:논문|문서)|처음부터\s*끝까지)/u.test(normalized)
  );
}

export function shouldAutoGenerateQueryVariants(params: {
  query: string;
  hasRetrievalContext: boolean;
}): boolean {
  const query = normalizeQueryText(params.query);
  if (!params.hasRetrievalContext || query.length < 4) return false;
  return !isLikelyExactLookupQuery(query);
}

async function callWithTimeout(
  params: Omit<ChatParams, "signal"> & {
    parentSignal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs || RETRIEVAL_QUERY_PLAN_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  params.parentSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await callLLM({
      ...params,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    params.parentSignal?.removeEventListener("abort", onAbort);
  }
}

export async function generateRetrievalQueryPlanWithModel(params: {
  query: string;
  hasRetrievalContext: boolean;
  model?: string;
  apiBase?: string;
  apiKey?: string;
  authMode?: ChatParams["authMode"];
  providerProtocol?: ProviderProtocol;
  reasoning?: ReasoningConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
  sourceSamples?: string[];
}): Promise<RetrievalQueryPlan> {
  const fallback = buildRetrievalQueryPlan({ query: params.query });
  if (!shouldAutoGenerateQueryVariants(params)) return fallback;
  if (!params.apiBase && !params.apiKey) return fallback;

  const sourceSamples = (params.sourceSamples || [])
    .map((sample) => normalizeQueryText(sample, 800))
    .filter(Boolean)
    .slice(0, 3);
  const prompt = [
    "Plan document retrieval for a user's Zotero papers.",
    'Return strict JSON only in this shape: {"readIntent":"targeted|full-once","variants":["..."]}.',
    "Generate search probes, not an answer.",
    "Preserve the user's intent.",
    'Use readIntent "full-once" only when the user explicitly asks to read, use, analyze, or send the complete document.',
    "Generate variants in the language used by the supplied document samples, including translation when query and source languages differ.",
    "Include common acronyms, notation variants, and technical equivalents when useful.",
    "Preserve literal figure and table identifiers exactly.",
    "Avoid broad conceptual drift and do not invent paper-specific claims.",
    `Return at most ${RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT} variants.`,
    "",
    `User query: ${params.query}`,
    ...(sourceSamples.length
      ? ["", "Bounded document samples:", ...sourceSamples]
      : []),
  ].join("\n");

  try {
    let parsed: ReturnType<typeof extractJsonObject> = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await callWithTimeout({
        prompt,
        model: params.model,
        apiBase: params.apiBase,
        apiKey: params.apiKey,
        authMode: params.authMode,
        providerProtocol: params.providerProtocol,
        reasoning: params.reasoning,
        maxTokens: 260,
        temperature: 0,
        parentSignal: params.signal,
        timeoutMs: params.timeoutMs,
        systemMessages: [
          "You are a retrieval query planner. Return JSON only. Do not answer the user's research question.",
        ],
      });
      const candidate = extractJsonObject(raw);
      if (isValidPlannerOutput(candidate)) {
        parsed = candidate;
        break;
      }
    }
    if (!isValidPlannerOutput(parsed)) {
      throw new Error("The retrieval planner returned malformed output");
    }
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const readIntent =
      parsed?.readIntent === "full-once" ? "full-once" : fallback.readIntent;
    return buildRetrievalQueryPlan({
      query: params.query,
      queryVariants: variants,
      readIntent,
      notes: variants.length
        ? ["Query variants were generated by the retrieval planner."]
        : ["The retrieval planner returned no usable variants."],
    });
  } catch {
    return buildRetrievalQueryPlan({
      query: params.query,
      notes: ["Query variant planning failed; used the original query only."],
    });
  }
}

function hasUsableVariants(values: unknown[] | undefined): boolean {
  return (
    Array.isArray(values) && values.some((value) => normalizeQueryText(value))
  );
}

export async function resolveRetrievalQueryPlan(params: {
  query: string;
  queryVariants?: unknown[];
  queryPlan?: RetrievalQueryPlan;
  hasRetrievalContext: boolean;
  model?: string;
  apiBase?: string;
  apiKey?: string;
  authMode?: ChatParams["authMode"];
  providerProtocol?: ProviderProtocol;
  reasoning?: ReasoningConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
  sourceSamples?: string[];
}): Promise<RetrievalQueryPlan> {
  if (params.queryPlan) return params.queryPlan;
  if (hasUsableVariants(params.queryVariants)) {
    return buildRetrievalQueryPlan({
      query: params.query,
      queryVariants: params.queryVariants,
      notes: ["Query variants were provided by the caller."],
    });
  }
  return generateRetrievalQueryPlanWithModel({
    query: params.query,
    hasRetrievalContext: params.hasRetrievalContext,
    model: params.model,
    apiBase: params.apiBase,
    apiKey: params.apiKey,
    authMode: params.authMode,
    providerProtocol: params.providerProtocol,
    reasoning: params.reasoning,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    sourceSamples: params.sourceSamples,
  });
}
