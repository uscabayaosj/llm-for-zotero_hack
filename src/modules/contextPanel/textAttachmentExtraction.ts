import { unzipSync } from "fflate";

import type { TextAttachmentSourceMode } from "./contextAttachmentTypes";

function normalizeMetadataText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function resolveTextAttachmentSourceModeFromMetadata(input: {
  contentType?: unknown;
  filename?: unknown;
}): TextAttachmentSourceMode | null {
  const contentType = normalizeMetadataText(input.contentType);
  const filename = normalizeMetadataText(input.filename);
  if (
    contentType === "text/markdown" ||
    contentType === "text/x-markdown" ||
    /\.(md|markdown)$/i.test(filename)
  ) {
    return "markdown";
  }
  if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    /\.html?$/i.test(filename)
  ) {
    return "html";
  }
  if (contentType === "text/plain" || /\.txt$/i.test(filename)) {
    return "txt";
  }
  if (
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(filename)
  ) {
    return "docx";
  }
  if (contentType === "application/epub+zip" || /\.epub$/i.test(filename)) {
    return "epub";
  }
  return null;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return Array.from(bytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
  }
}

export function decodeXmlEntities(text: string): string {
  let result = text;
  for (const [entity, value] of Object.entries(HTML_ENTITY_MAP)) {
    result = result.split(entity).join(value);
  }
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(Number(code)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return result;
}

export function stripHtmlToText(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

export function extractDocxPlainText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return "";
  }
  const documentXml = entries["word/document.xml"];
  if (!documentXml) return "";
  const xml = decodeUtf8(documentXml);
  const paragraphMatches = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const paragraphs: string[] = [];
  const textNodePattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;

  for (const paragraphXml of paragraphMatches) {
    const normalizedParagraph = paragraphXml
      .replace(/<w:tab\b[^>]*\/>/g, "<w:t>\t</w:t>")
      .replace(/<w:br\b[^>]*\/>/g, "<w:t>\n</w:t>");
    const pieces: string[] = [];
    let match: RegExpExecArray | null;
    const nodePattern = new RegExp(
      textNodePattern.source,
      textNodePattern.flags,
    );
    while ((match = nodePattern.exec(normalizedParagraph)) !== null) {
      pieces.push(decodeXmlEntities(match[1]));
    }
    const paragraph = pieces
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (paragraph) paragraphs.push(paragraph);
  }

  if (paragraphs.length) return paragraphs.join("\n");

  const pieces: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = textNodePattern.exec(xml)) !== null) {
    pieces.push(decodeXmlEntities(match[1]));
  }
  return pieces.join("").trim();
}

function normalizeZipEntryPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function findZipEntry(
  entries: Record<string, Uint8Array>,
  path: string,
): Uint8Array | undefined {
  const normalized = normalizeZipEntryPath(path);
  if (entries[normalized]) return entries[normalized];
  const lowered = normalized.toLowerCase();
  for (const [key, value] of Object.entries(entries)) {
    if (normalizeZipEntryPath(key).toLowerCase() === lowered) return value;
  }
  return undefined;
}

function resolveEpubSpineHrefs(entries: Record<string, Uint8Array>): string[] {
  const container = findZipEntry(entries, "META-INF/container.xml");
  if (!container) return [];
  const containerXml = decodeUtf8(container);
  const opfPath = decodeXmlEntities(
    containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/i)?.[1] ||
      containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*'([^']+)'/i)?.[1] ||
      "",
  ).trim();
  if (!opfPath) return [];
  const opfEntry = findZipEntry(entries, opfPath);
  if (!opfEntry) return [];
  const opfXml = decodeUtf8(opfEntry);
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  const manifest = new Map<string, string>();
  for (const itemXml of opfXml.match(/<item\b[^>]*>/gi) || []) {
    const id = itemXml.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const href = itemXml.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    if (id && href) manifest.set(id, decodeXmlEntities(href));
  }

  const hrefs: string[] = [];
  for (const itemrefXml of opfXml.match(/<itemref\b[^>]*>/gi) || []) {
    const idref =
      itemrefXml.match(/\bidref\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const href = idref ? manifest.get(idref) : undefined;
    if (href) hrefs.push(normalizeZipEntryPath(opfDir + href));
  }
  return hrefs;
}

export function extractEpubPlainText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return "";
  }

  let contentPaths = resolveEpubSpineHrefs(entries);
  if (!contentPaths.length) {
    // Malformed package metadata — fall back to every XHTML document in
    // archive order so the book text is still readable.
    contentPaths = Object.keys(entries)
      .filter((path) => /\.x?html?$/i.test(path))
      .sort();
  }

  const sections: string[] = [];
  for (const path of contentPaths) {
    const entry = findZipEntry(entries, path);
    if (!entry) continue;
    const text = stripHtmlToText(decodeUtf8(entry));
    if (text) sections.push(text);
  }
  return sections.join("\n\n").trim();
}

export function extractTextAttachmentContent(
  bytes: Uint8Array,
  sourceMode: TextAttachmentSourceMode,
): string {
  if (sourceMode === "docx") return extractDocxPlainText(bytes);
  if (sourceMode === "epub") return extractEpubPlainText(bytes);
  const text = decodeUtf8(bytes);
  if (sourceMode === "html") return stripHtmlToText(text);
  return text.trim();
}
