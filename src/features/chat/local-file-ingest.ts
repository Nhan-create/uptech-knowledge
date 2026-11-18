import { normalizeFold } from "@/features/dashboard/hero-matching";
import {
  fixtureDocumentId,
  fixtureSpaceId,
  type DocumentDetailView,
  type DocumentSummaryView,
  type FileType,
} from "@/features/knowledge/model";
import type { Locale } from "@/lib/preferences";

export const ALLOWED_LOCAL_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "md",
  "csv",
  "json",
] as const;

export const TEXT_READABLE_EXTENSIONS = new Set<string>([
  "txt",
  "md",
  "csv",
  "json",
]);

export const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_TEXT_CHARS = 12_000;

export type LocalFileValidationError = "unsupported_type" | "file_too_large";

export type ParsedLocalFileEntry = Readonly<{
  summary: DocumentSummaryView;
  detail: DocumentDetailView;
  rawText?: string;
  extension: string;
}>;

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

export function validateLocalUploadFile(
  fileName: string,
  sizeBytes: number,
): LocalFileValidationError | null {
  const ext = getFileExtension(fileName);
  if (!ALLOWED_LOCAL_EXTENSIONS.includes(ext as (typeof ALLOWED_LOCAL_EXTENSIONS)[number])) {
    return "unsupported_type";
  }
  if (sizeBytes > MAX_LOCAL_FILE_BYTES) {
    return "file_too_large";
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toKnowledgeFileType(ext: string): FileType {
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return "md";
}

function truncateSnippet(value: string, maxLen = 280): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen - 1)}…`;
}

/** Find the most relevant paragraph inside uploaded text for a user query. */
export function extractBestMatchingExcerpt(
  text: string,
  query: string,
  locale: Locale = "vi",
): Readonly<{ excerpt: string; locator: string }> {
  const blocks = text
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (blocks.length === 0) {
    return {
      excerpt:
        locale === "en"
          ? "Uploaded file has no readable text content."
          : "Tệp tải lên chưa có nội dung văn bản đọc được.",
      locator: locale === "en" ? "Device file" : "Tệp thiết bị",
    };
  }

  const tokens = normalizeFold(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) {
    return {
      excerpt: truncateSnippet(blocks[0] ?? ""),
      locator: locale === "en" ? "Section 1" : "Đoạn 1",
    };
  }

  let bestIndex = 0;
  let bestScore = -1;
  blocks.forEach((block, idx) => {
    const folded = normalizeFold(block);
    let score = 0;
    for (const token of tokens) {
      if (folded.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  const chosenBlock = blocks[bestIndex] ?? blocks[0] ?? "";
  return {
    excerpt: truncateSnippet(chosenBlock),
    locator:
      locale === "en" ? `Section ${bestIndex + 1}` : `Đoạn ${bestIndex + 1}`,
  };
}

/** Build DocumentSummaryView & DocumentDetailView for a file picked from the user's device. */
export function buildLocalDocumentFromFile({
  id,
  name,
  sizeBytes,
  textContent,
  locale,
}: Readonly<{
  id: string;
  name: string;
  sizeBytes: number;
  textContent?: string;
  locale: Locale;
}>): ParsedLocalFileEntry {
  const ext = getFileExtension(name) || "txt";
  const fileType = toKnowledgeFileType(ext);
  const sizeLabel = formatFileSize(sizeBytes);
  const isTextReadable = TEXT_READABLE_EXTENSIONS.has(ext);
  const trimmedText = textContent
    ? textContent.slice(0, MAX_STORED_TEXT_CHARS).trim()
    : "";

  const firstSnippet =
    isTextReadable && trimmedText.length > 0
      ? extractBestMatchingExcerpt(trimmedText, "", locale)
      : {
          locator:
            locale === "en"
              ? `${ext.toUpperCase()} · ${sizeLabel}`
              : `${ext.toUpperCase()} · ${sizeLabel}`,
          excerpt:
            locale === "en"
              ? `Attached "${name}" (${sizeLabel}) from this device. Full binary PDF/DOCX text & OCR extraction runs once backend parser APIs are connected.`
              : `Đã đính kèm "${name}" (${sizeLabel}) từ thiết bị. Trích xuất toàn văn và OCR cho PDF/DOCX nhị phân sẽ chạy đầy đủ khi kết nối backend parser.`,
        };

  const spaceName = locale === "en" ? "On this device" : "Từ thiết bị";
  const statusLabel = locale === "en" ? "Ready (Local)" : "Sẵn sàng (Thiết bị)";
  const statusDesc = isTextReadable
    ? locale === "en"
      ? "Text content parsed locally in your browser session."
      : "Nội dung văn bản đã được đọc trực tiếp trên trình duyệt."
    : locale === "en"
      ? "Attached locally on this browser; binary OCR/parser awaits backend."
      : "Đã đính kèm cục bộ từ thiết bị; OCR/đọc toàn văn PDF/DOCX cần kết nối backend.";

  const summary: DocumentSummaryView = {
    id: fixtureDocumentId(id),
    name,
    fileType,
    versionLabel: `${ext.toUpperCase()} · ${sizeLabel}`,
    detail: `${ext.toUpperCase()} · ${sizeLabel}`,
    ownerLabel: locale === "en" ? "Uploaded on device" : "Tải từ thiết bị",
    updatedLabel: locale === "en" ? "Just now" : "Vừa tải lên",
    space: {
      id: fixtureSpaceId("spc_local_device"),
      name: spaceName,
    },
    processing: {
      kind: "ready",
      label: statusLabel,
      description: statusDesc,
    },
    governance: [],
  };

  const detail: DocumentDetailView = {
    ...summary,
    versions: [],
    preview: {
      kind: "fixture-excerpt",
      heading: isTextReadable
        ? locale === "en"
          ? "Parsed local text excerpt"
          : "Nội dung đọc từ tệp trên thiết bị"
        : locale === "en"
          ? "Local device attachment"
          : "Tệp đính kèm từ thiết bị",
      locator: firstSnippet.locator,
      excerpt: firstSnippet.excerpt,
    },
  };

  return {
    summary,
    detail,
    rawText: isTextReadable && trimmedText.length > 0 ? trimmedText : undefined,
    extension: ext,
  };
}
