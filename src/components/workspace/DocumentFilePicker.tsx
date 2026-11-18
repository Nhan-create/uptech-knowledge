"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Sparkles,
  UploadCloud,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import type { DocumentDetailView, SpaceSummaryView } from "@/features/knowledge/model";
import { cn } from "@/lib/utils";

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "csv", "json"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface UploadedReceipt {
  readonly id: string;
  readonly name: string;
  readonly chunkCount: number;
}

const COPY = {
  vi: {
    heading: "Tải tài liệu lên kho tri thức",
    sub: "Kéo thả hoặc chọn tệp PDF (OCR & bóc tách cấu trúc), DOCX, MD, TXT, CSV, JSON (tối đa 10 MB/tệp).",
    spaceLabel: "Lưu vào không gian:",
    chooseFiles: "Chọn tệp từ máy",
    uploading: "Đang tải & lập chỉ mục…",
    unsupported: (name: string) =>
      `Tệp "${name}" không được hỗ trợ. Chỉ nhận PDF, DOCX, DOCX, MD, TXT, CSV, JSON.`,
    tooLarge: (name: string) => `Tệp "${name}" vượt quá giới hạn 10 MB.`,
    failed: "Không thể tải tệp lên. Vui lòng thử lại.",
    uploadedDone: (count: number) => `Đã lập chỉ mục ${count} tài liệu:`,
    sectionsBadge: (count: number) => `${count} đoạn`,
    openDetail: "Xem chi tiết",
    askAi: "Hỏi Trợ lý AI",
  },
  en: {
    heading: "Upload documents to the workspace library",
    sub: "Drop or browse PDF (OCR & extraction), DOCX, MD, TXT, CSV, or JSON files (max 10 MB each).",
    spaceLabel: "Target space:",
    chooseFiles: "Choose files",
    uploading: "Uploading & indexing…",
    unsupported: (name: string) =>
      `"${name}" is unsupported. Allowed: PDF, DOCX, MD, TXT, CSV, JSON.`,
    tooLarge: (name: string) => `"${name}" exceeds the 10 MB limit.`,
    failed: "Unable to upload document. Please retry.",
    uploadedDone: (count: number) => `Indexed ${count} document(s):`,
    sectionsBadge: (count: number) => `${count} sections`,
    openDetail: "Open detail",
    askAi: "Ask AI",
  },
} as const;

export function DocumentFilePicker({
  spaces = [],
  defaultSpaceId = "",
}: Readonly<{
  spaces?: readonly SpaceSummaryView[];
  defaultSpaceId?: string;
}> = {}) {
  const router = useRouter();
  const { locale } = usePreferences();
  const copy = COPY[locale];

  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(
    defaultSpaceId || spaces[0]?.id || "spc_8f2a01",
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<UploadedReceipt[]>([]);

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    setErrorMessage(null);
    setIsUploading(true);
    const added: UploadedReceipt[] = [];

    try {
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          setErrorMessage(copy.unsupported(file.name));
          continue;
        }
        if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
          setErrorMessage(copy.tooLarge(file.name));
          continue;
        }

        const formData = new FormData();
        formData.set("file", file);
        formData.set("locale", locale);
        if (selectedSpaceId) {
          formData.set("spaceId", selectedSpaceId);
        }

        const res = await fetch("/api/v1/workspace/documents", {
          method: "POST",
          body: formData,
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          document?: DocumentDetailView;
          chunkCount?: number;
          error?: { message?: string };
        } | null;

        if (!res.ok || !data?.ok || !data.document) {
          setErrorMessage(data?.error?.message ?? copy.failed);
          continue;
        }

        added.push({
          id: data.document.id,
          name: data.document.name,
          chunkCount: data.chunkCount ?? data.document.sections?.length ?? 1,
        });
      }

      if (added.length > 0) {
        setReceipts((prev) => [...added, ...prev].slice(0, 6));
        router.refresh();
      }
    } catch {
      setErrorMessage(copy.failed);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void uploadFiles(event.currentTarget.files);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }

  return (
    <section
      id="library-upload-zone"
      aria-labelledby="library-upload-heading"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "rounded-2xl border border-dashed p-5 transition-colors sm:p-6",
        isDragging
          ? "border-[#1B44FF] bg-[#EEF1FF]"
          : "border-[#C8D2FF] bg-gradient-to-br from-[#F5F7FF] via-white to-white",
      )}
    >
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]">
            {isUploading ? (
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
            ) : (
              <UploadCloud aria-hidden="true" className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <h2
              id="library-upload-heading"
              className="text-base font-bold text-[#0D1321]"
            >
              {copy.heading}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#505A6E]">
              {copy.sub}
            </p>
          </div>
        </div>

        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2.5 lg:w-auto">
          {spaces.length > 0 ? (
            <label className="inline-flex items-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-3 py-1.5 text-xs font-medium text-[#323B4D]">
              <span className="hidden sm:inline">{copy.spaceLabel}</span>
              <select
                aria-label={copy.spaceLabel}
                value={selectedSpaceId}
                onChange={(event) => setSelectedSpaceId(event.currentTarget.value)}
                disabled={isUploading}
                className="bg-transparent font-semibold text-[#0D1321] outline-none"
              >
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <input
            ref={inputRef}
            id="document-file-picker"
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            tabIndex={-1}
            accept=".pdf,.docx,.txt,.md,.csv,.json"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#1B44FF] px-4 text-sm font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7] disabled:cursor-wait disabled:opacity-75"
          >
            <FileUp aria-hidden="true" className="size-4" />
            <span>{isUploading ? copy.uploading : copy.chooseFiles}</span>
          </button>
        </div>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]"
        >
          {errorMessage}
        </p>
      ) : null}

      {receipts.length > 0 ? (
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-[#076944]/20 bg-[#F2FBF6] p-3.5"
        >
          <p className="flex items-center gap-2 text-xs font-semibold text-[#076944]">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {copy.uploadedDone(receipts.length)}
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {receipts.map((item) => (
              <li
                key={item.id}
                className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-[#0D1321]/10 bg-white px-3 py-1.5 text-xs"
              >
                <span className="max-w-[220px] truncate font-semibold text-[#0D1321]">
                  {item.name}
                </span>
                <span className="rounded-full bg-[#E7F7EF] px-2 py-0.5 text-[11px] font-medium text-[#076944]">
                  {copy.sectionsBadge(item.chunkCount)}
                </span>
                <Link
                  href={`/documents/${item.id}`}
                  className="font-semibold text-[#1635C7] hover:underline"
                >
                  {copy.openDetail}
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex items-center gap-1 font-semibold text-[#0D1321] hover:text-[#1635C7]"
                >
                  <Sparkles aria-hidden="true" className="size-3" />
                  {copy.askAi}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
