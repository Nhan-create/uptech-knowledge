"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ClipboardPaste,
  FileText,
  FolderOpen,
  Search,
  Trash2,
} from "lucide-react";

import type { DocumentSummaryView, SpaceSummaryView } from "@/features/knowledge/model";
import { cn } from "@/lib/utils";

export type UtilityInputMode = "library" | "paste";

type UtilitySourceConfiguratorProps = Readonly<{
  locale: "vi" | "en";
  documents: readonly DocumentSummaryView[];
  spaces: readonly SpaceSummaryView[];
  inputMode: UtilityInputMode;
  onChangeInputMode: (mode: UtilityInputMode) => void;
  selectedDocIds: readonly string[];
  onChangeDocIds: (ids: string[]) => void;
  pastedTitle: string;
  onChangePastedTitle: (value: string) => void;
  pastedText: string;
  onChangePastedText: (value: string) => void;
}>;

export function UtilitySourceConfigurator({
  locale,
  documents,
  spaces,
  inputMode,
  onChangeInputMode,
  selectedDocIds,
  onChangeDocIds,
  pastedTitle,
  onChangePastedTitle,
  pastedText,
  onChangePastedText,
}: UtilitySourceConfiguratorProps) {
  const [query, setQuery] = useState("");
  const [spaceFilter, setSpaceFilter] = useState<string>("all");

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((doc) => {
      if (spaceFilter !== "all" && doc.space.id !== spaceFilter) return false;
      if (!q) return true;
      return (
        doc.name.toLowerCase().includes(q) ||
        doc.space.name.toLowerCase().includes(q)
      );
    });
  }, [documents, query, spaceFilter]);

  function toggleDocument(id: string) {
    if (selectedDocIds.includes(id)) {
      onChangeDocIds(selectedDocIds.filter((item) => item !== id));
      return;
    }
    if (selectedDocIds.length >= 5) return;
    onChangeDocIds([...selectedDocIds, id]);
  }

  return (
    <div className="space-y-3">
      {/* Segmented source selector */}
      <div
        role="tablist"
        aria-label={locale === "en" ? "Input source mode" : "Chọn cách nhập nguồn"}
        className="inline-flex rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={inputMode === "library"}
          onClick={() => onChangeInputMode("library")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
            inputMode === "library"
              ? "bg-white text-[#0D1321] shadow-xs"
              : "text-[#505A6E] hover:text-[#0D1321]",
          )}
        >
          <FolderOpen aria-hidden="true" className="size-3.5" />
          <span>
            {locale === "en"
              ? `Library (${documents.length})`
              : `Từ thư viện (${documents.length})`}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={inputMode === "paste"}
          onClick={() => onChangeInputMode("paste")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
            inputMode === "paste"
              ? "bg-white text-[#0D1321] shadow-xs"
              : "text-[#505A6E] hover:text-[#0D1321]",
          )}
        >
          <ClipboardPaste aria-hidden="true" className="size-3.5" />
          <span>
            {locale === "en" ? "Paste text directly" : "Dán văn bản trực tiếp"}
          </span>
        </button>
      </div>

      {inputMode === "library" ? (
        documents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#0D1321]/16 bg-[#FAF9FB] p-6 text-center">
            <p className="text-sm font-semibold text-[#0D1321]">
              {locale === "en"
                ? "No Ready documents in the library yet"
                : "Chưa có tài liệu Sẵn sàng trong thư viện"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#505A6E]">
              {locale === "en"
                ? "Upload a PDF, DOCX, or Markdown file, or paste text directly to run AI utilities right away."
                : "Hãy tải tệp PDF, DOCX, Markdown lên Thư viện hoặc chuyển sang tab Dán văn bản trực tiếp để xử lý AI ngay."}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link href="/documents" className="glean-btn glean-btn-cobalt glean-btn-sm">
                {locale === "en" ? "Upload document" : "Tải tài liệu lên"}
              </Link>
              <button
                type="button"
                onClick={() => onChangeInputMode("paste")}
                className="glean-btn glean-btn-secondary glean-btn-sm"
              >
                {locale === "en" ? "Paste text instead" : "Dán văn bản ngay"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-[#0D1321]/10 bg-[#FAF9FB] p-3.5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#505A6E]"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    locale === "en" ? "Filter Ready documents..." : "Lọc tài liệu Sẵn sàng..."
                  }
                  className="h-9 w-full rounded-xl border border-[#0D1321]/12 bg-white pl-9 pr-3 text-xs text-[#0D1321] outline-none focus:border-[#1B44FF]"
                />
              </label>

              <select
                aria-label={locale === "en" ? "Filter by space" : "Lọc theo không gian"}
                value={spaceFilter}
                onChange={(e) => setSpaceFilter(e.target.value)}
                className="h-9 rounded-xl border border-[#0D1321]/12 bg-white px-3 text-xs font-medium text-[#0D1321] outline-none focus:border-[#1B44FF]"
              >
                <option value="all">
                  {locale === "en" ? "All spaces" : "Tất cả không gian"}
                </option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#505A6E]">
              <span>
                {locale === "en"
                  ? `Selected ${selectedDocIds.length}/5 source documents`
                  : `Đã chọn ${selectedDocIds.length}/5 tài liệu nguồn`}
              </span>
              {selectedDocIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChangeDocIds([])}
                  className="font-semibold text-[#1635C7] hover:underline"
                >
                  {locale === "en" ? "Clear selection" : "Bỏ chọn hết"}
                </button>
              ) : null}
            </div>

            <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
              {filteredDocs.map((doc) => {
                const checked = selectedDocIds.includes(doc.id);
                const disabled = !checked && selectedDocIds.length >= 5;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={checked}
                      onClick={() => toggleDocument(doc.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        checked
                          ? "border-[#1B44FF] bg-[#EEF1FF]/70"
                          : "border-[#0D1321]/10 bg-white hover:border-[#C8D2FF]",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-md border",
                          checked
                            ? "border-[#1B44FF] bg-[#1B44FF] text-white"
                            : "border-[#0D1321]/20 bg-white",
                        )}
                      >
                        {checked ? <Check className="size-3.5" /> : null}
                      </span>
                      <FileText
                        aria-hidden="true"
                        className="size-4 shrink-0 text-[#505A6E]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-[#0D1321]">
                          {doc.name}
                        </span>
                        <span className="block truncate text-[11px] text-[#505A6E]">
                          {doc.space.name} ·{" "}
                          {locale === "en"
                            ? `${doc.chunkCount ?? 1} segments`
                            : `${doc.chunkCount ?? 1} đoạn tri thức`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : (
        <div className="space-y-2.5 rounded-2xl border border-[#0D1321]/10 bg-[#FAF9FB] p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={pastedTitle}
              onChange={(e) => onChangePastedTitle(e.target.value)}
              placeholder={
                locale === "en"
                  ? "Source label (optional, e.g., Meeting notes Q4)"
                  : "Nhãn nguồn (tuỳ chọn, ví dụ: Biên bản họp Q4)"
              }
              className="h-9 flex-1 rounded-xl border border-[#0D1321]/12 bg-white px-3 text-xs font-medium text-[#0D1321] outline-none placeholder:text-[#505A6E] focus:border-[#1B44FF]"
            />
            {pastedText.length > 0 ? (
              <button
                type="button"
                onClick={() => onChangePastedText("")}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#0D1321]/12 bg-white px-3 text-xs font-semibold text-[#505A6E] hover:text-[#B32018]"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                <span>{locale === "en" ? "Clear" : "Xóa nhanh"}</span>
              </button>
            ) : null}
          </div>

          <textarea
            value={pastedText}
            onChange={(e) => onChangePastedText(e.target.value)}
            rows={6}
            placeholder={
              locale === "en"
                ? "Paste meeting notes, SOP draft, policy text, or customer email here..."
                : "Dán nội dung biên bản, dự thảo quy trình, thông báo nội bộ hoặc ghi chú cần AI xử lý tại đây..."
            }
            className="w-full resize-y rounded-xl border border-[#0D1321]/12 bg-white p-3 text-sm leading-6 text-[#0D1321] outline-none placeholder:text-[#505A6E] focus:border-[#1B44FF] focus:ring-2 focus:ring-[#1B44FF]/15"
          />

          <div className="flex items-center justify-between text-[11px] text-[#505A6E]">
            <span>
              {pastedText.trim().length < 15
                ? locale === "en"
                  ? "Enter at least 15 characters to run AI."
                  : "Nhập tối thiểu 15 ký tự để chạy xử lý AI."
                : locale === "en"
                  ? "Ready to process with AI."
                  : "Sẵn sàng xử lý bằng AI."}
            </span>
            <span className="glean-tabular">
              {pastedText.length.toLocaleString()} / 15.000
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
