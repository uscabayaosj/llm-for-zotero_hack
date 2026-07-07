/**
 * Locate cited quotes inside Zotero's EPUB reader.
 *
 * The PDF citation path navigates by page index and uses pdf.js
 * FindController internals. EPUBs have no stable page geometry, so this
 * module opens the attachment in Zotero's reader (which supports EPUB since
 * Zotero 7) and locates the quoted passage in the rendered DOM:
 *
 *   1. `window.find()` inside the reader's content iframe — Gecko scrolls to
 *      and selects the first match, and returns whether it matched.
 *   2. The unified reader view's `setFindState`/`findNext` — best-effort
 *      fallback that also renders the reader's own find highlight.
 *
 * Quote text is retried with progressively shorter queries (full quote,
 * ellipsis segments, first sentence, leading words) because EPUB rendering
 * can differ from extracted text in whitespace and soft hyphens.
 */
import { sanitizeText } from "./textUtils";

export type EpubQuoteJumpResult = {
  opened: boolean;
  matched: boolean;
  queryUsed?: string;
  reason?: string;
};

const EPUB_CONTENT_TYPE = "application/epub+zip";
const READER_OPEN_TIMEOUT_MS = 8000;
const SECTION_MOUNT_RETRY_MS = 350;
const QUOTE_SEARCH_TIMEOUT_MS = 6000;
const MIN_QUERY_CHARS = 16;
const MAX_QUERY_CHARS = 240;

export function isEpubAttachmentItem(
  item: Zotero.Item | null | undefined,
): boolean {
  if (!item?.isAttachment?.()) return false;
  const contentType = String(
    (item as unknown as { attachmentContentType?: unknown })
      .attachmentContentType || "",
  )
    .trim()
    .toLowerCase();
  if (contentType === EPUB_CONTENT_TYPE) return true;
  const filename = String(
    (item as unknown as { attachmentFilename?: unknown }).attachmentFilename ||
      "",
  )
    .trim()
    .toLowerCase();
  return !contentType && filename.endsWith(".epub");
}

export function isEpubContextAttachmentId(contextItemId: number): boolean {
  const normalized = Math.floor(Number(contextItemId));
  if (!Number.isFinite(normalized) || normalized <= 0) return false;
  try {
    return isEpubAttachmentItem(Zotero.Items.get(normalized) || null);
  } catch (_err) {
    void _err;
    return false;
  }
}

function normalizeQuoteWhitespace(value: string): string {
  return sanitizeText(value || "")
    .replace(/[­]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function splitQuoteEllipsisSegments(value: string): string[] {
  return value
    .split(/(?:\.{3,}|…|\[\s*\.{3,}\s*\]|\[\s*…\s*\])/g)
    .map((segment) => normalizeQuoteWhitespace(segment))
    .filter((segment) => segment.length >= MIN_QUERY_CHARS);
}

function firstSentence(value: string): string {
  const match = value.match(/^[\s\S]{16,}?[.!?。！？](?=\s|$)/);
  return normalizeQuoteWhitespace(match?.[0] || "");
}

function leadingWords(value: string, wordCount: number): string {
  return normalizeQuoteWhitespace(
    value.split(/\s+/).slice(0, wordCount).join(" "),
  );
}

/**
 * Build the ordered list of search queries for a quote: exact text first,
 * then progressively shorter fragments that survive rendering differences.
 */
export function buildEpubQuoteSearchQueries(quoteTexts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string) => {
    const normalized = normalizeQuoteWhitespace(candidate);
    if (
      normalized.length < MIN_QUERY_CHARS ||
      normalized.length > MAX_QUERY_CHARS
    ) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  for (const rawQuote of quoteTexts) {
    const quote = normalizeQuoteWhitespace(rawQuote);
    if (!quote) continue;
    push(quote);
    for (const segment of splitQuoteEllipsisSegments(quote)) push(segment);
    push(firstSentence(quote));
    push(leadingWords(quote, 12));
    push(leadingWords(quote, 8));
  }
  return out;
}

function getReaderItemId(reader: any): number {
  const raw = Number(reader?._item?.id || reader?.itemID || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openEpubReader(contextItemId: number): Promise<any | null> {
  const targetItemId = Math.floor(Number(contextItemId));
  const readerApi = Zotero.Reader as
    | { open?: (itemID: number) => Promise<unknown> }
    | undefined;
  let reader: any = null;
  try {
    if (typeof readerApi?.open === "function") {
      reader = await readerApi.open(targetItemId);
    }
  } catch (_err) {
    void _err;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < READER_OPEN_TIMEOUT_MS) {
    if (getReaderItemId(reader) === targetItemId && reader?._internalReader) {
      return reader;
    }
    const openReaders =
      (
        Zotero.Reader as unknown as {
          _readers?: any[];
        }
      )?._readers || [];
    const existing = openReaders.find(
      (candidate) => getReaderItemId(candidate) === targetItemId,
    );
    if (existing?._internalReader) return existing;
    if (!reader && existing) reader = existing;
    await sleep(120);
  }
  return getReaderItemId(reader) === targetItemId ? reader : null;
}

function getEpubReaderContentWindow(reader: any): Window | null {
  const internal = reader?._internalReader;
  const view = internal?._primaryView || internal?._lastView;
  const win = view?._iframeWindow;
  return win && typeof (win as Window).document === "object"
    ? (win as Window)
    : null;
}

type GeckoFindWindow = Window & {
  find?: (
    text: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean,
  ) => boolean;
};

function tryWindowFind(win: Window, query: string): boolean {
  const finder = (win as GeckoFindWindow).find;
  if (typeof finder !== "function") return false;
  try {
    // Reset the selection so repeated searches start from the top.
    win.getSelection?.()?.removeAllRanges?.();
    return Boolean(
      finder.call(win, query, false, false, true, false, true, false),
    );
  } catch (_err) {
    void _err;
    return false;
  }
}

function tryReaderFindState(reader: any, query: string): boolean {
  const internal = reader?._internalReader;
  const view = internal?._primaryView || internal?._lastView;
  const findState = {
    popupOpen: false,
    active: true,
    query,
    highlightAll: true,
    caseSensitive: false,
    entireWord: false,
    result: null,
  };
  try {
    if (typeof view?.setFindState === "function") {
      view.setFindState(findState);
      if (typeof view.findNext === "function") void view.findNext();
      return true;
    }
    if (typeof internal?.setFindState === "function") {
      internal.setFindState(findState);
      if (typeof internal.findNext === "function") void internal.findNext();
      return true;
    }
  } catch (_err) {
    void _err;
  }
  return false;
}

/**
 * Open the EPUB attachment in Zotero's reader and scroll to the first quote
 * text that can be located in the rendered book.
 */
export async function navigateToQuoteInEpubReader(
  contextItemId: number,
  quoteTexts: string[],
): Promise<EpubQuoteJumpResult> {
  if (!isEpubContextAttachmentId(contextItemId)) {
    return { opened: false, matched: false, reason: "not-epub" };
  }
  const reader = await openEpubReader(Math.floor(Number(contextItemId)));
  if (!reader) {
    return { opened: false, matched: false, reason: "reader-open-failed" };
  }

  const queries = buildEpubQuoteSearchQueries(quoteTexts);
  if (!queries.length) {
    return { opened: true, matched: false, reason: "no-quote-text" };
  }

  // EPUB sections mount progressively; retry until the search succeeds or
  // the budget is spent.
  const startedAt = Date.now();
  while (Date.now() - startedAt < QUOTE_SEARCH_TIMEOUT_MS) {
    const win = getEpubReaderContentWindow(reader);
    if (win) {
      for (const query of queries) {
        if (tryWindowFind(win, query)) {
          // Also engage the reader's own find highlight so the match stays
          // visible after the selection is dismissed. Best effort only.
          tryReaderFindState(reader, query);
          return { opened: true, matched: true, queryUsed: query };
        }
      }
    }
    await sleep(SECTION_MOUNT_RETRY_MS);
  }

  // Deterministic search failed — leave the reader's find bar primed with
  // the longest query so the user can step through near-matches.
  const fallbackEngaged = tryReaderFindState(reader, queries[0]);
  return {
    opened: true,
    matched: false,
    queryUsed: fallbackEngaged ? queries[0] : undefined,
    reason: "quote-not-found",
  };
}
