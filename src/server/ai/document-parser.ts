import { inflateRawSync } from "node:zlib";

import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSION_SET,
} from "@/features/documents/upload-spec";
import { extractPdfSectionsWithGemini } from "@/server/ai/gemini-client";
import type { Locale } from "@/lib/preferences";

export interface ExtractedDocumentChunk {
  readonly chunkIndex: number;
  readonly heading: string;
  readonly locator: string;
  readonly content: string;
}

export const ALLOWED_SERVER_UPLOAD_EXTENSIONS = SUPPORTED_UPLOAD_EXTENSION_SET;

export const MAX_SERVER_UPLOAD_BYTES = MAX_UPLOAD_BYTES;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

/**
 * Extracts matching entries from a ZIP archive using Node built-in zlib.
 */
function readMatchingZipEntries(
  archive: Buffer,
  predicate: (entryName: string) => boolean,
): Array<{ entryName: string; data: Buffer }> {
  const results: Array<{ entryName: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const flags = archive.readUInt16LE(offset + 6);
    const compression = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd + extraLength > archive.length) break;

    const entryName = archive.subarray(nameStart, nameEnd).toString("utf8");
    const dataStart = nameEnd + extraLength;

    let effectiveCompressedSize = compressedSize;
    if ((flags & 0x08) !== 0 && compressedSize === 0) {
      // Fallback scan for ZIP data descriptor when bit 3 is set.
      const nextSig = archive.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      effectiveCompressedSize =
        nextSig === -1 ? archive.length - dataStart : Math.max(0, nextSig - dataStart - 16);
    }

    const dataEnd = Math.min(archive.length, dataStart + effectiveCompressedSize);
    if (predicate(entryName)) {
      const payload = archive.subarray(dataStart, dataEnd);
      if (compression === 0) {
        results.push({ entryName, data: payload });
      } else if (compression === 8) {
        try {
          results.push({ entryName, data: inflateRawSync(payload) });
        } catch {
          // Ignore corrupted entry and continue scanning remaining entries.
        }
      }
    }

    offset = dataEnd;
    if (effectiveCompressedSize === 0 && compression === 8) {
      break;
    }
  }
  return results;
}

function readZipEntryBuffer(archive: Buffer, targetFileName: string): Buffer | null {
  return (
    readMatchingZipEntries(archive, (name) => name === targetFileName)[0]?.data ??
    null
  );
}

export function extractDocxParagraphs(archive: Buffer): readonly string[] {
  const xmlBuffer = readZipEntryBuffer(archive, "word/document.xml");
  if (!xmlBuffer) return [];

  const xml = xmlBuffer.toString("utf8");
  const paragraphs: string[] = [];
  const paragraphMatches = xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g);

  for (const match of paragraphMatches) {
    const inner = match[1] ?? "";
    const textTokens = Array.from(inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((t) => decodeXmlEntities(t[1] ?? ""))
      .join("");
    const cleaned = textTokens.replace(/\s+/g, " ").trim();
    if (cleaned.length > 0) {
      paragraphs.push(cleaned);
    }
  }

  return paragraphs;
}

function extractPptxText(archive: Buffer): string {
  const slides = readMatchingZipEntries(archive, (name) =>
    /^ppt\/slides\/slide\d+\.xml$/iu.test(name),
  ).sort((a, b) => {
    const numA = Number.parseInt(/\d+/.exec(a.entryName)?.[0] ?? "0", 10);
    const numB = Number.parseInt(/\d+/.exec(b.entryName)?.[0] ?? "0", 10);
    return numA - numB;
  });

  const blocks: string[] = [];
  for (const slide of slides) {
    const slideNum = /\d+/.exec(slide.entryName)?.[0] ?? "?";
    const xml = slide.data.toString("utf8");
    const runs = Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g))
      .map((m) => decodeXmlEntities(m[1] ?? "").trim())
      .filter(Boolean);
    if (runs.length > 0) {
      blocks.push(`## Slide ${slideNum}\n${runs.join(" ")}`);
    }
  }
  return blocks.join("\n\n");
}

function extractXlsxText(archive: Buffer): string {
  const entries = readMatchingZipEntries(
    archive,
    (name) =>
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/iu.test(name),
  );
  const sharedStringsXml = entries.find((e) => e.entryName === "xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (sharedStringsXml) {
    const xml = sharedStringsXml.data.toString("utf8");
    for (const siMatch of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const joined = Array.from((siMatch[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
        .map((t) => decodeXmlEntities(t[1] ?? ""))
        .join("");
      sharedStrings.push(joined.trim());
    }
  }

  const sheets = entries
    .filter((e) => e.entryName !== "xl/sharedStrings.xml")
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  const lines: string[] = [];
  for (const sheet of sheets) {
    const xml = sheet.data.toString("utf8");
    const sheetTitle = sheet.entryName.split("/").pop()?.replace(/\.xml$/i, "") ?? "Sheet";
    const rowStrings: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1] ?? "";
        const body = cellMatch[2] ?? "";
        const isShared = /\bt="s"/i.test(attrs);
        const vMatch = /<v>([\s\S]*?)<\/v>/i.exec(body);
        const inlineMatch = /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(body);
        if (inlineMatch?.[1]) {
          cells.push(decodeXmlEntities(inlineMatch[1]).trim());
        } else if (vMatch?.[1]) {
          if (isShared) {
            const idx = Number.parseInt(vMatch[1].trim(), 10);
            const val = sharedStrings[idx];
            if (val) cells.push(val);
          } else {
            cells.push(vMatch[1].trim());
          }
        }
      }
      if (cells.length > 0) rowStrings.push(cells.join(" | "));
    }
    if (rowStrings.length > 0) {
      lines.push(`## ${sheetTitle}\n${rowStrings.join("\n")}`);
    }
  }
  return lines.length > 0 ? lines.join("\n\n") : sharedStrings.filter(Boolean).join("\n");
}

function extractOpenDocumentText(archive: Buffer): string {
  const xmlBuf = readZipEntryBuffer(archive, "content.xml");
  if (!xmlBuf) return "";
  return decodeXmlEntities(
    xmlBuf
      .toString("utf8")
      .replace(/<\/(?:text:p|text:h|table:table-row)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+\n/g, "\n")
    .trim();
}

function extractHtmlOrXmlText(raw: string): string {
  return decodeXmlEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractRtfText(raw: string): string {
  return raw
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/gi, " ")
    .replace(/\\par\b/gi, "\n")
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/[{}]/g, "")
    .trim();
}

function extractLegacyOfficeRuns(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const runs: string[] = [];
  for (const m of latin.matchAll(/[A-Za-z0-9À-ỹ][A-Za-z0-9À-ỹ ,.;:!?()\-_/]{10,240}/g)) {
    runs.push(m[0].trim());
    if (runs.length >= 250) break;
  }
  return runs.join("\n\n");
}

/**
 * Lightweight fallback PDF literal-string reader when Gemini extraction is unavailable.
 */
function extractBasicPdfTextFallback(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const segments: string[] = [];
  for (const match of latin.matchAll(/\(([^()\\]{3,300})\)\s*Tj/g)) {
    const cleaned = (match[1] ?? "").replace(/[^\x20-\x7EÀ-ỹ\s]/g, " ").trim();
    if (cleaned.length >= 3) segments.push(cleaned);
  }
  return segments.join("\n\n");
}

export function chunkTextPassages(
  text: string,
  fileName: string,
  locale: Locale,
): readonly ExtractedDocumentChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  let currentHeading = fileName;
  const blocks: Array<{ heading: string; text: string }> = [];
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").replace(/\s+/g, " ").trim();
    if (body.length > 0) {
      blocks.push({ heading: currentHeading, text: body });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[1]) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    buffer.push(trimmed);
    if (buffer.join(" ").length >= 650) {
      flush();
    }
  }
  flush();

  return blocks.slice(0, 180).map((block, index) => ({
    chunkIndex: index,
    heading: block.heading,
    locator: locale === "vi" ? `Đoạn ${index + 1}` : `Section ${index + 1}`,
    content: block.text,
  }));
}

const PLAIN_TEXT_PARSE_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "log",
  "sql",
  "ini",
  "env",
  "eml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "css",
  "scss",
  "sh",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export async function parseUploadedDocumentChunks(args: Readonly<{
  fileName: string;
  extension: string;
  bytes: Uint8Array;
  locale: Locale;
}>): Promise<readonly ExtractedDocumentChunk[]> {
  const ext = args.extension.toLowerCase();

  if (PLAIN_TEXT_PARSE_EXTENSIONS.has(ext)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(args.bytes);
    return chunkTextPassages(text, args.fileName, args.locale);
  }

  if (ext === "html" || ext === "htm" || ext === "xml") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(args.bytes);
    return chunkTextPassages(extractHtmlOrXmlText(raw), args.fileName, args.locale);
  }

  if (ext === "rtf") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(args.bytes);
    return chunkTextPassages(extractRtfText(raw), args.fileName, args.locale);
  }

  if (ext === "docx") {
    const paragraphs = extractDocxParagraphs(Buffer.from(args.bytes));
    if (paragraphs.length === 0) return [];
    return chunkTextPassages(paragraphs.join("\n\n"), args.fileName, args.locale);
  }

  if (ext === "pptx") {
    return chunkTextPassages(extractPptxText(Buffer.from(args.bytes)), args.fileName, args.locale);
  }

  if (ext === "xlsx") {
    return chunkTextPassages(extractXlsxText(Buffer.from(args.bytes)), args.fileName, args.locale);
  }

  if (ext === "odt" || ext === "ods" || ext === "odp") {
    return chunkTextPassages(
      extractOpenDocumentText(Buffer.from(args.bytes)),
      args.fileName,
      args.locale,
    );
  }

  if (ext === "doc" || ext === "xls" || ext === "ppt") {
    return chunkTextPassages(extractLegacyOfficeRuns(args.bytes), args.fileName, args.locale);
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const summary =
      args.locale === "vi"
        ? `Tệp hình ảnh đính kèm: ${args.fileName} (${ext.toUpperCase()}, ${Math.max(1, Math.round(args.bytes.byteLength / 1024))} KB).`
        : `Uploaded image asset: ${args.fileName} (${ext.toUpperCase()}, ${Math.max(1, Math.round(args.bytes.byteLength / 1024))} KB).`;
    return chunkTextPassages(summary, args.fileName, args.locale);
  }

  if (ext === "pdf") {
    if (args.bytes.byteLength <= 15 * 1024 * 1024) {
      const geminiSections = await extractPdfSectionsWithGemini({
        bytes: args.bytes,
        fileName: args.fileName,
        locale: args.locale,
      });
      if (geminiSections && geminiSections.length > 0) {
        return geminiSections.map((section, index) => ({
          chunkIndex: index,
          heading: section.heading,
          locator: section.locator,
          content: section.content,
        }));
      }
    }

    const fallbackText = extractBasicPdfTextFallback(args.bytes);
    return chunkTextPassages(fallbackText, args.fileName, args.locale);
  }

  return [];
}
