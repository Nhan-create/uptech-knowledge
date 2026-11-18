"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, FolderOpen, Search, UserRound, X } from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge } from "@/components/ui";
import type { DocumentSummaryView } from "@/features/knowledge/model";
import { buildDashboardChatHref } from "./hero-matching";

const processingBadgeVariant = {
  ready: "success",
  failed: "danger",
  uploading: "info",
  validating: "warning",
  extracting: "info",
  ocr: "warning",
  indexing: "info",
} as const;

const DRAWER_COPY = {
  vi: {
    closeLabel: "Đóng trình xem nhanh tài liệu",
    spaceLabel: "Không gian",
    ownerLabel: "Phụ trách",
    updatedLabel: "Cập nhật",
    detailHeader: (version: string) => `Chi tiết nguồn · ${version}`,
    notReadyNotice: (statusLabel: string) =>
      `Tài liệu này đang ở trạng thái "${statusLabel}", nên theo quy tắc Ready-Only chưa được đưa vào làm nguồn trích dẫn của Trợ lý AI.`,
    openDetail: "Mở trang chi tiết",
    askAi: "Hỏi AI về tài liệu này",
    findReadyInSpace: (spaceName: string) => `Tìm nguồn Sẵn sàng (${spaceName})`,
    askPrompt: (name: string) => `Tóm tắt và kiểm tra nguồn ${name}`,
  },
  en: {
    closeLabel: "Close document quick preview",
    spaceLabel: "Space",
    ownerLabel: "Owner",
    updatedLabel: "Updated",
    detailHeader: (version: string) => `Source details · ${version}`,
    notReadyNotice: (statusLabel: string) =>
      `This document is currently "${statusLabel}", so Ready-Only rules exclude it from AI Assistant citations until processing completes.`,
    openDetail: "Open detail page",
    askAi: "Ask AI about this document",
    findReadyInSpace: (spaceName: string) => `Find Ready sources (${spaceName})`,
    askPrompt: (name: string) => `Summarize and verify source ${name}`,
  },
} as const;

export function DashboardSourceDrawer({
  document,
  onClose,
}: Readonly<{
  document: DocumentSummaryView | null;
  onClose: () => void;
}>) {
  const { locale } = usePreferences();
  const copy = DRAWER_COPY[locale];
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!document) return;
    const frameId = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [document, onClose]);

  if (!document) return null;

  const isReady = document.processing.kind === "ready";
  const chatHref = buildDashboardChatHref(copy.askPrompt(document.name), document.space.id);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0B1220]/40 backdrop-blur-xs"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-source-drawer-title"
        className="flex h-full w-[min(520px,100vw)] flex-col border-l border-[#0D1321]/10 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#0D1321]/10 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="glean-mono rounded-full bg-[#F3F4F8] px-2.5 py-0.5 text-[11px] font-medium text-[#323B4D]">
                {document.id}
              </span>
              <Badge variant={processingBadgeVariant[document.processing.kind]} size="sm">
                {document.processing.label}
              </Badge>
              <span className="text-xs text-[#505A6E]">{document.space.name}</span>
            </div>
            <h2
              id="dashboard-source-drawer-title"
              className="text-base font-bold leading-snug text-[#0D1321]"
            >
              {document.name}
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={copy.closeLabel}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#0D1321]/10 text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-[#0D1321]/8 bg-[#FAF9FB] p-4 text-xs sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <FolderOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#1945C2]" />
              <div>
                <dt className="text-[#505A6E]">{copy.spaceLabel}</dt>
                <dd className="mt-0.5 font-semibold text-[#0D1321]">{document.space.name}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <UserRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#1945C2]" />
              <div>
                <dt className="text-[#505A6E]">{copy.ownerLabel}</dt>
                <dd className="mt-0.5 font-semibold text-[#0D1321]">{document.ownerLabel}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#1945C2]" />
              <div>
                <dt className="text-[#505A6E]">{copy.updatedLabel}</dt>
                <dd className="glean-tabular mt-0.5 font-semibold text-[#0D1321]">
                  {document.updatedLabel}
                </dd>
              </div>
            </div>
          </dl>

          <div className="space-y-3 rounded-2xl border border-[#0D1321]/10 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1945C2]">
              {copy.detailHeader(document.versionLabel)}
            </p>
            <p className="text-sm leading-7 text-[#323B4D]">
              {document.processing.description}
            </p>
            {document.governance.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {document.governance.map((marker) => (
                  <Badge key={marker.kind} variant={marker.variant} size="sm">
                    {marker.label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          {!isReady ? (
            <div className="rounded-2xl border border-[#F6D59B] bg-[#FFF9EF] px-4 py-3 text-xs leading-relaxed text-[#924D05]">
              {copy.notReadyNotice(document.processing.label)}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#0D1321]/10 bg-[#FAF9FB] px-5 py-3.5">
          <Link
            href={`/documents/${document.id}`}
            onClick={onClose}
            className="glean-btn glean-btn-secondary glean-btn-sm"
          >
            <BookOpen aria-hidden="true" className="size-3.5" />
            {copy.openDetail}
          </Link>

          {isReady ? (
            <Link
              href={chatHref}
              onClick={onClose}
              className="glean-btn glean-btn-cobalt glean-btn-sm"
            >
              {copy.askAi}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : (
            <Link
              href={`/search?space=${encodeURIComponent(document.space.id)}`}
              onClick={onClose}
              className="glean-btn glean-btn-cobalt glean-btn-sm"
            >
              <Search aria-hidden="true" className="size-3.5" />
              {copy.findReadyInSpace(document.space.name)}
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
