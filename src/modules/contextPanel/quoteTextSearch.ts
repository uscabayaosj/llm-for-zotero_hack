import {
  buildQuoteTextIndex,
  countCanonicalTextMatches,
  extractQuoteTextTokens,
  normalizeQuoteTextCanonical,
} from "./quoteTextNormalization";

const SEARCH_WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const PLAIN_ASCII_WORD_PATTERN = /^[a-z]+$/;
const NUMERIC_TOKEN_PATTERN = /^\p{N}+$/u;
const NON_ASCII_PATTERN = /[^\x00-\x7F]/;
const COMMON_SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "these",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "with",
]);

const ELLIPSIS_RE = /(?:\.{2,}|\u2026|\[\s*\.{2,}\s*\]|\[\s*\u2026\s*\])/;
const ELLIPSIS_RE_G = /(?:\.{2,}|\u2026|\[\s*\.{2,}\s*\]|\[\s*\u2026\s*\])/g;
const NORMALIZED_QUERY_LENGTHS = [100, 80, 60, 40, 30, 25, 20, 15];

function sanitizeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      } else {
        out += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\uFFFD";
      continue;
    }
    out += text[i];
  }
  return out;
}

export type QuoteTextSearchQueryKind =
  | "exact"
  | "ellipsis-segment"
  | "raw-prefix"
  | "raw-suffix"
  | "raw-middle"
  | "progressive";

export type QuoteTextSearchQuery = {
  query: string;
  kind: QuoteTextSearchQueryKind;
  confidence: "high" | "medium";
};

export type QuoteTextSearchEntry = {
  id: string;
  text: string;
  normalizedText?: string;
  debugLabel?: string;
};

export type QuoteTextSearchMatch = {
  entryId: string;
  query: string;
  normalizedQuery: string;
  matchKind: QuoteTextSearchQueryKind;
  confidence: "high" | "medium";
  totalOccurrences: number;
  matchedEntryIds: string[];
  debugSummary: string[];
};

type NormalizedQuoteTextSearchEntry = {
  id: string;
  normalizedText: string;
  debugLabel: string;
};

export type QuoteTextSearchOptions = {
  minQueryLength?: number;
  maxSameEntryOccurrences?: number;
  rejectWeakQueries?: boolean;
  includeProgressiveQueries?: boolean;
  debugLabel?: string;
};

export function normalizeLocatorText(value: string): string {
  return normalizeQuoteTextCanonical(value || "");
}

function hasNonAsciiToken(token: string): boolean {
  return NON_ASCII_PATTERN.test(token);
}

function tokenCharLength(token: string): number {
  return Array.from(token).length;
}

function locatorTokensFromNormalizedText(value: string): string[] {
  return value.match(SEARCH_WORD_PATTERN) || [];
}

export function extractLocatorTokens(value: string): string[] {
  return extractQuoteTextTokens(value || "");
}

export function isLocatorQueryLongEnough(
  value: string,
  minQueryLength: number,
): boolean {
  const normalized = normalizeLocatorText(value);
  if (!normalized) return false;
  if (normalized.length >= minQueryLength) return true;
  const tokens = locatorTokensFromNormalizedText(normalized);
  if (!tokens.some(hasNonAsciiToken)) return false;
  const nonAsciiTokenChars = tokens
    .filter(hasNonAsciiToken)
    .reduce((sum, token) => sum + tokenCharLength(token), 0);
  const nonAsciiMinLength = Math.min(
    12,
    Math.max(6, Math.ceil(minQueryLength / 2)),
  );
  return nonAsciiTokenChars >= nonAsciiMinLength;
}

/**
 * Strip leading and trailing ellipsis from a quote while preserving the
 * interior. Returns the trimmed string.
 */
export function stripBoundaryEllipsis(text: string): string {
  return text
    .replace(new RegExp("^\\s*" + ELLIPSIS_RE.source + "\\s*"), "")
    .replace(new RegExp("\\s*" + ELLIPSIS_RE.source + "\\s*$"), "")
    .trim();
}

/**
 * Split a quote at internal ellipsis markers, returning the segments sorted by
 * descending length. Segments shorter than 30 chars are too weak for reliable
 * reader or citation matching.
 */
export function splitQuoteAtEllipsis(text: string): string[] {
  return splitQuoteAtEllipsisInOrder(text)
    .filter((segment) => segment.length >= 30)
    .sort((a, b) => b.length - a.length);
}

/**
 * Split a displayed quote at internal ellipsis markers without changing the
 * author's source order. Navigation cards must use this form.
 */
export function splitQuoteAtEllipsisInOrder(text: string): string[] {
  const cleaned = stripBoundaryEllipsis(text);
  if (!ELLIPSIS_RE.test(cleaned)) return [cleaned];
  return cleaned
    .split(ELLIPSIS_RE_G)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stripInlineLocatorNoise(value: string): string {
  const cleaned = sanitizeText(value || "");
  return cleaned
    .replace(/\(([^)]{0,160})\)/gi, (_match, inner: string) =>
      /\b(fig|figure|table|appendix|supp|supplement|eq|equation|section|sec\.?|et al|19\d{2}|20\d{2})\b/i.test(
        inner,
      )
        ? " "
        : ` ${inner} `,
    )
    .replace(/\[([^\]]{0,160})\]/gi, (_match, inner: string) =>
      /\b(fig|figure|table|appendix|supp|supplement|eq|equation|section|sec\.?|et al|19\d{2}|20\d{2})\b/i.test(
        inner,
      )
        ? " "
        : ` ${inner} `,
    );
}

export function extractSearchTokens(value: string): string[] {
  return extractLocatorTokens(stripInlineLocatorNoise(value));
}

export function scoreSearchToken(token: string): number {
  if (!token) return Number.NEGATIVE_INFINITY;
  const length = tokenCharLength(token);
  if (
    PLAIN_ASCII_WORD_PATTERN.test(token) &&
    COMMON_SEARCH_STOP_WORDS.has(token)
  ) {
    return 0.5;
  }
  if (NUMERIC_TOKEN_PATTERN.test(token)) return 0.2;
  if (hasNonAsciiToken(token)) return Math.min(16, length * 2);
  if (length <= 2) return 0.2;
  if (length === 3) return 1.5;
  return Math.min(8, length + (/[a-z]/.test(token) ? 1 : 0));
}

export function formatQuoteSearchQuerySnippet(
  query: string,
  maxLength = 72,
): string {
  if (query.length <= maxLength) return query;
  return `${query.slice(0, maxLength - 3)}...`;
}

export function getProgressiveStartOffsets(tokens: string[]): number[] {
  const offsets = [0];
  if (tokens.length > 6 && scoreSearchToken(tokens[0]) < 2) {
    offsets.push(1);
  }
  if (
    tokens.length > 8 &&
    scoreSearchToken(tokens[0]) < 1 &&
    scoreSearchToken(tokens[1]) < 2
  ) {
    offsets.push(2);
  }
  if (tokens.length >= 10) {
    offsets.push(Math.floor(tokens.length / 2));
  }
  if (tokens.length >= 16) {
    offsets.push(Math.floor(tokens.length / 3));
    offsets.push(Math.floor((tokens.length * 2) / 3));
  }
  return Array.from(new Set(offsets));
}

/** Count all overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  return countCanonicalTextMatches(haystack, needle);
}

function pushUniqueQuery(
  queries: QuoteTextSearchQuery[],
  seen: Set<string>,
  query: string,
  kind: QuoteTextSearchQueryKind,
  confidence: "high" | "medium",
  minQueryLength: number,
): void {
  const normalized = normalizeLocatorText(query);
  if (
    !isLocatorQueryLongEnough(normalized, minQueryLength) ||
    seen.has(normalized)
  )
    return;
  seen.add(normalized);
  queries.push({ query: normalized, kind, confidence });
}

function pushNormalizedWindowQueries(params: {
  queries: QuoteTextSearchQuery[];
  seen: Set<string>;
  normalized: string;
  kind: "raw-prefix" | "raw-suffix" | "raw-middle";
  minQueryLength: number;
}): void {
  const { queries, seen, normalized, kind, minQueryLength } = params;
  for (const len of NORMALIZED_QUERY_LENGTHS) {
    if (normalized.length <= len) continue;
    const query =
      kind === "raw-prefix"
        ? normalized
            .slice(0, len)
            .replace(/\s\S*$/, "")
            .trim()
        : normalized
            .slice(-len)
            .replace(/^\S*\s/, "")
            .trim();
    pushUniqueQuery(
      queries,
      seen,
      query,
      kind,
      len >= 25 ? "high" : "medium",
      minQueryLength,
    );
  }
}

function pushNormalizedMiddleQueries(params: {
  queries: QuoteTextSearchQuery[];
  seen: Set<string>;
  normalized: string;
  minQueryLength: number;
}): void {
  const { queries, seen, normalized, minQueryLength } = params;
  if (normalized.length < 40) return;
  for (const fraction of [1 / 3, 1 / 2]) {
    const midStart = Math.floor(normalized.length * fraction);
    for (const len of [60, 40, 30, 20]) {
      if (midStart + len > normalized.length) continue;
      const query = normalized
        .slice(midStart, midStart + len)
        .replace(/^\S*\s/, "")
        .replace(/\s\S*$/, "")
        .trim();
      pushUniqueQuery(
        queries,
        seen,
        query,
        "raw-middle",
        len >= 30 ? "high" : "medium",
        minQueryLength,
      );
    }
  }
}

export function buildQuoteTextSearchQueries(
  quoteText: string,
  options?: { minQueryLength?: number; includeProgressiveQueries?: boolean },
): QuoteTextSearchQuery[] {
  const minQueryLength = Math.max(1, options?.minQueryLength ?? 10);
  const includeProgressiveQueries = options?.includeProgressiveQueries ?? true;
  const clean = stripBoundaryEllipsis(sanitizeText(quoteText || "").trim());
  const queries: QuoteTextSearchQuery[] = [];
  const seen = new Set<string>();
  const normalized = normalizeLocatorText(clean);
  if (!normalized) return queries;

  pushUniqueQuery(queries, seen, normalized, "exact", "high", minQueryLength);

  const segments = splitQuoteAtEllipsis(clean);
  for (const segment of segments) {
    const normalizedSegment = normalizeLocatorText(segment);
    if (!normalizedSegment || normalizedSegment === normalized) continue;
    pushUniqueQuery(
      queries,
      seen,
      normalizedSegment,
      "ellipsis-segment",
      "high",
      minQueryLength,
    );
    for (const charLen of [120, 80, 50]) {
      if (normalizedSegment.length <= charLen) continue;
      const prefix = normalizedSegment
        .slice(0, charLen)
        .replace(/\s\S*$/, "")
        .trim();
      pushUniqueQuery(
        queries,
        seen,
        prefix,
        "ellipsis-segment",
        "high",
        minQueryLength,
      );
    }
  }

  if (normalized.length <= 200) {
    pushUniqueQuery(
      queries,
      seen,
      normalized,
      "raw-prefix",
      "high",
      minQueryLength,
    );
  }
  pushNormalizedWindowQueries({
    queries,
    seen,
    normalized,
    kind: "raw-prefix",
    minQueryLength,
  });
  pushNormalizedWindowQueries({
    queries,
    seen,
    normalized,
    kind: "raw-suffix",
    minQueryLength,
  });
  pushNormalizedMiddleQueries({ queries, seen, normalized, minQueryLength });

  if (includeProgressiveQueries) {
    const tokens = extractSearchTokens(clean);
    const minTokenQueryLength = tokens.length >= 12 ? 4 : 3;
    const maxTokenQueryLength = Math.min(tokens.length, 14);
    for (const offset of getProgressiveStartOffsets(tokens)) {
      for (
        let queryLength = minTokenQueryLength;
        queryLength <= maxTokenQueryLength &&
        offset + queryLength <= tokens.length;
        queryLength += 1
      ) {
        pushUniqueQuery(
          queries,
          seen,
          tokens.slice(offset, offset + queryLength).join(" "),
          "progressive",
          queryLength >= 6 ? "high" : "medium",
          minQueryLength,
        );
      }
    }
  }

  return queries;
}

export function buildFindControllerHighlightQueries(
  text: string,
  options?: {
    maxQueries?: number;
    maxFullQueryLength?: number;
    maxChunkLength?: number;
  },
): string[] {
  const clean = stripBoundaryEllipsis(sanitizeText(text || "").trim());
  void options;
  return clean ? [clean] : [];
}

export function buildFindControllerFullCoverageQueries(
  text: string,
  options?: {
    maxQueries?: number;
    maxFullQueryLength?: number;
  },
): string[] {
  const clean = stripBoundaryEllipsis(sanitizeText(text || "").trim());
  void options;
  return clean ? [clean] : [];
}

export function buildFindControllerQuoteQueries(
  text: string,
  options?: { maxQueries?: number },
): string[] {
  const clean = stripBoundaryEllipsis(sanitizeText(text || "").trim());
  void options;
  return clean ? [clean] : [];
}

function isWeakQuoteSearchQuery(normalizedQuery: string): boolean {
  const tokens = locatorTokensFromNormalizedText(normalizedQuery);
  if (!tokens.length) return true;
  const hasNonAscii = tokens.some(hasNonAsciiToken);
  if (!hasNonAscii && tokens.length < 3) return true;
  const informativeTokens = tokens.filter(
    (token) =>
      tokenCharLength(token) >= 4 &&
      !(
        PLAIN_ASCII_WORD_PATTERN.test(token) &&
        COMMON_SEARCH_STOP_WORDS.has(token)
      ) &&
      !NUMERIC_TOKEN_PATTERN.test(token),
  );
  const score = tokens.reduce((sum, token) => sum + scoreSearchToken(token), 0);
  if (
    !hasNonAscii &&
    informativeTokens.length < 2 &&
    normalizedQuery.length < 36
  )
    return true;
  return score < 9;
}

function normalizeEntries(
  entries: QuoteTextSearchEntry[],
): NormalizedQuoteTextSearchEntry[] {
  return entries
    .map((entry) => {
      const normalizedText =
        entry.normalizedText !== undefined
          ? normalizeLocatorText(entry.normalizedText)
          : buildQuoteTextIndex(entry.text).canonicalText;
      return {
        id: String(entry.id || ""),
        normalizedText,
        debugLabel: entry.debugLabel || String(entry.id || ""),
      };
    })
    .filter((entry) => entry.id && entry.normalizedText);
}

function hasNonBoundaryCanonicalOccurrence(
  haystack: string,
  needle: string,
): boolean {
  return Boolean(haystack && needle && haystack.includes(needle));
}

export function findUniqueQuoteTextSearchMatch(
  entries: QuoteTextSearchEntry[],
  quoteText: string,
  options?: QuoteTextSearchOptions,
): QuoteTextSearchMatch | null {
  const minQueryLength = Math.max(1, options?.minQueryLength ?? 24);
  const maxSameEntryOccurrences = Math.max(
    1,
    options?.maxSameEntryOccurrences ?? 6,
  );
  const rejectWeakQueries = options?.rejectWeakQueries ?? true;
  const normalizedEntries = normalizeEntries(entries);
  if (!normalizedEntries.length) return null;

  const queries = buildQuoteTextSearchQueries(quoteText, {
    minQueryLength,
    includeProgressiveQueries: options?.includeProgressiveQueries ?? true,
  });
  const debugSummary: string[] = [];
  let bestMatch: QuoteTextSearchMatch | null = null;
  const nonBoundaryExactEntryIds = new Set<string>();

  for (const query of queries) {
    const normalizedQuery = normalizeLocatorText(query.query);
    if (!isLocatorQueryLongEnough(normalizedQuery, minQueryLength)) continue;
    if (rejectWeakQueries && isWeakQuoteSearchQuery(normalizedQuery)) {
      debugSummary.push(
        `${options?.debugLabel || "Quote"} ${query.kind} "${formatQuoteSearchQuerySnippet(
          normalizedQuery,
        )}" -> skipped weak query`,
      );
      continue;
    }
    const matchedEntryIds: string[] = [];
    let totalOccurrences = 0;
    let hasNonBoundaryExactOccurrence = false;
    for (const entry of normalizedEntries) {
      if (query.kind !== "exact" && nonBoundaryExactEntryIds.has(entry.id)) {
        continue;
      }
      const occurrences = countOccurrences(
        entry.normalizedText,
        normalizedQuery,
      );
      if (occurrences <= 0) {
        if (
          query.kind === "exact" &&
          hasNonBoundaryCanonicalOccurrence(
            entry.normalizedText,
            normalizedQuery,
          )
        ) {
          hasNonBoundaryExactOccurrence = true;
          nonBoundaryExactEntryIds.add(entry.id);
        }
        continue;
      }
      matchedEntryIds.push(entry.id);
      totalOccurrences += occurrences;
    }
    debugSummary.push(
      `${options?.debugLabel || "Quote"} ${query.kind} "${formatQuoteSearchQuerySnippet(
        normalizedQuery,
      )}" -> ${matchedEntryIds.length ? matchedEntryIds.join(", ") : "none"} (${totalOccurrences} total)`,
    );
    if (
      query.kind === "exact" &&
      !matchedEntryIds.length &&
      hasNonBoundaryExactOccurrence
    ) {
      debugSummary.push(
        `${options?.debugLabel || "Quote"} exact "${formatQuoteSearchQuerySnippet(
          normalizedQuery,
        )}" -> skipped non-boundary canonical match`,
      );
      continue;
    }
    if (
      matchedEntryIds.length === 1 &&
      totalOccurrences <= maxSameEntryOccurrences
    ) {
      if (totalOccurrences === 1) {
        return {
          entryId: matchedEntryIds[0],
          query: query.query,
          normalizedQuery,
          matchKind: query.kind,
          confidence: query.confidence,
          totalOccurrences,
          matchedEntryIds,
          debugSummary,
        };
      }
      if (
        !bestMatch ||
        normalizedQuery.length > bestMatch.normalizedQuery.length
      ) {
        bestMatch = {
          entryId: matchedEntryIds[0],
          query: query.query,
          normalizedQuery,
          matchKind: query.kind,
          confidence: "medium",
          totalOccurrences,
          matchedEntryIds,
          debugSummary: debugSummary.slice(),
        };
      }
    }
  }

  return bestMatch
    ? {
        ...bestMatch,
        debugSummary,
      }
    : null;
}
