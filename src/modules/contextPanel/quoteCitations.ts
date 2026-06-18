import type {
  PaperContextRef,
  QuoteCitation,
  SelectedTextSource,
} from "../../shared/types";
import { formatPaperSourceLabel } from "./paperAttribution";
import {
  findUniqueQuoteTextSearchMatch,
  type QuoteTextSearchMatch,
} from "./quoteTextSearch";

export const QUOTE_CITATION_PATTERN = /\[\[quote:([A-Za-z0-9_-]+)\]\]/g;
const BLOCKQUOTE_WRAPPED_QUOTE_CITATION_PATTERN =
  /^[ \t]*(?:>[ \t]*)+\[\[quote:([A-Za-z0-9_-]+)\]\][ \t]*$/gm;
const STRUCTURED_SOURCE_MARKER_PATTERN =
  /\[\[\s*source\s*=\s*([^\]]+?)\s*\]\]/gi;
const BRACKETED_SOURCE_METADATA_PATTERN = /\[\s*source\s*=\s*([^\]]+?)\s*\]/gi;
const FENCED_CODE_PATTERN = /^[ \t]*(```|~~~)/;
const SECTION_ONLY_LABELS = new Set([
  "abstract",
  "background",
  "conclusion",
  "conclusions",
  "discussion",
  "experiment",
  "experiments",
  "introduction",
  "limitation",
  "limitations",
  "material and methods",
  "materials and methods",
  "method",
  "methodology",
  "methods",
  "result",
  "results",
  "supplement",
  "supplementary",
  "supplementary material",
  "supplementary materials",
]);
const NON_SOURCE_TRAILING_LABEL_PATTERN =
  /^([\s\S]*?)\s*(\([^()\n]{1,240}\))\s*([.!?。！？]*)$/;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : undefined;
}

function normalizeCitationLabel(value: unknown): string {
  const label = normalizeText(value);
  if (!label) return "";
  if (label.startsWith("(") && label.endsWith(")")) return label;
  return `(${label.replace(/^\(+|\)+$/g, "")})`;
}

function truncateForPrompt(value: string, maxLength = 360): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function jsonEscape(value: string): string {
  return JSON.stringify(value);
}

function extractSourceMarkerCitationLabel(value: string): string {
  const match =
    value.match(/(?:^|,\s*)source\s*=\s*(\([^)]{1,180}\))/i) ||
    value.match(/^(\([^)]{1,180}\))/);
  return match?.[1] ? normalizeCitationLabel(match[1]) : "";
}

function normalizeLeakedQuoteText(value: string): string {
  let text = normalizeText(value.replace(/^>\s*/, ""));
  text = text.replace(/^["“”]+|["“”]+$/g, "").trim();
  return text;
}

function normalizeQuoteTextForMatch(value: unknown): string {
  return normalizeMultilineText(value).replace(/\s+/g, " ").trim();
}

function stripPageSuffixFromCitationLabel(value: string): string {
  const label = normalizeCitationLabel(value);
  const inner = label.replace(/^\(|\)$/g, "").trim();
  const withoutPage = inner
    .replace(/,\s*(?:p\.?|pp\.?|page|pages)\s+[^,)]+$/i, "")
    .trim();
  return normalizeCitationLabel(withoutPage || inner);
}

function normalizeCitationLabelForMatch(value: unknown): string {
  return stripPageSuffixFromCitationLabel(normalizeCitationLabel(value))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function citationInnerText(value: unknown): string {
  return normalizeCitationLabel(value).replace(/^\(|\)$/g, "").trim();
}

export function isNonSourceQuoteLabel(value: string): boolean {
  const inner = citationInnerText(value)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!inner) return false;
  const leadingSegment = inner
    .split(/[,;:–—-]/)[0]
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (SECTION_ONLY_LABELS.has(inner) || SECTION_ONLY_LABELS.has(leadingSegment)) {
    return true;
  }
  return (
    /^(?:caption|legend|figure caption|fig\.?\s+caption|table caption)$/i.test(
      inner,
    ) ||
    /^(?:supplementary|supplemental|appendix|appendices)(?:\s+(?:table|tab\.?|figure|fig\.?|section|text|material|materials|note|notes|data|movie|video|file|information))?(?:\s+[a-z0-9][a-z0-9._-]*)?(?:\s+(?:caption|legend))?(?:\s*[,;:–—-].*)?$/i.test(
      inner,
    ) ||
    /^(?:table|tab\.?|figure|fig\.?|fig|box|equation|eq\.?|scheme|algorithm)(?:\s+[a-z0-9][a-z0-9._-]*)?(?:\s+(?:caption|legend))?(?:\s*[,;:–—-].*)?$/i.test(
      inner,
    )
  );
}

export function isSectionOnlyCitationLabel(value: string): boolean {
  return isNonSourceQuoteLabel(value);
}

export function isCanonicalQuoteSourceLabel(value: string): boolean {
  const label = normalizeCitationLabel(value);
  if (!label.startsWith("(") || !label.endsWith(")") || label.length > 300) {
    return false;
  }
  if (isNonSourceQuoteLabel(label)) return false;
  const inner = citationInnerText(label);
  if (!inner) return false;
  if (/\battachment\s+under\b/i.test(inner)) return true;
  if (/\b(?:19|20)\d{2}[a-z]?\b/i.test(inner)) return true;
  if (/\bet\s+al\.?\b/i.test(inner)) return true;
  if (/\[[^\]]+\]/.test(inner)) return true;
  if (/^paper(?:\s+\d+)?$/i.test(inner)) return true;
  if (
    /^[\p{L}][\p{L}'’.-]+(?:\s+(?:and|&)\s+[\p{L}][\p{L}'’.-]+)?$/u.test(
      inner,
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeSourceCitationLabel(value: string): boolean {
  const label = normalizeCitationLabel(value);
  const inner = label.replace(/^\(|\)$/g, "").trim();
  if (!inner) return false;
  if (isNonSourceQuoteLabel(label)) return false;
  if (isCanonicalQuoteSourceLabel(label)) return true;
  if (/\b(?:19|20)\d{2}\b/.test(inner)) return true;
  if (/\bet\s+al\.?\b/i.test(inner)) return true;
  if (/\battachment\s+under\b/i.test(inner)) return true;
  return /^[\p{L}][^()]{1,160}$/u.test(inner) && /[,;&]/.test(inner);
}

function parseStandaloneCitationLabel(value: string): string | null {
  const trimmed = normalizeText(value);
  if (!/^\([^()]{2,240}\)$/.test(trimmed)) return null;
  if (!looksLikeSourceCitationLabel(trimmed)) return null;
  if (!isCanonicalQuoteSourceLabel(trimmed)) return null;
  return normalizeCitationLabel(trimmed);
}

function stripBlockquoteMarker(line: string): string {
  return line.replace(/^[ \t]*(?:>[ \t]?)+/, "");
}

function splitTrailingCitationFromQuoteText(value: string): {
  quoteText: string;
  citationLabel: string;
} | null {
  const text = normalizeMultilineText(value);
  const match = text.match(/^([\s\S]*?)\s+(\([^()\n]{2,240}\))$/);
  if (!match) return null;
  const citationLabel = parseStandaloneCitationLabel(match[2] || "");
  const quoteText = normalizeMultilineText(match[1] || "");
  if (!citationLabel || !quoteText) return null;
  return { quoteText, citationLabel };
}

export function findMatchingTrustedQuoteCitation(input: {
  quoteText: string;
  citationLabel: string;
  quoteCitations: QuoteCitation[] | undefined | null;
}): QuoteCitation | undefined {
  const quoteText = normalizeQuoteTextForMatch(input.quoteText);
  const citationLabel = normalizeCitationLabelForMatch(input.citationLabel);
  if (!quoteText || !citationLabel) return undefined;
  return normalizeQuoteCitations(input.quoteCitations).find((citation) => {
    return (
      normalizeQuoteTextForMatch(citation.quoteText) === quoteText &&
      normalizeCitationLabelForMatch(citation.citationLabel) === citationLabel
    );
  });
}

function replaceInvalidSourceMarkerLine(line: string, pattern: RegExp): string {
  pattern.lastIndex = 0;
  const match = pattern.exec(line);
  pattern.lastIndex = 0;
  if (!match) return line;
  const citationLabel = extractSourceMarkerCitationLabel(match[1] || "");
  const rawBefore = line.slice(0, match.index);
  const before = rawBefore.trim();
  const after = line.slice(match.index + match[0].length).trim();
  const beforeLooksLikeQuote =
    /^>\s*/.test(before) ||
    /^["“]/.test(before) ||
    (/^[ \t]{4,}/.test(rawBefore) && /^["“]/.test(before));
  if (citationLabel && before && !after && beforeLooksLikeQuote) {
    const quoteText = normalizeLeakedQuoteText(before);
    if (quoteText) return `> ${quoteText}\n\n${citationLabel}`;
  }
  const replacement = citationLabel || "";
  pattern.lastIndex = 0;
  return line
    .replace(pattern, replacement)
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

export function sanitizeInvalidStructuredSourceMarkers(
  markdown: string,
): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  return lines
    .map((line) => {
      let next = replaceInvalidSourceMarkerLine(
        line,
        STRUCTURED_SOURCE_MARKER_PATTERN,
      );
      next = replaceInvalidSourceMarkerLine(
        next,
        BRACKETED_SOURCE_METADATA_PATTERN,
      );
      return next;
    })
    .join("\n");
}

function normalizeSanitizedMarkdown(value: string): string {
  return value.replace(/\n{3,}/g, "\n\n");
}

function replacementForSourceBackedQuote(params: {
  quoteText: string;
  citationLabel: string;
  quoteCitations: QuoteCitation[] | undefined | null;
}): string {
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  if (QUOTE_CITATION_PATTERN.test(params.quoteText)) {
    QUOTE_CITATION_PATTERN.lastIndex = 0;
    return params.quoteText;
  }
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  const trusted = findMatchingTrustedQuoteCitation(params);
  return trusted
    ? `[[quote:${trusted.id}]]`
    : formatPlainSourceBackedQuoteMarkdown(
        params.quoteText,
        params.citationLabel,
      );
}

function formatPlainSourceBackedQuoteMarkdown(
  quoteText: string,
  citationLabel: string,
): string {
  const normalizedQuote = normalizeMultilineText(quoteText);
  const normalizedCitation = normalizeCitationLabel(citationLabel);
  if (!normalizedQuote || !normalizedCitation) return "";
  const quoteLines = normalizedQuote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoteLines}\n\n${normalizedCitation}`;
}

export function sanitizeUntrustedSourceBackedQuoteBlocks(
  markdown: string,
  quoteCitations: QuoteCitation[] | undefined | null,
): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCED_CODE_PATTERN.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || !/^[ \t]*>/.test(line)) {
      out.push(line);
      continue;
    }

    const blockStart = index;
    const quoteLines: string[] = [];
    while (index < lines.length && /^[ \t]*>/.test(lines[index])) {
      quoteLines.push(stripBlockquoteMarker(lines[index]));
      index += 1;
    }
    const quoteText = normalizeMultilineText(quoteLines.join("\n"));
    let cursor = index;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;

    const citationLabel =
      cursor < lines.length
        ? parseStandaloneCitationLabel(lines[cursor])
        : null;
    if (citationLabel) {
      const replacement = replacementForSourceBackedQuote({
        quoteText,
        citationLabel,
        quoteCitations,
      });
      if (replacement) out.push(replacement);
      index = cursor;
      continue;
    }

    const tail = splitTrailingCitationFromQuoteText(quoteText);
    if (tail) {
      const replacement = replacementForSourceBackedQuote({
        quoteText: tail.quoteText,
        citationLabel: tail.citationLabel,
        quoteCitations,
      });
      if (replacement) out.push(replacement);
      continue;
    }

    out.push(...lines.slice(blockStart, index));
    index -= 1;
  }
  return normalizeSanitizedMarkdown(out.join("\n"));
}

function hashBase36(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 8);
}

export function buildQuoteCitationId(input: {
  quoteText: string;
  citationLabel: string;
  contextItemId?: number;
}): string {
  const key = [
    normalizeText(input.quoteText).toLowerCase(),
    normalizeCitationLabel(input.citationLabel).toLowerCase(),
    normalizePositiveInt(input.contextItemId) || "",
  ].join("\n");
  return `Q_${hashBase36(key)}`;
}

export function buildQuoteCitation(input: {
  quoteText?: unknown;
  citationLabel?: unknown;
  sourceLabel?: unknown;
  sourceMatchText?: unknown;
  sourceMatchKind?: unknown;
  contextItemId?: unknown;
  itemId?: unknown;
  id?: unknown;
}): QuoteCitation | undefined {
  const quoteText = normalizeMultilineText(input.quoteText);
  const citationLabel = normalizeCitationLabel(
    input.sourceLabel || input.citationLabel,
  );
  if (
    !quoteText ||
    !citationLabel ||
    !isCanonicalQuoteSourceLabel(citationLabel)
  ) {
    return undefined;
  }
  const contextItemId = normalizePositiveInt(input.contextItemId);
  const itemId = normalizePositiveInt(input.itemId);
  const id = normalizeText(input.id).replace(/[^A-Za-z0-9_-]/g, "");
  const sourceMatchText = normalizeText(input.sourceMatchText);
  const sourceMatchKind = normalizeText(input.sourceMatchKind);
  const normalizedSourceMatchKind = [
    "trusted",
    "exact",
    "ellipsis-segment",
    "raw-prefix",
    "raw-suffix",
    "raw-middle",
    "progressive",
  ].includes(sourceMatchKind)
    ? (sourceMatchKind as QuoteCitation["sourceMatchKind"])
    : undefined;
  return {
    id:
      id ||
      buildQuoteCitationId({
        quoteText,
        citationLabel,
        contextItemId,
      }),
    quoteText,
    citationLabel,
    sourceMatchText: sourceMatchText || undefined,
    sourceMatchKind: normalizedSourceMatchKind,
    contextItemId,
    itemId,
  };
}

export function normalizeQuoteCitations(value: unknown): QuoteCitation[] {
  const raw = Array.isArray(value) ? value : [];
  const out: QuoteCitation[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const citation = buildQuoteCitation(entry as Record<string, unknown>);
    if (!citation || seen.has(citation.id)) continue;
    seen.add(citation.id);
    out.push(citation);
  }
  return out;
}

export function mergeQuoteCitations(
  ...groups: Array<QuoteCitation[] | undefined | null>
): QuoteCitation[] {
  const out: QuoteCitation[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const citation of normalizeQuoteCitations(group)) {
      if (seen.has(citation.id)) continue;
      seen.add(citation.id);
      out.push(citation);
    }
  }
  return out;
}

export type QuoteSourceText = {
  text?: unknown;
  sourceText?: unknown;
  citationLabel?: unknown;
  sourceLabel?: unknown;
  contextItemId?: unknown;
  itemId?: unknown;
};

export type QuoteSourceIndexEntry = {
  sourceText: string;
  citationLabel: string;
  contextItemId?: number;
  itemId?: number;
};

export type QuoteSourceIndex = {
  quoteCitations: QuoteCitation[];
  sources: QuoteSourceIndexEntry[];
};

function quoteSourceKey(source: QuoteSourceIndexEntry): string {
  return [
    normalizeCitationLabelForMatch(source.citationLabel),
    normalizePositiveInt(source.contextItemId) || "",
    normalizePositiveInt(source.itemId) || "",
    normalizeQuoteTextForMatch(source.sourceText).toLowerCase(),
  ].join("\u241f");
}

export function buildQuoteSourceIndex(params: {
  quoteCitations?: QuoteCitation[] | undefined | null;
  sourceTexts?: QuoteSourceText[] | undefined | null;
}): QuoteSourceIndex {
  const quoteCitations = normalizeQuoteCitations(params.quoteCitations);
  const sources: QuoteSourceIndexEntry[] = [];
  const seen = new Set<string>();
  const pushSource = (entry: QuoteSourceIndexEntry | undefined) => {
    if (!entry?.sourceText || !isCanonicalQuoteSourceLabel(entry.citationLabel)) {
      return;
    }
    const key = quoteSourceKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(entry);
  };
  for (const citation of quoteCitations) {
    pushSource({
      sourceText: citation.quoteText,
      citationLabel: citation.citationLabel,
      contextItemId: citation.contextItemId,
      itemId: citation.itemId,
    });
  }
  for (const source of params.sourceTexts || []) {
    const sourceText = normalizeMultilineText(source.sourceText || source.text);
    const citationLabel = normalizeCitationLabel(
      source.sourceLabel || source.citationLabel,
    );
    if (!sourceText || !citationLabel) continue;
    pushSource({
      sourceText,
      citationLabel,
      contextItemId: normalizePositiveInt(source.contextItemId),
      itemId: normalizePositiveInt(source.itemId),
    });
  }
  return { quoteCitations, sources };
}

export function stripTrailingNonSourceQuoteLabelFromQuoteText(
  value: string,
): string {
  const normalized = normalizeMultilineText(value);
  const match = normalized.match(NON_SOURCE_TRAILING_LABEL_PATTERN);
  if (!match) return normalized;
  const label = match[2] || "";
  if (!isNonSourceQuoteLabel(label)) return normalized;
  return normalizeMultilineText(match[1] || "");
}

type QuoteSourceSearchMatch = {
  source: QuoteSourceIndexEntry;
  match: QuoteTextSearchMatch;
};

function quoteSourceIdentityKey(
  source: QuoteSourceIndexEntry,
  ordinal: number,
): string {
  const contextItemId = normalizePositiveInt(source.contextItemId);
  const itemId = normalizePositiveInt(source.itemId);
  const identitySuffix =
    contextItemId || itemId
      ? `${contextItemId || ""}\u241f${itemId || ""}`
      : `anon:${ordinal}:${hashBase36(
          normalizeQuoteTextForMatch(source.sourceText).toLowerCase(),
        )}`;
  return [
    normalizeCitationLabelForMatch(source.citationLabel),
    identitySuffix,
  ].join("\u241f");
}

function findUniqueQuoteSourceMatch(params: {
  quoteText: string;
  citationLabel?: string | null;
  sourceIndex: QuoteSourceIndex;
}): QuoteSourceSearchMatch | undefined {
  const citationLabel = params.citationLabel
    ? normalizeCitationLabelForMatch(params.citationLabel)
    : "";
  const groupedSources = new Map<
    string,
    { source: QuoteSourceIndexEntry; texts: string[] }
  >();
  params.sourceIndex.sources.forEach((source, ordinal) => {
    if (
      citationLabel &&
      normalizeCitationLabelForMatch(source.citationLabel) !== citationLabel
    ) {
      return;
    }
    const key = quoteSourceIdentityKey(source, ordinal);
    const existing = groupedSources.get(key);
    if (existing) {
      existing.texts.push(source.sourceText);
      return;
    }
    groupedSources.set(key, { source, texts: [source.sourceText] });
  });
  const entries = Array.from(groupedSources.entries()).map(([id, group]) => ({
    id,
    text: group.texts.join("\n\n"),
    debugLabel: group.source.citationLabel,
  }));
  const match = findUniqueQuoteTextSearchMatch(entries, params.quoteText, {
    minQueryLength: 24,
    maxSameEntryOccurrences: 8,
    rejectWeakQueries: true,
    includeProgressiveQueries: true,
    debugLabel: "Quote source",
  });
  if (!match) return undefined;
  const source = groupedSources.get(match.entryId)?.source;
  return source ? { source, match } : undefined;
}

function buildTrustedQuoteCitationFromSource(params: {
  quoteText: string;
  source: QuoteSourceIndexEntry;
  match?: QuoteTextSearchMatch;
}): QuoteCitation | undefined {
  return buildQuoteCitation({
    quoteText: stripTrailingNonSourceQuoteLabelFromQuoteText(params.quoteText),
    citationLabel: params.source.citationLabel,
    sourceMatchText: params.match?.query,
    sourceMatchKind: params.match?.matchKind,
    contextItemId: params.source.contextItemId,
    itemId: params.source.itemId,
  });
}

function formatPlainQuoteMarkdown(quoteText: string): string {
  const normalizedQuote = normalizeMultilineText(quoteText);
  if (!normalizedQuote) return "";
  return normalizedQuote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function extractLeadingParentheticalLabel(value: string): {
  label: string;
  remainder: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(")) return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        const label = normalizeCitationLabel(trimmed.slice(0, index + 1));
        const remainder = trimmed.slice(index + 1).trim();
        return label ? { label, remainder } : null;
      }
    }
  }
  return null;
}

function resolveQuoteCitationForFinalizer(params: {
  quoteText: string;
  citationLabel: string;
  quoteCitations: QuoteCitation[];
  sourceIndex: QuoteSourceIndex;
}): QuoteCitation | undefined {
  const quoteText = stripTrailingNonSourceQuoteLabelFromQuoteText(
    params.quoteText,
  );
  if (!isNonSourceQuoteLabel(params.citationLabel)) {
    const trusted = findMatchingTrustedQuoteCitation({
      quoteText,
      citationLabel: params.citationLabel,
      quoteCitations: params.quoteCitations,
    });
    if (trusted && isCanonicalQuoteSourceLabel(trusted.citationLabel)) {
      return trusted;
    }
  }
  const sourceMatch = findUniqueQuoteSourceMatch({
    quoteText,
    citationLabel: isNonSourceQuoteLabel(params.citationLabel)
      ? null
      : params.citationLabel,
    sourceIndex: params.sourceIndex,
  });
  return sourceMatch
    ? buildTrustedQuoteCitationFromSource({
        quoteText,
        source: sourceMatch.source,
        match: sourceMatch.match,
      })
    : undefined;
}

function resolveUnlabeledQuoteCitationForFinalizer(params: {
  quoteText: string;
  sourceIndex: QuoteSourceIndex;
}): QuoteCitation | undefined {
  const quoteText = stripTrailingNonSourceQuoteLabelFromQuoteText(
    params.quoteText,
  );
  const sourceMatch = findUniqueQuoteSourceMatch({
    quoteText,
    sourceIndex: params.sourceIndex,
  });
  return sourceMatch
    ? buildTrustedQuoteCitationFromSource({
        quoteText,
        source: sourceMatch.source,
        match: sourceMatch.match,
      })
    : undefined;
}

function finalizeSourceBackedQuoteBlock(params: {
  quoteText: string;
  citationLabel: string;
  citationRemainder?: string;
  quoteCitations: QuoteCitation[];
  sourceIndex: QuoteSourceIndex;
}): {
  markdown: string;
  quoteCitation?: QuoteCitation;
  consumedCitation: boolean;
} {
  const quoteText = stripTrailingNonSourceQuoteLabelFromQuoteText(
    params.quoteText,
  );
  const quoteCitation = resolveQuoteCitationForFinalizer(params);
  if (quoteCitation) {
    return {
      markdown: `[[quote:${quoteCitation.id}]]${
        params.citationRemainder ? `\n\n${params.citationRemainder}` : ""
      }`,
      quoteCitation,
      consumedCitation: true,
    };
  }
  if (isNonSourceQuoteLabel(params.citationLabel)) {
    return {
      markdown: `${formatPlainQuoteMarkdown(quoteText)}${
        params.citationRemainder ? `\n\n${params.citationRemainder}` : ""
      }`,
      consumedCitation: true,
    };
  }
  return {
    markdown: `${formatPlainQuoteMarkdown(quoteText)}${
      params.citationRemainder ? `\n\n${params.citationRemainder}` : ""
    }`,
    consumedCitation: true,
  };
}

export function finalizeAssistantQuoteCitations(params: {
  markdown: string;
  quoteCitations?: QuoteCitation[] | undefined | null;
  sourceIndex?: QuoteSourceIndex | undefined | null;
}): { markdown: string; quoteCitations: QuoteCitation[] } {
  const sourceIndex =
    params.sourceIndex ||
    buildQuoteSourceIndex({ quoteCitations: params.quoteCitations });
  let quoteCitations = mergeQuoteCitations(
    params.quoteCitations,
    sourceIndex.quoteCitations,
  );
  const markdown = sanitizeInvalidStructuredSourceMarkers(params.markdown || "");
  if (!markdown) return { markdown, quoteCitations };
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCED_CODE_PATTERN.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || !/^[ \t]*>/.test(line)) {
      out.push(line);
      continue;
    }

    const blockStart = index;
    const quoteLines: string[] = [];
    while (index < lines.length && /^[ \t]*>/.test(lines[index])) {
      quoteLines.push(stripBlockquoteMarker(lines[index]));
      index += 1;
    }
    const originalQuoteText = normalizeMultilineText(quoteLines.join("\n"));
    let quoteText = stripTrailingNonSourceQuoteLabelFromQuoteText(
      originalQuoteText,
    );

    const trailingLabel = quoteLines.length
      ? extractLeadingParentheticalLabel(quoteLines[quoteLines.length - 1])
      : null;
    if (
      trailingLabel &&
      !trailingLabel.remainder &&
      (isNonSourceQuoteLabel(trailingLabel.label) ||
        isCanonicalQuoteSourceLabel(trailingLabel.label))
    ) {
      quoteText = stripTrailingNonSourceQuoteLabelFromQuoteText(
        normalizeMultilineText(quoteLines.slice(0, -1).join("\n")),
      );
      if (quoteText) {
        const finalized = finalizeSourceBackedQuoteBlock({
          quoteText,
          citationLabel: trailingLabel.label,
          quoteCitations,
          sourceIndex,
        });
        if (finalized.quoteCitation) {
          quoteCitations = mergeQuoteCitations(quoteCitations, [
            finalized.quoteCitation,
          ]);
        }
        out.push(finalized.markdown);
        continue;
      }
    }

    let cursor = index;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    const leadingLabel =
      cursor < lines.length
        ? extractLeadingParentheticalLabel(lines[cursor])
        : null;
    if (
      leadingLabel &&
      (isNonSourceQuoteLabel(leadingLabel.label) ||
        isCanonicalQuoteSourceLabel(leadingLabel.label))
    ) {
      const finalized = finalizeSourceBackedQuoteBlock({
        quoteText,
        citationLabel: leadingLabel.label,
        citationRemainder: leadingLabel.remainder,
        quoteCitations,
        sourceIndex,
      });
      if (finalized.quoteCitation) {
        quoteCitations = mergeQuoteCitations(quoteCitations, [
          finalized.quoteCitation,
        ]);
      }
      out.push(finalized.markdown);
      index = cursor;
      continue;
    }

    const unlabeledQuoteCitation = resolveUnlabeledQuoteCitationForFinalizer({
      quoteText,
      sourceIndex,
    });
    if (unlabeledQuoteCitation) {
      quoteCitations = mergeQuoteCitations(quoteCitations, [
        unlabeledQuoteCitation,
      ]);
      out.push(`[[quote:${unlabeledQuoteCitation.id}]]`);
      index -= 1;
      continue;
    }
    if (quoteText && quoteText !== originalQuoteText) {
      out.push(formatPlainQuoteMarkdown(quoteText));
      index -= 1;
      continue;
    }

    out.push(...lines.slice(blockStart, index));
    index -= 1;
  }
  const finalizedMarkdown = replaceQuoteCitationPlaceholdersForMarkdown(
    normalizeSanitizedMarkdown(out.join("\n")),
    quoteCitations,
    { resolved: "preserve", unresolved: "omit" },
  );
  return {
    markdown: finalizedMarkdown,
    quoteCitations: mergeQuoteCitations(quoteCitations),
  };
}

export function buildQuoteAnchorPromptBlock(
  quoteCitations: QuoteCitation[] | undefined | null,
): string[] {
  const normalized = normalizeQuoteCitations(quoteCitations);
  if (!normalized.length) return [];
  const lines = [
    "Quote anchors for direct evidence:",
    "- When you need to include one of these exact quotes, write only the matching token, e.g. [[quote:Q_x7a2]].",
    "- Do not manually copy the quote or sourceLabel when a quote anchor is available; the app will render the quote and clickable citation.",
    "- Quote text is provenance-locked source text: never translate or paraphrase it to match the user's language.",
    "- If a translation is useful, write it outside the quote block as explanation, not as the quoted source passage.",
    "- Do not write source/section/chunk metadata such as [[source=...]] in the final answer; those fields are internal context only.",
  ];
  for (const citation of normalized) {
    lines.push(
      `- Quote anchor ${citation.id}:`,
      `  quoteText: ${jsonEscape(truncateForPrompt(citation.quoteText))}`,
      `  sourceLabel: ${jsonEscape(citation.citationLabel)}`,
      `  To include this quote, write: [[quote:${citation.id}]]`,
    );
  }
  return lines;
}

export function formatQuoteCitationMarkdown(citation: QuoteCitation): string {
  const quoteLines = normalizeMultilineText(citation.quoteText)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoteLines}\n\n${citation.citationLabel}`;
}

export type UnresolvedQuoteCitationPlaceholderMode =
  | "preserve"
  | "unavailable"
  | "omit";

function formatUnresolvedQuoteCitationPlaceholder(
  mode: UnresolvedQuoteCitationPlaceholderMode,
): string {
  if (mode === "unavailable" || mode === "omit") return "";
  return "";
}

function endsWithBlankLine(value: string): boolean {
  return /\n[ \t]*\n[ \t]*$/.test(value);
}

function endsWithLineBreak(value: string): boolean {
  return /\n[ \t]*$/.test(value);
}

function normalizeQuoteCitationPlaceholderBoundariesInSegment(
  markdown: string,
): string {
  if (!markdown || !QUOTE_CITATION_PATTERN.test(markdown)) {
    QUOTE_CITATION_PATTERN.lastIndex = 0;
    return markdown;
  }
  QUOTE_CITATION_PATTERN.lastIndex = 0;

  let result = "";
  let cursor = 0;
  let appendedQuoteAnchor = false;
  const appendText = (text: string): void => {
    if (!text) return;
    if (!appendedQuoteAnchor) {
      result += text;
      return;
    }

    const withoutLeadingHorizontalSpace = text.replace(/^[ \t]+/, "");
    if (!withoutLeadingHorizontalSpace.trim()) {
      return;
    }
    if (/^\r?\n[ \t]*\r?\n/.test(withoutLeadingHorizontalSpace)) {
      result += withoutLeadingHorizontalSpace;
    } else if (/^\r?\n/.test(withoutLeadingHorizontalSpace)) {
      result += `\n\n${withoutLeadingHorizontalSpace.replace(/^\r?\n/, "")}`;
    } else {
      result += `\n\n${withoutLeadingHorizontalSpace}`;
    }
    appendedQuoteAnchor = false;
  };

  for (const match of markdown.matchAll(QUOTE_CITATION_PATTERN)) {
    const start = match.index || 0;
    const token = match[0];
    appendText(markdown.slice(cursor, start));
    result = result.replace(/[ \t]+$/, "");
    if (result.trim() && !endsWithBlankLine(result)) {
      result += endsWithLineBreak(result) ? "\n" : "\n\n";
    }
    result += token;
    appendedQuoteAnchor = true;
    cursor = start + token.length;
  }
  appendText(markdown.slice(cursor));
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  return result;
}

export function normalizeQuoteCitationPlaceholdersForDisplay(
  markdown: string,
): string {
  if (!markdown || !QUOTE_CITATION_PATTERN.test(markdown)) {
    QUOTE_CITATION_PATTERN.lastIndex = 0;
    return markdown;
  }
  QUOTE_CITATION_PATTERN.lastIndex = 0;

  const lines = markdown.split("\n");
  const segments: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let currentIsFence = false;

  const flush = () => {
    if (!current.length) return;
    const segment = current.join("\n");
    segments.push(
      currentIsFence
        ? segment
        : normalizeQuoteCitationPlaceholderBoundariesInSegment(segment),
    );
    current = [];
  };

  for (const line of lines) {
    const fenceLine = FENCED_CODE_PATTERN.test(line);
    if (inFence) {
      current.push(line);
      if (fenceLine) {
        inFence = false;
        flush();
        currentIsFence = false;
      }
      continue;
    }

    if (fenceLine) {
      flush();
      currentIsFence = true;
      current.push(line);
      inFence = true;
      continue;
    }

    current.push(line);
  }
  flush();
  return segments.join("\n");
}

export function findUnresolvedQuoteCitationPlaceholderIds(
  markdown: string,
  quoteCitations: QuoteCitation[] | undefined | null,
): string[] {
  if (!markdown) return [];
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  const matches = Array.from(markdown.matchAll(QUOTE_CITATION_PATTERN));
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  if (!matches.length) return [];
  const byId = new Set(
    normalizeQuoteCitations(quoteCitations).map((citation) => citation.id),
  );
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const id = match[1] || "";
    if (!id || byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    unresolved.push(id);
  }
  return unresolved;
}

export function replaceQuoteCitationPlaceholdersForMarkdown(
  markdown: string,
  quoteCitations: QuoteCitation[] | undefined | null,
  options: {
    resolved?: "markdown" | "preserve";
    unresolved?: UnresolvedQuoteCitationPlaceholderMode;
  } = {},
): string {
  const safeMarkdown = sanitizeUntrustedSourceBackedQuoteBlocks(
    sanitizeInvalidStructuredSourceMarkers(markdown),
    quoteCitations,
  );
  if (!safeMarkdown || !QUOTE_CITATION_PATTERN.test(safeMarkdown)) {
    QUOTE_CITATION_PATTERN.lastIndex = 0;
    return safeMarkdown;
  }
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  const byId = new Map(
    normalizeQuoteCitations(quoteCitations).map((citation) => [
      citation.id,
      citation,
    ]),
  );
  const resolved = options.resolved || "markdown";
  const unresolved = options.unresolved || "preserve";
  const replaceToken = (token: string, id: string): string => {
    const citation = byId.get(id);
    if (citation) {
      return resolved === "preserve"
        ? `[[quote:${citation.id}]]`
        : formatQuoteCitationMarkdown(citation);
    }
    return unresolved === "preserve"
      ? token
      : formatUnresolvedQuoteCitationPlaceholder(unresolved);
  };
  const normalizedMarkdown = safeMarkdown.replace(
    BLOCKQUOTE_WRAPPED_QUOTE_CITATION_PATTERN,
    (token, id: string) => replaceToken(token, id),
  );
  QUOTE_CITATION_PATTERN.lastIndex = 0;
  return normalizedMarkdown.replace(QUOTE_CITATION_PATTERN, replaceToken);
}

function extractFromUnknown(
  content: unknown,
  out: QuoteCitation[],
  seenObjects: WeakSet<object>,
): void {
  if (!content) return;
  if (typeof content === "string") {
    const text = content.trim();
    if (!text || (!text.startsWith("{") && !text.startsWith("["))) return;
    try {
      extractFromUnknown(JSON.parse(text), out, seenObjects);
    } catch (_err) {
      void _err;
    }
    return;
  }
  if (Array.isArray(content)) {
    for (const entry of content) extractFromUnknown(entry, out, seenObjects);
    return;
  }
  if (typeof content !== "object") return;
  if (seenObjects.has(content)) return;
  seenObjects.add(content);
  const record = content as Record<string, unknown>;
  const ownCitation = buildQuoteCitation(record);
  if (ownCitation) out.push(ownCitation);
  if (Array.isArray(record.quoteCitations)) {
    out.push(...normalizeQuoteCitations(record.quoteCitations));
  }
  for (const value of Object.values(record)) {
    extractFromUnknown(value, out, seenObjects);
  }
}

export function extractQuoteCitationsFromToolContent(
  content: unknown,
): QuoteCitation[] {
  const out: QuoteCitation[] = [];
  extractFromUnknown(content, out, new WeakSet<object>());
  return mergeQuoteCitations(out);
}

export function buildSelectedTextQuoteCitations(
  selectedTexts: readonly string[] | undefined,
  selectedTextSources: readonly SelectedTextSource[] | undefined,
  selectedTextPaperContexts:
    | readonly (PaperContextRef | undefined)[]
    | undefined,
): QuoteCitation[] {
  if (!Array.isArray(selectedTexts) || !selectedTexts.length) return [];
  const out: QuoteCitation[] = [];
  for (let index = 0; index < selectedTexts.length; index++) {
    if (selectedTextSources?.[index] !== "pdf") continue;
    const paperContext = selectedTextPaperContexts?.[index];
    if (!paperContext) continue;
    const citation = buildQuoteCitation({
      quoteText: selectedTexts[index],
      citationLabel: formatPaperSourceLabel(paperContext),
      contextItemId: paperContext.contextItemId,
      itemId: paperContext.itemId,
    });
    if (citation) out.push(citation);
  }
  return mergeQuoteCitations(out);
}
