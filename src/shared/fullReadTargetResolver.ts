import type { PaperContextRef } from "./types";
import {
  excludesEnglishFullRead,
  fullReadClausePrefixAt,
  hasJapaneseFullReadNegation,
  hasKoreanFullReadNegation,
  isAffirmativeFullReadCommandAt,
} from "./fullReadIntentPolarity";

export type FullReadTargetResolutionReason =
  | "all-selected"
  | "all-available"
  | "ordinal"
  | "metadata"
  | "partial-title"
  | "selected-default"
  | "compound"
  | "active-default";

export type FullReadTargetResolution = {
  papers: PaperContextRef[];
  reason: FullReadTargetResolutionReason;
};

export class FullReadTargetResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FullReadTargetResolutionError";
  }
}

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "article",
  "both",
  "complete",
  "document",
  "entire",
  "et",
  "for",
  "from",
  "full",
  "in",
  "al",
  "of",
  "on",
  "paper",
  "pdf",
  "read",
  "review",
  "selected",
  "the",
  "text",
  "to",
  "use",
  "whole",
  "with",
]);

const ORDINAL_WORDS = new Map<string, number>([
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["fourth", 3],
  ["fifth", 4],
  ["sixth", 5],
  ["seventh", 6],
  ["eighth", 7],
  ["ninth", 8],
  ["tenth", 9],
]);

const CARDINAL_WORDS = new Map<string, number>([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);

function normalizeText(value: unknown): string {
  return `${value ?? ""}`
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}@_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSelectorSource(value: unknown): string {
  return `${value ?? ""}`
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}@_',;.!?。！？；-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPaperKey(paper: PaperContextRef): string {
  return `${Math.floor(paper.itemId)}:${Math.floor(paper.contextItemId)}`;
}

function dedupePapers(papers: PaperContextRef[]): PaperContextRef[] {
  const seen = new Set<string>();
  return papers.filter((paper) => {
    const key = buildPaperKey(paper);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function resolveSelectedPapers(params: {
  availablePapers: PaperContextRef[];
  selectedPapers?: PaperContextRef[];
}): PaperContextRef[] {
  const available = dedupePapers(params.availablePapers);
  const availableByKey = new Map(
    available.map((paper) => [buildPaperKey(paper), paper]),
  );
  const selected = dedupePapers(params.selectedPapers || [])
    .map((paper) => availableByKey.get(buildPaperKey(paper)))
    .filter((paper): paper is PaperContextRef => Boolean(paper));
  return selected;
}

function resolveAllPapersScope(question: string): {
  scope: "selected" | "available";
  qualified: boolean;
  quantifier: "both" | "set";
} | null {
  if (
    /\b(?:some|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:of\s+(?:(?:the|my|our|these|those)\s+)?)?selected\s+(?:papers?|articles?|documents?|pdfs?)\b/i.test(
      question,
    )
  ) {
    return { scope: "selected", qualified: true, quantifier: "set" };
  }
  const english = question.match(
    /\b(all|every|each|both)(?:\s+(?:of\s+)?(?:the|my|our|these|those))?\s+(?:(selected|available)\s+)?(?:papers?|articles?|documents?|pdfs?)\b/i,
  );
  if (english) {
    const tail = question
      .slice((english.index || 0) + english[0].length)
      .split(
        /\b(?:and|then|while)\s+(?:answer(?:ing)?|compar(?:e|ing)|contrast(?:ing)?|discuss(?:ing)?|explain(?:ing)?|focus(?:ing)?|quot(?:e|ing)|relat(?:e|ing)|respond(?:ing)?|summari[sz](?:e|ing))\b|,\s*(?:answering|comparing|contrasting|discussing|explaining|focusing|quoting|relating|responding|summari[sz]ing)\b|\bwith\s+special\s+attention\s+to\b/i,
        1,
      )[0];
    const qualified =
      /\b(?:about|by|called|except|excluding|on|other\s+than|published(?:\s+in)?|titled|with)\b/iu.test(
        tail,
      ) || /\bfrom\s+(?!start\s+to\s+finish\b)/i.test(tail);
    return {
      scope:
        english[2]?.toLocaleLowerCase() === "selected"
          ? "selected"
          : "available",
      qualified,
      quantifier: english[1]?.toLocaleLowerCase() === "both" ? "both" : "set",
    };
  }
  if (
    /\b(?:read(?:ing)?|use|analy[sz]e|review|process|send)\s+(?:(?:the|my|our|these|those)\s+)?selected\s+(?:papers|articles|documents|pdfs)\b|\bfull\s+text\s+(?:of|from)\s+(?:(?:the|my|our|these|those)\s+)?selected\s+(?:papers|articles|documents|pdfs)\b/i.test(
      question,
    )
  ) {
    return { scope: "selected", qualified: false, quantifier: "set" };
  }
  if (
    /(?:所有|全部)(?:的)?(?:已选|选中)(?:的)?(?:论文|文章|文档)/u.test(
      question,
    ) ||
    /(?:選択した(?:すべて|全て)の(?:論文|記事|文書)|(?:すべて|全て)の選択(?:した|済み)?(?:論文|記事|文書))/u.test(
      question,
    ) ||
    /(?:선택한\s*모든\s*(?:논문|문서|기사)|모든\s*선택된\s*(?:논문|문서|기사))/u.test(
      question,
    )
  ) {
    return { scope: "selected", qualified: false, quantifier: "set" };
  }
  if (
    /(?:所有|全部)(?:的)?(?:可用|当前|这些)?(?:的)?(?:论文|文章|文档)/u.test(
      question,
    ) ||
    /(?:(?:すべて|全て)の(?:論文|記事|文書)|모든\s*(?:논문|문서|기사))/u.test(
      question,
    )
  ) {
    return { scope: "available", qualified: false, quantifier: "set" };
  }
  return null;
}

function ordinalRequiresSelectedPapers(question: string): boolean {
  return (
    /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+(?:the\s+)?)?selected\s+(?:papers?|articles?|documents?|pdfs?)\b/i.test(
      question,
    ) ||
    /第(?:[一二三四五六七八九十]|\d{1,2})+(?:篇|个)?(?:的)?(?:已选|选中)|(?:已选|选中)(?:的)?第(?:[一二三四五六七八九十]|\d{1,2})+/u.test(
      question,
    ) ||
    /選択した(?:\d{1,2}|[一二三四五六七八九十]+)番目の(?:論文|記事|文書)/u.test(
      question,
    ) ||
    /선택한\s*(?:첫|첫째|두|둘째|세|셋째|네|넷째|다섯)\s*번째\s*(?:논문|문서|기사)/u.test(
      question,
    )
  );
}

function parseChineseOrdinal(value: string): number | null {
  if (/^\d{1,2}$/.test(value)) return Number(value);
  const digits = new Map([
    ["一", 1],
    ["二", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
  ]);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits.get(value[1]) || 0);
  if (value.endsWith("十")) return (digits.get(value[0]) || 0) * 10;
  const parts = value.split("十");
  if (parts.length === 2) {
    return (digits.get(parts[0]) || 0) * 10 + (digits.get(parts[1]) || 0);
  }
  return digits.get(value) || null;
}

function parseOrdinalIndex(
  question: string,
  paperCount: number,
): number | null {
  const normalized = normalizeText(question);
  const wordMatch = normalized.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+(?:of\s+(?:the\s+)?)?(?:selected\s+)?(?:papers?|articles?|documents?|pdfs?)\b/,
  );
  if (wordMatch?.[1] === "last") return paperCount - 1;
  if (wordMatch?.[1]) return ORDINAL_WORDS.get(wordMatch[1]) ?? null;

  const numericMatch = normalized.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+(?:the\s+)?)?(?:selected\s+)?(?:papers?|articles?|documents?|pdfs?)\b|\b(?:paper|article|document|pdf)\s+(?:number\s+)?(\d{1,2})\b/,
  );
  const raw = numericMatch?.[1] || numericMatch?.[2];
  if (raw) return Number(raw) - 1;

  const chineseMatch = question.match(
    /第([一二三四五六七八九十\d]{1,3})(?:篇|个)?(?:的)?(?:(?:已选|选中)(?:的)?)?(?:论文|文章|文档)|(?:已选|选中)(?:的)?第([一二三四五六七八九十\d]{1,3})(?:篇|个)?(?:论文|文章|文档)/u,
  );
  const chineseRaw = chineseMatch?.[1] || chineseMatch?.[2];
  const chineseOrdinal = chineseRaw ? parseChineseOrdinal(chineseRaw) : null;
  if (chineseOrdinal) return chineseOrdinal - 1;

  const japaneseMatch = question.match(
    /選択した(\d{1,2}|[一二三四五六七八九十]+)番目の(?:論文|記事|文書)/u,
  );
  const japaneseOrdinal = japaneseMatch?.[1]
    ? parseChineseOrdinal(japaneseMatch[1])
    : null;
  if (japaneseOrdinal) return japaneseOrdinal - 1;

  const koreanMatch = question.match(
    /선택한\s*(첫|첫째|두|둘째|세|셋째|네|넷째|다섯)\s*번째\s*(?:논문|문서|기사)/u,
  );
  const koreanOrdinals = new Map([
    ["첫", 1],
    ["첫째", 1],
    ["두", 2],
    ["둘째", 2],
    ["세", 3],
    ["셋째", 3],
    ["네", 4],
    ["넷째", 4],
    ["다섯", 5],
  ]);
  const koreanOrdinal = koreanMatch?.[1]
    ? koreanOrdinals.get(koreanMatch[1])
    : null;
  return koreanOrdinal ? koreanOrdinal - 1 : null;
}

function parseCoordinatedOrdinalIndices(
  question: string,
  paperCount: number,
): number[] {
  const normalized = normalizeSelectorSource(question);
  const ordinalToken =
    "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\\d{1,2}(?:st|nd|rd|th)?)";
  const match = normalized.match(
    new RegExp(
      `\\b(${ordinalToken}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)${ordinalToken})+)\\s+(?:of\\s+(?:the\\s+)?)?(?:selected\\s+)?(?:papers?|articles?|documents?|pdfs?)\\b`,
    ),
  );
  if (!match?.[1]) return [];

  const values = match[1].match(new RegExp(ordinalToken, "g")) || [];
  const indices = values
    .map((value) => {
      if (value === "last") return paperCount - 1;
      const wordIndex = ORDINAL_WORDS.get(value);
      if (wordIndex !== undefined) return wordIndex;
      const numeric = value.match(/^\d{1,2}/)?.[0];
      return numeric ? Number(numeric) - 1 : -1;
    })
    .filter((index, position, all) => all.indexOf(index) === position);
  return indices.length > 1 ? indices : [];
}

function parseSelectedSubsetIndices(question: string): number[] {
  const normalized = normalizeSelectorSource(question);
  const firstOrLast = normalized.match(
    /\b(first|last)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:of\s+(?:the\s+)?)?selected\s+(?:papers?|articles?|documents?|pdfs?)\b/,
  );
  if (firstOrLast) {
    const count = /^\d+$/.test(firstOrLast[2])
      ? Number(firstOrLast[2])
      : CARDINAL_WORDS.get(firstOrLast[2]) || 0;
    if (count <= 0) return [];
    if (firstOrLast[1] === "last") {
      return Array.from({ length: count }, (_, index) => -count + index);
    }
    return Array.from({ length: count }, (_, index) => index);
  }

  const numbered = normalized.match(
    /\bselected\s+(?:papers?|articles?|documents?|pdfs?)\s+(?:numbers?\s+)?(\d{1,2}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)\d{1,2})+)\b/,
  );
  if (!numbered?.[1]) return [];
  return Array.from(
    new Set(
      (numbered[1].match(/\d{1,2}/g) || []).map((value) => Number(value) - 1),
    ),
  );
}

function creatorAliases(value: string | undefined): string[] {
  const raw = `${value || ""}`.trim();
  if (!raw) return [];
  const beforeComma = raw.split(",")[0] || raw;
  const normalized = normalizeText(beforeComma)
    .replace(/\bet\s+al\b/g, "")
    .trim();
  if (!normalized) return [];
  const primaryCreator = normalized.split(/\s+(?:and|&)\s+/)[0] || normalized;
  const words = primaryCreator.split(" ").filter(Boolean);
  return Array.from(
    new Set([primaryCreator, words.length > 1 ? words[words.length - 1] : ""]),
  ).filter((entry) => entry.length >= 2 || /^\p{Script=Han}$/u.test(entry));
}

function titleTokens(paper: PaperContextRef): string[] {
  return normalizeText(paper.title)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !TITLE_STOP_WORDS.has(token) &&
        !/^\d{1,2}$/.test(token),
    );
}

export function hasFullReadMarker(value: string): boolean {
  return (
    /\b(?:complete|completely|entire|full|fully|whole)\b|\bcover\s+to\s+cover\b|\bfrom\s+start\s+to\s+finish\b/i.test(
      value,
    ) ||
    /(?:全文|完整|全部|整篇|从头到尾|通读|전문|전체|처음부터\s*끝까지|全文|全体|最初から最後まで)/u.test(
      value,
    )
  );
}

function extractAffirmativeFullReadClauses(question: string): string[] {
  const source = normalizeSelectorSource(question);
  const commandPattern =
    /\b(?:read(?:ing)?|use|analy[sz]e|review|process|send|provide)\b|(?:完整阅读|阅读全文|阅读完整|阅读全部|阅读|通读|分析全文|使用全文|发送全文|読む|読んで|分析|읽)/giu;
  const clauses: string[] = [];
  let sawProhibitedFullRead = false;
  const commandMatches = Array.from(source.matchAll(commandPattern));
  if (commandMatches.length === 1) {
    const coordinatedTargets = source.match(
      /\b(?:read(?:ing)?|use|analy[sz]e|review|process|send|provide)\s+([^;.!?。！？；]+?)\s+(paper|article|document|pdf)\s+(?:(?:in\s+(?:its\s+)?entirety|in\s+full|completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)\s+)?(?:,\s*)?and\s+(?!(?:answer|compare|contrast|discuss|explain|focus|quote|relate|respond|summari[sz]e)\b)([^;.!?。！？；]+?)\s+(paper|article|document|pdf)\b(?=[^;.!?。！？；]*(?:\bin\s+(?:its\s+)?entirety\b|\bin\s+full\b|\bcompletely\b|\bfully\b|\bcover\s+to\s+cover\b|\bfrom\s+start\s+to\s+finish\b))/iu,
    );
    if (
      coordinatedTargets &&
      isAffirmativeFullReadCommandAt(source, commandMatches[0]?.index || 0) &&
      !excludesEnglishFullRead(coordinatedTargets[0])
    ) {
      return [
        `read ${coordinatedTargets[1]} ${coordinatedTargets[2]} in full`,
        `read ${coordinatedTargets[3]} ${coordinatedTargets[4]} in full`,
      ];
    }
  }
  for (const [matchIndex, match] of commandMatches.entries()) {
    const index = match.index || 0;
    const prefix = fullReadClausePrefixAt(source, index);
    const boundary = index - prefix.length - 1;

    let start = index;
    const leadingCompleteness = prefix.match(/\b(?:completely|fully)\s+$/i);
    if (leadingCompleteness?.index !== undefined) {
      start = boundary + 1 + leadingCompleteness.index;
    }
    const tail = source.slice(start);
    const punctuationOffset = tail.search(/[;.!?。！？；]/u);
    const nextCommandOffset = commandMatches[matchIndex + 1]?.index;
    const commandOffset =
      nextCommandOffset === undefined ? -1 : nextCommandOffset - start;
    const endOffsets = [punctuationOffset, commandOffset].filter(
      (offset) => offset >= 0,
    );
    const endOffset = endOffsets.length ? Math.min(...endOffsets) : -1;
    const clause = (endOffset >= 0 ? tail.slice(0, endOffset) : tail).trim();
    const polarityContext = `${prefix} ${clause}`;
    if (!hasFullReadMarker(polarityContext)) continue;
    if (
      !isAffirmativeFullReadCommandAt(source, index) ||
      excludesEnglishFullRead(clause) ||
      hasJapaneseFullReadNegation(clause) ||
      hasKoreanFullReadNegation(clause)
    ) {
      sawProhibitedFullRead = true;
      continue;
    }
    const affirmativeClause = hasFullReadMarker(clause)
      ? clause
      : polarityContext.trim();
    if (!clauses.includes(affirmativeClause)) clauses.push(affirmativeClause);
  }
  if (
    !clauses.length &&
    (sawProhibitedFullRead || hasJapaneseFullReadNegation(source))
  ) {
    return [];
  }
  return clauses.length ? clauses : [question];
}

function extractTargetSelectorText(question: string): string {
  const normalized = normalizeSelectorSource(question);
  const candidates = [
    normalized.match(
      /\b(?:complete|entire|whole|full)\s+(.+?)\s+(?:papers?|articles?|documents?|pdfs?)\b/,
    )?.[1],
    normalized.match(
      /\b(?:read|use|analy[sz]e|review|process|send)\s+(.+?)(?:'s|\s+s)\s+(?:complete|entire|whole|full)\s+(?:papers?|articles?|documents?|pdfs?)\b/,
    )?.[1],
    normalized.match(
      /\b(?:read|use|analy[sz]e|review|process|send)\s+(.+?)\s+(?:papers?|articles?|documents?|pdfs?)\b.{0,24}\b(?:in\s+(?:its\s+)?entirety|in\s+full|completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)\b/,
    )?.[1],
    normalized.match(
      /\b(?:read|use|analy[sz]e|review|process|send)\s+(.+?)\s+(?:completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)\b/,
    )?.[1],
    normalized.match(
      /\b(?:paper|article|document|pdf)\s+(?:by|from|called|titled)\s+(.+?)(?:\s+in\s+(?:its\s+)?entirety|\s+in\s+full|\s+completely|\s+fully|$)/,
    )?.[1],
    normalized.match(
      /\bfull\s+text\s+(?:of|from)\s+([^.!?。！？；]+)(?:[.!?。！？；]|$)/,
    )?.[1],
    normalized.match(
      /(?:完整阅读|通读|阅读全文|阅读完整)\s*(.+?)的\s*(?:论文|文章|文档)(?:[。！？；]|$)/u,
    )?.[1],
    normalized.match(
      /(?:完整阅读|通读|阅读全文|阅读完整|分析全文|使用全文|发送全文)\s*(.+?)(?:这|该)?(?:篇)?\s*(?:论文|文章|文档)(?:[。！？；]|$)/u,
    )?.[1],
    normalized.match(
      /(?:阅读|通读)\s*(.+?)\s*(?:论文|文章|文档)(?:的)?(?:完整|全部)(?:内容|全文)/u,
    )?.[1],
    normalized.match(
      /([^。！？；]+?)(?:論文|記事|文書)(?:を)?(?:全文|全体)(?:を)?(?:読む|読んで|分析)/u,
    )?.[1],
    normalized.match(
      /([^.!?。！？；]+?)(?:논문|문서|기사)(?:의)?\s*(?:전문|전체)[^.!?。！？；]{0,12}읽/u,
    )?.[1],
  ];
  const genericTokens = new Set([
    "active",
    "article",
    "current",
    "document",
    "it",
    "paper",
    "pdf",
    "selected",
    "that",
    "the",
    "this",
    "text",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "last",
  ]);
  for (const candidate of candidates) {
    const selector = normalizeText(candidate).replace(
      /\b(?:(?:and|then)\s+)?(?:answer|compare|contrast|critique|describe|discuss|evaluate|explain|focus|focusing|relate|summari[sz]e|tell|with\s+special\s+attention)\b.*$/,
      "",
    );
    if (!selector) continue;
    const tokens = selector.split(" ").filter(Boolean);
    if (
      tokens.every(
        (token) =>
          genericTokens.has(token) || /^\d{1,2}(?:st|nd|rd|th)?$/.test(token),
      )
    ) {
      continue;
    }
    return selector;
  }
  return "";
}

function requestsActivePaper(question: string): boolean {
  return (
    /\b(?:full\s+text\s+(?:of|from)|(?:complete|entire|whole|full))\s+(?:the\s+)?(?:this|that|current|active)\s+(?:paper|article|document|pdf)\b/i.test(
      question,
    ) ||
    /\b(?:this|that|current|active)\s+(?:paper|article|document|pdf)\b[^.!?\n]{0,32}\b(?:in\s+(?:its\s+)?entirety|in\s+full|completely|fully|cover\s+to\s+cover)\b/i.test(
      question,
    ) ||
    /\bread\s+it\b[^.!?\n]{0,24}\b(?:completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)\b/i.test(
      question,
    ) ||
    /(?:阅读|通读|完整阅读)(?:这|该|当前)(?:篇)?(?:论文|文章|文档)|(?:这|该|当前)(?:篇)?(?:论文|文章|文档)(?:的)?(?:完整|全部)(?:内容|全文)/u.test(
      question,
    )
  );
}

function requestsSingularSelectedPaper(question: string): boolean {
  return (
    /\b(?:full\s+text\s+(?:of|from)|(?:complete|entire|whole|full))\s+(?:the\s+)?selected\s+(?:paper|article|document|pdf)\b/i.test(
      question,
    ) ||
    /\b(?:the\s+)?selected\s+(?:paper|article|document|pdf)\b[^.!?\n]{0,32}\b(?:in\s+(?:its\s+)?entirety|in\s+full|completely|fully|cover\s+to\s+cover)\b/i.test(
      question,
    )
  );
}

function describePapers(papers: PaperContextRef[]): string {
  return papers.map((paper) => paper.title).join("; ");
}

function selectorRequestsMultiplePapers(selectorText: string): boolean {
  return /\b(?:and|both)\b|(?:、|和|及|与)/u.test(selectorText);
}

function orderPapersBySelectorMention(
  papers: PaperContextRef[],
  selectorText: string,
): PaperContextRef[] {
  const paddedSelector = ` ${selectorText} `;
  return papers
    .map((paper, originalIndex) => {
      const aliases = [
        normalizeText(paper.title),
        normalizeText(paper.citationKey),
        ...creatorAliases(paper.firstCreator),
        normalizeText(paper.year),
      ].filter(Boolean);
      const positions = aliases
        .filter((alias) => containsPhrase(selectorText, alias))
        .map((alias) => paddedSelector.indexOf(` ${alias} `))
        .filter((position) => position >= 0);
      return {
        paper,
        originalIndex,
        position: positions.length ? Math.min(...positions) : Number.MAX_VALUE,
      };
    })
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ paper }) => paper);
}

function assertOrdinalQualifiersMatch(
  paper: PaperContextRef,
  question: string,
): void {
  const normalized = normalizeText(question);
  const authorQualifier = normalized.match(
    /\bby\s+(.+?)(?=\s+(?:in\s+full|completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)|$)/,
  )?.[1];
  if (
    authorQualifier &&
    !creatorAliases(paper.firstCreator).some((alias) =>
      containsPhrase(authorQualifier, alias),
    )
  ) {
    throw new FullReadTargetResolutionError(
      "The ordinal paper position conflicts with the requested author qualifier.",
    );
  }

  const yearQualifier = normalized.match(/\bfrom\s+((?:19|20)\d{2})\b/)?.[1];
  if (yearQualifier && normalizeText(paper.year) !== yearQualifier) {
    throw new FullReadTargetResolutionError(
      "The ordinal paper position conflicts with the requested year qualifier.",
    );
  }

  const titleQualifier = normalized.match(
    /\b(?:called|titled)\s+(.+?)(?=\s+(?:in\s+full|completely|fully|cover\s+to\s+cover|from\s+start\s+to\s+finish)|$)/,
  )?.[1];
  if (
    titleQualifier &&
    !containsPhrase(titleQualifier, normalizeText(paper.title))
  ) {
    throw new FullReadTargetResolutionError(
      "The ordinal paper position conflicts with the requested title qualifier.",
    );
  }
}

type ResolveFullReadPaperTargetsParams = {
  question: string;
  availablePapers: PaperContextRef[];
  selectedPapers?: PaperContextRef[];
  activePaper?: PaperContextRef | null;
};

function resolveSingleFullReadPaperTarget(
  params: ResolveFullReadPaperTargetsParams,
): FullReadTargetResolution {
  const available = dedupePapers(params.availablePapers);
  if (!available.length) {
    throw new FullReadTargetResolutionError(
      "No paper is available for exhaustive reading.",
    );
  }
  const selectedPapers = resolveSelectedPapers(params);
  const selectedScope = selectedPapers.length ? selectedPapers : available;
  const targetQuestion = params.question || "";

  const selectedSubsetIndices = parseSelectedSubsetIndices(targetQuestion);
  if (selectedSubsetIndices.length) {
    if (!selectedPapers.length) {
      throw new FullReadTargetResolutionError(
        "The request targets selected-paper positions, but no papers are selected.",
      );
    }
    const resolved = selectedSubsetIndices.map((rawIndex) => {
      const index = rawIndex < 0 ? selectedPapers.length + rawIndex : rawIndex;
      const paper = selectedPapers[index];
      if (!paper) {
        throw new FullReadTargetResolutionError(
          `A requested selected-paper position is out of range; ${selectedPapers.length} paper${selectedPapers.length === 1 ? " is" : "s are"} selected.`,
        );
      }
      return paper;
    });
    return { papers: dedupePapers(resolved), reason: "ordinal" };
  }

  const coordinatedOrdinalIndices = parseCoordinatedOrdinalIndices(
    targetQuestion,
    selectedScope.length,
  );
  if (coordinatedOrdinalIndices.length) {
    const requiresSelected = ordinalRequiresSelectedPapers(targetQuestion);
    if (requiresSelected && !selectedPapers.length) {
      throw new FullReadTargetResolutionError(
        "The request targets selected-paper positions, but no papers are selected.",
      );
    }
    const ordinalPapers = requiresSelected ? selectedPapers : selectedScope;
    const resolved = coordinatedOrdinalIndices.map((index) => {
      const paper = ordinalPapers[index];
      if (!paper) {
        throw new FullReadTargetResolutionError(
          `A requested paper position is out of range; ${ordinalPapers.length} paper${ordinalPapers.length === 1 ? " is" : "s are"} available in that scope.`,
        );
      }
      assertOrdinalQualifiersMatch(paper, targetQuestion);
      return paper;
    });
    return { papers: resolved, reason: "ordinal" };
  }

  const ordinalIndex = parseOrdinalIndex(targetQuestion, selectedScope.length);
  if (ordinalIndex !== null) {
    const requiresSelected = ordinalRequiresSelectedPapers(targetQuestion);
    if (requiresSelected && !selectedPapers.length) {
      throw new FullReadTargetResolutionError(
        "The request targets a selected-paper position, but no papers are selected.",
      );
    }
    const ordinalPapers = requiresSelected ? selectedPapers : selectedScope;
    const ordinalPaper = ordinalPapers[ordinalIndex];
    if (!ordinalPaper) {
      throw new FullReadTargetResolutionError(
        `The requested paper position is out of range; ${ordinalPapers.length} paper${ordinalPapers.length === 1 ? " is" : "s are"} available in that scope.`,
      );
    }
    assertOrdinalQualifiersMatch(ordinalPaper, targetQuestion);
    return { papers: [ordinalPaper], reason: "ordinal" };
  }

  const allPapersScope = resolveAllPapersScope(targetQuestion);
  if (allPapersScope?.qualified) {
    throw new FullReadTargetResolutionError(
      "The qualified all-paper request cannot be resolved safely; use explicit paper targets.",
    );
  }
  if (allPapersScope?.scope === "selected") {
    if (!selectedPapers.length) {
      throw new FullReadTargetResolutionError(
        "The request targets all selected papers, but no papers are selected.",
      );
    }
    if (allPapersScope.quantifier === "both" && selectedPapers.length !== 2) {
      throw new FullReadTargetResolutionError(
        `The request says both selected papers, but ${selectedPapers.length} papers are selected.`,
      );
    }
    return { papers: selectedPapers, reason: "all-selected" };
  }
  if (allPapersScope?.scope === "available") {
    if (allPapersScope.quantifier === "both" && available.length !== 2) {
      throw new FullReadTargetResolutionError(
        `The request says both papers, but ${available.length} papers are available.`,
      );
    }
    return { papers: available, reason: "all-available" };
  }

  const activeKey = params.activePaper ? buildPaperKey(params.activePaper) : "";
  const activePaper =
    available.find((paper) => buildPaperKey(paper) === activeKey) || null;
  if (requestsActivePaper(targetQuestion)) {
    if (!activePaper) {
      throw new FullReadTargetResolutionError(
        "The request targets the active paper, but no active paper is available.",
      );
    }
    return { papers: [activePaper], reason: "active-default" };
  }
  if (requestsSingularSelectedPaper(targetQuestion)) {
    if (!selectedPapers.length) {
      throw new FullReadTargetResolutionError(
        "The request targets the selected paper, but no papers are selected.",
      );
    }
    if (selectedPapers.length !== 1) {
      throw new FullReadTargetResolutionError(
        `The selected-paper reference is ambiguous between: ${describePapers(selectedPapers)}.`,
      );
    }
    return { papers: selectedPapers, reason: "selected-default" };
  }

  const selectorText = extractTargetSelectorText(targetQuestion);
  if (!selectorText) {
    if (activePaper) {
      return { papers: [activePaper], reason: "active-default" };
    }
    if (selectedPapers.length === 1) {
      return { papers: selectedPapers, reason: "selected-default" };
    }
    if (!selectedPapers.length && available.length === 1) {
      return { papers: available, reason: "active-default" };
    }
    throw new FullReadTargetResolutionError(
      `The untargeted full-read request is ambiguous between: ${describePapers(selectedPapers.length ? selectedPapers : available)}.`,
    );
  }

  const exactTitleMatches = available.filter((paper) => {
    const title = normalizeText(paper.title);
    return title.length >= 4 && containsPhrase(selectorText, title);
  });
  const maximalTitleMatches = exactTitleMatches.filter((paper) => {
    const title = normalizeText(paper.title);
    return !exactTitleMatches.some((other) => {
      const otherTitle = normalizeText(other.title);
      return (
        otherTitle.length > title.length && containsPhrase(otherTitle, title)
      );
    });
  });

  let candidates = maximalTitleMatches.length ? maximalTitleMatches : available;
  let constraintCount = maximalTitleMatches.length ? 1 : 0;
  const recognizedTokens = new Set<string>();
  for (const paper of maximalTitleMatches) {
    for (const token of normalizeText(paper.title).split(" ")) {
      if (token) recognizedTokens.add(token);
    }
  }

  const citationMatches = available.filter((paper) => {
    const citationKey = normalizeText(paper.citationKey);
    return (
      citationKey &&
      !recognizedTokens.has(citationKey) &&
      (containsPhrase(selectorText, citationKey) ||
        containsPhrase(selectorText, `@${citationKey}`))
    );
  });
  const explicitCitationKey = selectorText.match(/@[\p{L}\p{N}_-]+/u)?.[0];
  if (citationMatches.length || explicitCitationKey) {
    constraintCount += 1;
    candidates = candidates.filter((paper) => citationMatches.includes(paper));
    for (const paper of citationMatches) {
      const citationKey = normalizeText(paper.citationKey);
      if (citationKey) {
        recognizedTokens.add(citationKey);
        recognizedTokens.add(`@${citationKey}`);
      }
    }
  }

  const creatorMatches = available.filter((paper) =>
    creatorAliases(paper.firstCreator).some(
      (alias) =>
        containsPhrase(selectorText, alias) &&
        alias.split(" ").some((token) => !recognizedTokens.has(token)),
    ),
  );
  if (creatorMatches.length) {
    constraintCount += 1;
    candidates = candidates.filter((paper) => creatorMatches.includes(paper));
    for (const paper of creatorMatches) {
      for (const alias of creatorAliases(paper.firstCreator)) {
        if (!containsPhrase(selectorText, alias)) continue;
        for (const token of alias.split(" ")) recognizedTokens.add(token);
      }
    }
  }

  const explicitYears = Array.from(
    new Set(selectorText.match(/\b(?:19|20)\d{2}\b/g) || []),
  ).filter((year) => !recognizedTokens.has(year));
  if (explicitYears.length) {
    constraintCount += 1;
    candidates = candidates.filter((paper) =>
      explicitYears.includes(normalizeText(paper.year)),
    );
    for (const year of explicitYears) recognizedTokens.add(year);
  }

  if (!candidates.length && constraintCount) {
    throw new FullReadTargetResolutionError(
      `The explicit full-read title, author, citation key, or year constraints are conflicting among: ${describePapers(available)}.`,
    );
  }

  if (maximalTitleMatches.length) {
    const duplicateTitles = new Set<string>();
    for (const paper of candidates) {
      const title = normalizeText(paper.title);
      if (
        candidates.filter((other) => normalizeText(other.title) === title)
          .length > 1
      ) {
        duplicateTitles.add(title);
      }
    }
    if (duplicateTitles.size) {
      throw new FullReadTargetResolutionError(
        `The full-read title is ambiguous between: ${describePapers(candidates)}.`,
      );
    }
    return {
      papers: selectorRequestsMultiplePapers(selectorText)
        ? orderPapersBySelectorMention(candidates, selectorText)
        : candidates,
      reason: "metadata",
    };
  }

  const tokenFrequency = new Map<string, number>();
  const paperTitleTokens = candidates.map((paper) => {
    const tokens = Array.from(new Set(titleTokens(paper)));
    for (const token of tokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
    }
    return { paper, tokens };
  });
  const questionTokens = new Set(selectorText.split(" ").filter(Boolean));
  const meaningfulUnknownTokens = Array.from(questionTokens).filter(
    (token) =>
      !TITLE_STOP_WORDS.has(token) &&
      !recognizedTokens.has(token) &&
      !/^@?[\d_-]+$/.test(token),
  );

  if (constraintCount && !meaningfulUnknownTokens.length) {
    if (
      candidates.length === 1 ||
      (candidates.length > 1 && selectorRequestsMultiplePapers(selectorText))
    ) {
      return {
        papers:
          candidates.length > 1
            ? orderPapersBySelectorMention(candidates, selectorText)
            : candidates,
        reason: "metadata",
      };
    }
    throw new FullReadTargetResolutionError(
      `The full-read paper reference is ambiguous between: ${describePapers(candidates)}.`,
    );
  }
  const partialScores = paperTitleTokens.map(({ paper, tokens }) => {
    const matching = tokens.filter((token) => questionTokens.has(token));
    const unique = matching.filter((token) => tokenFrequency.get(token) === 1);
    return {
      paper,
      score: unique.length * 100 + matching.length * 10,
      uniqueCount: unique.length,
      matchingCount: matching.length,
    };
  });
  const bestPartialScore = Math.max(
    0,
    ...partialScores.map((entry) => entry.score),
  );
  if (bestPartialScore > 0) {
    const matches = partialScores.filter(
      (entry) => entry.score === bestPartialScore,
    );
    const best = matches[0];
    const isStrongEnough =
      best.uniqueCount > 0 ||
      best.matchingCount >= Math.min(2, best.paper.title.split(/\s+/).length);
    if (matches.length === 1 && isStrongEnough) {
      return { papers: [best.paper], reason: "partial-title" };
    }
    throw new FullReadTargetResolutionError(
      `The full-read paper reference is ambiguous between: ${describePapers(matches.map((entry) => entry.paper))}.`,
    );
  }

  throw new FullReadTargetResolutionError(
    `The requested paper could not be resolved among the available papers: ${describePapers(available)}.`,
  );
}

export function resolveFullReadPaperTargets(
  params: ResolveFullReadPaperTargetsParams,
): FullReadTargetResolution {
  const targetQuestions = extractAffirmativeFullReadClauses(
    params.question || "",
  );
  if (!targetQuestions.length) {
    throw new FullReadTargetResolutionError(
      "No affirmative full-read command is available to resolve.",
    );
  }
  if (targetQuestions.length === 1) {
    return resolveSingleFullReadPaperTarget({
      ...params,
      question: targetQuestions[0],
    });
  }

  const papers: PaperContextRef[] = [];
  const seen = new Set<string>();
  for (const targetQuestion of targetQuestions) {
    const resolution = resolveSingleFullReadPaperTarget({
      ...params,
      question: targetQuestion,
    });
    for (const paper of resolution.papers) {
      const key = buildPaperKey(paper);
      if (seen.has(key)) continue;
      seen.add(key);
      papers.push(paper);
    }
  }
  return { papers, reason: "compound" };
}
