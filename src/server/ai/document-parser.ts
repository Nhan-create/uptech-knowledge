import { inflateRawSync } from "node:zlib";

import { extractPdfSectionsWithGemini } from "@/server/ai/gemini-client";
import type { Locale } from "@/lib/preferences";

export interface ExtractedDocumentChunk {
  readonly chunkIndex: number;
  readonly heading: string;
  readonly locator: string;
  readonly content: string;
}

export const ALLOWED_SERVER_UPLOAD_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "md",
  "txt",
  "csv",
  "json",
]);

export const MAX_SERVER_UPLOAD_BYTES = 10 * 1024 * 1024;

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
 * Extracts `word/document.xml` from a DOCX (ZIP archive) using Node built-in zlib.
 */
function readZipEntryBuffer(archive: Buffer, targetFileName: string): Buffer | null {
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
    if (entryName === targetFileName) {
      const payload = archive.subarray(dataStart, dataEnd);
      if (compression === 0) return payload;
      if (compression === 8) return inflateRawSync(payload);
      return null;
    }

    offset = dataEnd;
    if (effectiveCompressedSize === 0 && compression === 8) {
      break;
    }
  }
  return null;
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

function chunkTextPassages(
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

  return blocks.map((block, index) => ({
    chunkIndex: index,
    heading: block.heading,
    locator: locale === "vi" ? `Đoạn ${index + 1}` : `Section ${index + 1}`,
    content: block.text,
  }));
}

export async function parseUploadedDocumentChunks(args: Readonly<{
  fileName: string;
  extension: string;
  bytes: Uint8Array;
  locale: Locale;
}>): Promise<readonly ExtractedDocumentChunk[]> {
  const ext = args.extension.toLowerCase();

  if (ext === "txt" || ext === "md" || ext === "csv" || ext === "json") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(args.bytes);
    return chunkTextPassages(text, args.fileName, args.locale);
  }

  if (ext === "docx") {
    const paragraphs = extractDocxParagraphs(Buffer.from(args.bytes));
    if (paragraphs.length === 0) return [];
    return chunkTextPassages(paragraphs.join("\n\n"), args.fileName, args.locale);
  }

  if (ext === "pdf") {
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

    const fallbackText = extractBasicPdfTextFallback(args.bytes);
    return chunkTextPassages(fallbackText, args.fileName, args.locale);
  }

  return [];
}
