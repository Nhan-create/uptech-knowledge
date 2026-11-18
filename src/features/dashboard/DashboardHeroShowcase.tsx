"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Search, Sparkles } from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import type {
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import {
  buildDashboardChatHref,
  buildDashboardSearchHref,
  DASHBOARD_HERO_PRESETS,
  findHeroMatchingDocuments,
} from "./hero-matching";

const HERO_COPY = {
  vi: {
    sectionLabel: "Thanh hỏi đáp nhanh và lọc nguồn Sẵn sàng",
    modeGroupLabel: "Chế độ truy vấn",
    modeAi: "Hỏi Trợ lý AI",
    modeSearch: "Tìm tài liệu",
    scopeLabel: "Phạm vi tìm kiếm",
    allSpaces: "Toàn bộ không gian",
    inputLabel: "Câu hỏi hoặc từ khóa tìm kiếm",
    inputPlaceholder: "Nhập câu hỏi cho Trợ lý AI hoặc từ khóa tìm tài liệu…",
    submitAi: "Hỏi ngay",
    submitSearch: "Tìm trong kho",
    emptyQueryError: "Vui lòng nhập câu hỏi hoặc từ khóa trước khi tiếp tục.",
    previewHeading: (scopeName: string) => `Nguồn Sẵn sàng khớp truy vấn · ${scopeName}`,
    openChat: "Mở thành phiên chat",
    openSearch: "Mở trang tìm kiếm",
    matchedPrefix: "Trong phạm vi",
    matchedMiddle: "tìm thấy",
    matchedCount: (count: number) => `${count} tài liệu Sẵn sàng`,
    matchedNotable: "khớp truy vấn — nguồn chính:",
    matchedSuffix: "Bấm vào thẻ tài liệu để mở ngăn xem nhanh.",
    noReadyInScope: (scopeName: string, nonReadyCount: number) =>
      `Phạm vi ${scopeName} hiện chưa có tài liệu Sẵn sàng${
        nonReadyCount > 0
          ? ` (${nonReadyCount} tài liệu đang xử lý/OCR bị loại khỏi nguồn trả lời AI theo quy tắc Ready-Only)`
          : ""
      }.`,
    noMatchForQuery: (scopeName: string) =>
      `Chưa có tài liệu Sẵn sàng nào khớp với truy vấn này trong phạm vi ${scopeName}.`,
    inspectSpace: (scopeName: string) => `Xem tệp trong ${scopeName}`,
    resetScope: "Đổi về Toàn bộ không gian",
    tryDefaultPreset: "Dùng câu hỏi mẫu",
  },
  en: {
    sectionLabel: "Quick Ask AI and Ready-only source filter",
    modeGroupLabel: "Query mode",
    modeAi: "Ask AI Assistant",
    modeSearch: "Search documents",
    scopeLabel: "Search scope",
    allSpaces: "All spaces",
    inputLabel: "Question or search keywords",
    inputPlaceholder: "Ask the AI Assistant or enter keywords to search…",
    submitAi: "Ask AI",
    submitSearch: "Search library",
    emptyQueryError: "Please enter a question or keyword before continuing.",
    previewHeading: (scopeName: string) => `Matched Ready sources · ${scopeName}`,
    openChat: "Open in AI Chat",
    openSearch: "Open Search view",
    matchedPrefix: "Within",
    matchedMiddle: "matched",
    matchedCount: (count: number) => `${count} Ready document${count === 1 ? "" : "s"}`,
    matchedNotable: "— primary source:",
    matchedSuffix: "Select any card below to inspect details in the preview drawer.",
    noReadyInScope: (scopeName: string, nonReadyCount: number) =>
      `Scope ${scopeName} currently has no Ready documents${
        nonReadyCount > 0
          ? ` (${nonReadyCount} processing/OCR file${nonReadyCount === 1 ? "" : "s"} excluded from AI citations per Ready-Only rules)`
          : ""
      }.`,
    noMatchForQuery: (scopeName: string) =>
      `No Ready documents matched this query in scope ${scopeName}.`,
    inspectSpace: (scopeName: string) => `Inspect files in ${scopeName}`,
    resetScope: "Reset to All spaces",
    tryDefaultPreset: "Load sample query",
  },
} as const;

export function DashboardHeroShowcase({
  spaces,
  documents,
  onSelectDocument,
}: Readonly<{
  spaces: readonly SpaceSummaryView[];
  documents: readonly DocumentSummaryView[];
  onSelectDocument: (doc: DocumentSummaryView) => void;
}>) {
  const router = useRouter();
  const { locale } = usePreferences();
  const copy = HERO_COPY[locale];

  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"ai" | "search">("ai");
  const [scopeId, setScopeId] = useState<string>("all");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    DASHBOARD_HERO_PRESETS[0].id,
  );
  const [customQuery, setCustomQuery] = useState<string>(DASHBOARD_HERO_PRESETS[0][locale]);
  const [queryError, setQueryError] = useState<string | null>(null);

  const activePreset = DASHBOARD_HERO_PRESETS.find((preset) => preset.id === selectedPresetId);
  const query = activePreset ? activePreset[locale] : customQuery;

  const activeScopeName =
    scopeId === "all"
      ? copy.allSpaces
      : spaces.find((space) => space.id === scopeId)?.name ?? copy.allSpaces;

  const { matches, readyCountInScope, nonReadyCountInScope } = findHeroMatchingDocuments(
    documents,
    query,
    scopeId,
  );
  const primaryMatch = matches[0];

  const previewActionHref =
    mode === "search"
      ? buildDashboardSearchHref(query, scopeId)
      : buildDashboardChatHref(query, scopeId, spaces);
  const previewActionLabel = mode === "search" ? copy.openSearch : copy.openChat;

  function handleQueryChange(nextValue: string) {
    setSelectedPresetId(null);
    setCustomQuery(nextValue);
    if (queryError) setQueryError(null);
  }

  function handleSelectPreset(presetId: string, presetText: string) {
    setSelectedPresetId(presetId);
    setCustomQuery(presetText);
    if (queryError) setQueryError(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) {
      setQueryError(copy.emptyQueryError);
      inputRef.current?.focus();
      return;
    }
    setQueryError(null);
    if (mode === "search") {
      router.push(buildDashboardSearchHref(cleaned, scopeId));
      return;
    }
    router.push(buildDashboardChatHref(cleaned, scopeId, spaces));
  }

  return (
    <section
      aria-label={copy.sectionLabel}
      className="rounded-2xl border border-[#0D1321]/10 bg-white shadow-[0_1px_3px_rgba(13,19,33,0.04)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#0D1321]/8 px-4 py-3 sm:px-5">
        <div className="inline-flex items-center gap-1.5" role="group" aria-label={copy.modeGroupLabel}>
          <button
            type="button"
            onClick={() => setMode("ai")}
            aria-pressed={mode === "ai"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              mode === "ai"
                ? "bg-[#EEF1FF] font-semibold text-[#1635C7]"
                : "text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
            }`}
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            <span>{copy.modeAi}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("search")}
            aria-pressed={mode === "search"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
              mode === "search"
                ? "bg-[#EEF1FF] font-semibold text-[#1635C7]"
                : "text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
            }`}
          >
            <Search aria-hidden="true" className="size-3.5" />
            <span>{copy.modeSearch}</span>
          </button>
        </div>

        <label htmlFor="hero-scope-select" className="flex min-w-0 items-center gap-2 text-xs text-[#505A6E]">
          <span className="sr-only">{copy.scopeLabel}</span>
          <select
            id="hero-scope-select"
            name="heroScope"
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            className="h-8 max-w-full rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] px-3 text-xs font-medium text-[#323B4D] focus:border-[#1B44FF] focus:outline-none"
          >
            <option value="all">
              {copy.allSpaces} ({documents.length})
            </option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} ({space.documentCount})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-w-0 p-4 sm:p-5">
        <form
          onSubmit={handleSubmit}
          className={`flex items-center gap-2 rounded-xl border bg-[#FAF9FB] p-1.5 pl-3.5 transition-colors focus-within:border-[#1B44FF] focus-within:bg-white ${
            queryError ? "border-[#B32018]" : "border-[#0D1321]/14"
          }`}
        >
          <input
            ref={inputRef}
            id="hero-ask-input"
            name="heroQuery"
            aria-label={copy.inputLabel}
            aria-invalid={queryError ? true : undefined}
            aria-describedby={queryError ? "hero-ask-error" : undefined}
            type="text"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder={copy.inputPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-[#0D1321] placeholder:text-[#505A6E] focus:outline-none"
          />
          <button
            type="submit"
            className="glean-btn glean-btn-cobalt glean-btn-sm shrink-0"
          >
            <span>{mode === "ai" ? copy.submitAi : copy.submitSearch}</span>
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </button>
        </form>

        {queryError ? (
          <p
            id="hero-ask-error"
            role="alert"
            className="mt-2 px-1 text-xs font-medium text-[#B32018]"
          >
            {queryError}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {DASHBOARD_HERO_PRESETS.map((preset) => {
            const label = preset[locale];
            const selected = query === label;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id, label)}
                aria-pressed={selected}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-left text-xs font-medium transition-colors ${
                  selected
                    ? "border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]"
                    : "border-[#0D1321]/8 bg-[#F3F4F8] text-[#323B4D] hover:border-[#C8D2FF] hover:bg-[#EEF1FF] hover:text-[#1635C7]"
                }`}
              >
                <Sparkles aria-hidden="true" className="size-3 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-[#0D1321]/8 bg-[#F7F8FC] p-3.5 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1635C7]">
              <Sparkles aria-hidden="true" className="size-3.5" />
              <span>{copy.previewHeading(activeScopeName)}</span>
            </span>
            <Link
              href={previewActionHref}
              className="inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-[#1635C7] hover:bg-[#EEF1FF]"
            >
              <span>{previewActionLabel}</span>
              <ArrowRight aria-hidden="true" className="size-3" />
            </Link>
          </div>

          {primaryMatch ? (
            <p className="text-sm leading-relaxed text-[#323B4D]">
              {copy.matchedPrefix}{" "}
              <strong className="text-[#0D1321]">{activeScopeName}</strong>,{" "}
              {copy.matchedMiddle}{" "}
              <strong className="text-[#0D1321]">{copy.matchedCount(matches.length)}</strong>{" "}
              {copy.matchedNotable}{" "}
              <strong className="text-[#0D1321]">{primaryMatch.name}</strong> (
              {primaryMatch.processing.label}){" "}
              <button
                type="button"
                onClick={() => onSelectDocument(primaryMatch)}
                className="glean-cite-chip"
              >
                [1]
              </button>
              . {copy.matchedSuffix}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-[#505A6E]">
                {readyCountInScope === 0
                  ? copy.noReadyInScope(activeScopeName, nonReadyCountInScope)
                  : copy.noMatchForQuery(activeScopeName)}
              </p>
              <div className="flex flex-wrap gap-2">
                {scopeId !== "all" ? (
                  <>
                    <Link
                      href={`/documents/spaces/${scopeId}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#C8D2FF] bg-white px-3 py-1.5 text-xs font-semibold text-[#1635C7] hover:bg-[#EEF1FF]"
                    >
                      <span>{copy.inspectSpace(activeScopeName)}</span>
                      <ArrowRight aria-hidden="true" className="size-3" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setScopeId("all")}
                      className="inline-flex items-center rounded-full border border-[#0D1321]/12 bg-white px-3 py-1.5 text-xs font-medium text-[#323B4D] hover:bg-[#F3F4F8]"
                    >
                      {copy.resetScope}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectPreset(
                        DASHBOARD_HERO_PRESETS[0].id,
                        DASHBOARD_HERO_PRESETS[0][locale],
                      )
                    }
                    className="inline-flex items-center rounded-full border border-[#C8D2FF] bg-white px-3 py-1.5 text-xs font-semibold text-[#1635C7] hover:bg-[#EEF1FF]"
                  >
                    {copy.tryDefaultPreset}
                  </button>
                )}
              </div>
            </div>
          )}

          {matches.length > 0 ? (
            <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
              {matches.map((doc, idx) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="flex min-w-0 items-start gap-2.5 rounded-xl border border-[#0D1321]/10 bg-white p-2.5 text-left transition-all hover:border-[#1B44FF] hover:bg-[#EEF1FF]/45"
                >
                  <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#ECF2FF] text-[#1945C2]">
                    <FileText aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="glean-mono block text-[11px] font-semibold text-[#1635C7]">
                      [{idx + 1}] {doc.fileType.toUpperCase()} · {doc.processing.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-[#0D1321]">
                      {doc.name}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
