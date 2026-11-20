"use client";

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  FileText,
  FileUp,
  Link2,
  MessageSquareText,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";

import { requestPreferencesOpen } from "@/components/preferences/preferences-events";
import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge } from "@/components/ui";
import {
  buildChatTurnResponse,
  CHAT_STARTER_PROMPTS,
  FIXTURE_TO_CONTEXT_SCOPE,
  formatChatTurnForCopy,
  getContextScopeLabel,
  resolveScopeToSpaceId,
  type ChatCitationSource,
  type ChatFixtureScope,
  type ChatTurn,
  type ChatTurnEvidenceState,
  type ContextScopeType,
} from "@/features/chat/chat-engine";
import {
  buildLocalDocumentFromFile,
  TEXT_READABLE_EXTENSIONS,
  validateLocalUploadFile,
  type ParsedLocalFileEntry,
} from "@/features/chat/local-file-ingest";
import {
  deleteChatSession,
  getChatSessionsServerSnapshot,
  getChatSessionsSnapshot,
  saveChatSessions,
  subscribeChatSessions,
  upsertChatSession,
  type ChatSession,
} from "@/features/chat/chat-sessions";
import type {
  DocumentDetailView,
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import { cn } from "@/lib/utils";

export type { ChatFixtureScope };

type RetrievalStage =
  | "idle"
  | "preparing"
  | "retrieving"
  | "generating"
  | "completed";

type RetrievalActiveStage = Exclude<RetrievalStage, "idle" | "completed">;

type CitationPreviewPosition = Readonly<{
  top: number;
  left: number;
  width: number;
}>;

type PendingTurn = Readonly<{
  sessionId: string;
  turnId: string;
  prompt: string;
  scope: ContextScopeType;
  selectedDocumentIds: readonly string[];
  replaceTurnId?: string;
}>;

const CONTEXT_SCOPE_VALUES: readonly ContextScopeType[] = [
  "workspace",
  "space:hr",
  "space:operations",
  "space:atlas",
  "selected-documents",
];

const NEXT_RETRIEVAL_STAGE: Readonly<Partial<Record<RetrievalStage, RetrievalStage>>> = {
  preparing: "retrieving",
  retrieving: "generating",
  generating: "completed",
};

const CHAT_COPY = {
  vi: {
    sidebarHeading: "Lịch sử hội thoại",
    toggleSidebar: "Bật hoặc tắt thanh lịch sử",
    closeSidebar: "Đóng thanh lịch sử",
    newChat: "Đoạn chat mới",
    historyEmpty: "Chưa có cuộc trò chuyện nào được lưu.",
    turnsCount: (count: number) => `${count} lượt`,
    deleteSession: (title: string) => `Xóa hội thoại ${title}`,
    sidebarSettingsLink: "Hiển thị & ngôn ngữ",
    headerNewTitle: "Đoạn chat mới",
    readyBadgeShort: (count: number) => `${count} Sẵn sàng`,
    sourcesButton: (count: number) => (count > 0 ? `Nguồn (${count})` : "Nguồn"),
    welcomeTitle: "Bạn muốn tra cứu gì hôm nay?",
    welcomeSub: (readyCount: number, totalCount: number) =>
      `Đang kết nối ${readyCount}/${totalCount} tài liệu Sẵn sàng · Mọi câu trả lời đều kèm trích dẫn trang gốc.`,
    assistantName: "Trợ lý UPTECH",
    steps: [
      {
        stage: "preparing" as const,
        label: "Xác định phạm vi & tài liệu",
      },
      {
        stage: "retrieving" as const,
        label: "Truy xuất nguồn Sẵn sàng (Ready-Only)",
      },
      {
        stage: "generating" as const,
        label: "Tổng hợp câu trả lời kèm trích dẫn",
      },
    ],
    evidenceLabels: {
      grounded: { label: "Nguồn Sẵn sàng", variant: "success" as const },
      caution: { label: "Nguồn Deprecated", variant: "warning" as const },
      empty: { label: "Chưa có nguồn Sẵn sàng", variant: "danger" as const },
    },
    aiGeneralBadge: { label: "Trả lời AI · Gemini", variant: "info" as const },
    referencesLabel: "Nguồn tham khảo",
    broadenScope: "Thử Toàn workspace",
    openSearch: "Tìm trên /search",
    copyAnswer: "Sao chép",
    copiedAnswer: "Đã sao chép",
    copyFallback: "Đã chuẩn bị nội dung; trình duyệt không cấp quyền clipboard tự động.",
    regenerate: "Tạo lại",
    helpful: "Hữu ích",
    needsWork: "Chưa đúng ý",
    scopeSelectLabel: "Phạm vi nguồn",
    attachedHeading: (count: number) => `Đang đính kèm ${count} nguồn:`,
    removeSourceLabel: (title: string) => `Bỏ nguồn ${title}`,
    attachButtonLabel: "Đính kèm tài liệu",
    attachButtonText: "Đính kèm",
    pickerTitle: "Chọn tài liệu Sẵn sàng làm nguồn",
    pickerDesc: "Chọn tài liệu trong workspace hoặc tải tệp từ thiết bị để AI trích dẫn trực tiếp.",
    pickerUploadCta: "Tải từ thiết bị",
    pickerUploadingCta: "Đang tải & phân tích…",
    pickerUploadHint: "Kéo thả hoặc chọn PDF, DOCX, TXT, MD, CSV, JSON (tối đa 10 MB)",
    pickerUploadUnsupported: (name: string) =>
      `Tệp "${name}" chưa hỗ trợ. Chỉ nhận PDF, DOCX, TXT, MD, CSV, JSON.`,
    pickerUploadTooLarge: (name: string) =>
      `Tệp "${name}" vượt quá giới hạn 10 MB.`,
    pickerUploadFailed: "Không thể tải lên và phân tích tài liệu. Vui lòng thử lại.",
    pickerRemoveLocal: (name: string) => `Xóa tệp ${name} khỏi phiên chat`,
    pickerEmpty: "Không có tài liệu nào trong phạm vi này.",
    pickerDone: "Xong",
    composerLabel: "Nhập câu hỏi cho Trợ lý AI",
    composerPlaceholder: "Hỏi bất kỳ điều gì (kiến thức chung hoặc dữ liệu UPTECH)…",
    composerShortcut: "Enter gửi · Shift+Enter xuống dòng",
    composerFootnote:
      "UPTECH AI · Trò chuyện tự nhiên bằng Gemini AI và tự động trích dẫn tài liệu Sẵn sàng [1]..[N].",
    chatApiError: "Không thể kết nối máy chủ AI lúc này. Vui lòng thử lại.",
    composerEmptyError: "Vui lòng nhập câu hỏi trước khi gửi.",
    composerBusyError: "Đang xử lý câu hỏi hiện tại; vui lòng chờ hoàn tất.",
    sendButtonLabel: "Gửi câu hỏi",
    readerTitle: "Trình đọc nguồn trích dẫn",
    closeReader: "Đóng trình đọc nguồn",
    readerSourcePrefix: "Nguồn",
    readerExcerptContext: "Trích đoạn khớp ngữ cảnh:",
    readerProvenanceNote:
      "Kiểm tra số trang/mục và trạng thái tài liệu trước khi áp dụng.",
    readerOpenDetail: "Mở trang chi tiết tài liệu",
    readerLocalSourceNote: "Tài liệu tải lên từ thiết bị · lưu tạm trong phiên hiện tại",
    readerEmpty: "Chọn trích dẫn [1]..[N] trong câu trả lời để xem đoạn gốc.",
    tooltipTitle: "Tài liệu",
    tooltipVersion: "Phiên bản",
    tooltipLocation: "Vị trí",
    tooltipSpace: "Không gian",
    tooltipStatus: "Trạng thái",
  },
  en: {
    sidebarHeading: "Conversations",
    toggleSidebar: "Toggle conversation history",
    closeSidebar: "Close conversation history",
    newChat: "New chat",
    historyEmpty: "No saved conversations yet.",
    turnsCount: (count: number) => `${count} turn${count === 1 ? "" : "s"}`,
    deleteSession: (title: string) => `Delete conversation ${title}`,
    sidebarSettingsLink: "Display & language",
    headerNewTitle: "New conversation",
    readyBadgeShort: (count: number) => `${count} Ready`,
    sourcesButton: (count: number) => (count > 0 ? `Sources (${count})` : "Sources"),
    welcomeTitle: "What would you like to find today?",
    welcomeSub: (readyCount: number, totalCount: number) =>
      `Connected to ${readyCount}/${totalCount} Ready documents · Answers always cite verifiable source passages.`,
    assistantName: "UPTECH Assistant",
    steps: [
      {
        stage: "preparing" as const,
        label: "Resolving scope & attachments",
      },
      {
        stage: "retrieving" as const,
        label: "Retrieving Ready-Only passages",
      },
      {
        stage: "generating" as const,
        label: "Writing answer with citations",
      },
    ],
    evidenceLabels: {
      grounded: { label: "Ready sources", variant: "success" as const },
      caution: { label: "Deprecated source", variant: "warning" as const },
      empty: { label: "No Ready sources", variant: "danger" as const },
    },
    aiGeneralBadge: { label: "General AI · Gemini", variant: "info" as const },
    referencesLabel: "Sources cited",
    broadenScope: "Try All workspace",
    openSearch: "Search /search",
    copyAnswer: "Copy",
    copiedAnswer: "Copied",
    copyFallback: "Formatted text ready; browser blocked automatic clipboard access.",
    regenerate: "Regenerate",
    helpful: "Helpful",
    needsWork: "Needs work",
    scopeSelectLabel: "Source scope",
    attachedHeading: (count: number) => `Pinned (${count}):`,
    removeSourceLabel: (title: string) => `Remove ${title}`,
    attachButtonLabel: "Attach documents",
    attachButtonText: "Attach",
    pickerTitle: "Pin Ready documents as context",
    pickerDesc: "Select workspace documents or upload files from your device to cite directly.",
    pickerUploadCta: "Upload from device",
    pickerUploadingCta: "Uploading & indexing…",
    pickerUploadHint: "Drop or choose PDF, DOCX, TXT, MD, CSV, JSON (max 10 MB)",
    pickerUploadUnsupported: (name: string) =>
      `"${name}" is not supported. Allowed: PDF, DOCX, TXT, MD, CSV, JSON.`,
    pickerUploadTooLarge: (name: string) => `"${name}" exceeds the 10 MB limit.`,
    pickerUploadFailed: "Failed to upload and index this document. Please try again.",
    pickerRemoveLocal: (name: string) => `Remove ${name} from this chat`,
    pickerEmpty: "No documents available in this scope.",
    pickerDone: "Done",
    composerLabel: "Message AI Assistant",
    composerPlaceholder: "Ask anything (general chat or UPTECH workspace docs)…",
    composerShortcut: "Enter to send · Shift+Enter for new line",
    composerFootnote:
      "UPTECH AI · Conversational Gemini AI with automatic citations [1]..[N] from Ready docs.",
    chatApiError: "Unable to reach the AI backend right now. Please try again.",
    composerEmptyError: "Please enter a question before sending.",
    composerBusyError: "Processing the current message; please wait a moment.",
    sendButtonLabel: "Send question",
    readerTitle: "Source Citation Reader",
    closeReader: "Close source reader",
    readerSourcePrefix: "Source",
    readerExcerptContext: "Matched excerpt:",
    readerProvenanceNote: "Verify location, version, and governance status before applying.",
    readerOpenDetail: "Open document detail page",
    readerLocalSourceNote: "Uploaded from this device · scoped to the current session",
    readerEmpty: "Click any citation [1]..[N] inside a response to read its source passage.",
    tooltipTitle: "Document",
    tooltipVersion: "Version",
    tooltipLocation: "Location",
    tooltipSpace: "Space",
    tooltipStatus: "Status",
  },
} as const;

function isContextScopeType(value: string): value is ContextScopeType {
  return (
    CONTEXT_SCOPE_VALUES.includes(value as ContextScopeType) ||
    /^space:[a-zA-Z0-9_-]{2,80}$/u.test(value)
  );
}

function getCitationPreviewPosition(
  trigger: HTMLButtonElement,
  preview?: HTMLElement | null,
): CitationPreviewPosition {
  const visualViewport = window.visualViewport;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const viewportInset = 16;
  const previewGap = 8;
  const preferredWidth = 320;
  const triggerRect = trigger.getBoundingClientRect();
  const width = Math.min(
    preferredWidth,
    Math.max(1, viewportWidth - viewportInset * 2),
  );
  const minimumLeft = viewportLeft + viewportInset;
  const maximumLeft = Math.max(
    minimumLeft,
    viewportLeft + viewportWidth - width - viewportInset,
  );
  const left = Math.min(
    Math.max(minimumLeft, triggerRect.right - width),
    maximumLeft,
  );
  const previewHeight = preview?.getBoundingClientRect().height ?? 0;
  const availableAbove =
    triggerRect.top - viewportTop - viewportInset - previewGap;
  const availableBelow =
    viewportTop +
    viewportHeight -
    viewportInset -
    triggerRect.bottom -
    previewGap;
  const placeBelow =
    availableBelow >= previewHeight || availableBelow >= availableAbove;
  const desiredTop = placeBelow
    ? triggerRect.bottom + previewGap
    : triggerRect.top - previewGap - previewHeight;
  const minimumTop = viewportTop + viewportInset;
  const maximumTop = Math.max(
    minimumTop,
    viewportTop + viewportHeight - viewportInset - previewHeight,
  );

  return {
    top: Math.min(Math.max(minimumTop, desiredTop), maximumTop),
    left,
    width,
  };
}

function AttachedSources({
  sources,
  onRemove,
  fallbackFocusRef,
  headingText,
  removeLabel,
}: Readonly<{
  sources: readonly DocumentSummaryView[];
  onRemove: (sourceId: string) => void;
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
  headingText: string;
  removeLabel: (title: string) => string;
}>) {
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  function removeSource(sourceId: string, sourceIndex: number) {
    const nextFocusSource = sources[sourceIndex + 1] ?? sources[sourceIndex - 1];
    onRemove(sourceId);

    requestAnimationFrame(() => {
      if (nextFocusSource) {
        removeButtonRefs.current.get(nextFocusSource.id)?.focus();
      } else {
        fallbackFocusRef.current?.focus();
      }
    });
  }

  return (
    <div id="attached-sources-heading" className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold text-[#505A6E]">{headingText}</span>
      {sources.map((source, sourceIndex) => (
        <span
          key={source.id}
          className="inline-flex h-7 max-w-full items-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] pl-2.5 pr-1 text-[#1635C7]"
        >
          <FileText aria-hidden="true" className="size-3 shrink-0 text-[#1945C2]" />
          <span title={source.name} className="ml-1.5 max-w-[160px] truncate text-xs font-semibold">
            {source.name}
          </span>
          <button
            ref={(node) => {
              if (node) {
                removeButtonRefs.current.set(source.id, node);
              } else {
                removeButtonRefs.current.delete(source.id);
              }
            }}
            type="button"
            onClick={() => removeSource(source.id, sourceIndex)}
            aria-label={removeLabel(source.name)}
            className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[#1635C7] hover:bg-[#DCE3FF]"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function SourcePicker({
  sources,
  selectedSources,
  uploadedIds,
  uploadError,
  isUploading,
  onUploadFiles,
  onRemoveUploaded,
  onSelectionChange,
  onClose,
  copy,
}: Readonly<{
  sources: readonly DocumentSummaryView[];
  selectedSources: readonly DocumentSummaryView[];
  uploadedIds: ReadonlySet<string>;
  uploadError: string | null;
  isUploading: boolean;
  onUploadFiles: (files: FileList) => void;
  onRemoveUploaded: (id: string) => void;
  onSelectionChange: (source: DocumentSummaryView, selected: boolean) => void;
  onClose: () => void;
  copy: (typeof CHAT_COPY)[keyof typeof CHAT_COPY];
}>) {
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const firstSelectableIndex = sources.findIndex(
    (source) => source.processing.kind === "ready",
  );

  useEffect(() => {
    (firstCheckboxRef.current ?? doneButtonRef.current)?.focus();
  }, []);

  return (
    <section
      id="chat-source-picker"
      aria-labelledby="chat-source-picker-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute bottom-full left-0 right-0 z-30 mb-2 rounded-2xl border border-[#0D1321]/14 bg-white p-3.5 shadow-[0_18px_40px_-12px_rgba(11,18,32,0.22)] sm:p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="chat-source-picker-heading" className="text-sm font-bold text-[#0D1321]">
            {copy.pickerTitle}
          </h2>
          <p className="mt-0.5 text-xs text-[#505A6E]">{copy.pickerDesc}</p>
        </div>
        <button
          ref={doneButtonRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#0D1321]/12 bg-[#FAF9FB] px-3 text-xs font-semibold text-[#0D1321] hover:bg-[#F3F4F8]"
        >
          {copy.pickerDone}
        </button>
      </div>

      {/* Upload directly from user device */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) {
            onUploadFiles(event.dataTransfer.files);
          }
        }}
        className={cn(
          "mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-dashed px-3 py-2.5 transition-colors",
          isDragging
            ? "border-[#1B44FF] bg-[#EEF1FF]"
            : "border-[#1B44FF]/35 bg-[#F6F8FF]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#1B44FF] shadow-xs">
            <FileUp aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#0D1321]">
              {copy.pickerUploadCta}
            </p>
            <p className="truncate text-[11px] text-[#505A6E]">{copy.pickerUploadHint}</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          id="chat-device-upload-input"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.csv,.json"
          className="sr-only"
          onChange={(event) => {
            if (event.currentTarget.files && event.currentTarget.files.length > 0) {
              onUploadFiles(event.currentTarget.files);
            }
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#1B44FF] px-3 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7] disabled:cursor-wait disabled:opacity-70"
        >
          <FileUp aria-hidden="true" className="size-3.5" />
          <span>{isUploading ? copy.pickerUploadingCta : copy.pickerUploadCta}</span>
        </button>
      </div>

      {uploadError ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] px-3 py-1.5 text-xs font-medium text-[#B91C1C]"
        >
          {uploadError}
        </p>
      ) : null}

      {sources.length > 0 ? (
        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {sources.map((source, sourceIndex) => {
            const selectable = source.processing.kind === "ready";
            const isSelected = selectedSources.some((item) => item.id === source.id);
            const isLocalUploaded = uploadedIds.has(source.id);
            const checkboxId = `chat-source-${source.id}`;

            return (
              <li key={source.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
                    isSelected
                      ? "border-[#1B44FF] bg-[#EEF1FF]"
                      : selectable
                        ? "border-[#0D1321]/10 bg-[#FAF9FB] hover:border-[#C8D2FF] hover:bg-white"
                        : "border-[#0D1321]/6 bg-[#F3F4F8] opacity-70",
                  )}
                >
                  <label
                    htmlFor={checkboxId}
                    aria-disabled={!selectable || undefined}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3",
                      selectable ? "cursor-pointer" : "cursor-not-allowed",
                    )}
                  >
                    <input
                      ref={sourceIndex === firstSelectableIndex ? firstCheckboxRef : undefined}
                      id={checkboxId}
                      type="checkbox"
                      checked={isSelected}
                      disabled={!selectable}
                      onChange={(event) =>
                        onSelectionChange(source, event.currentTarget.checked)
                      }
                      className="size-4 shrink-0 accent-[#1B44FF]"
                    />
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-[#1945C2]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-[#0D1321]">
                        {source.name}
                      </span>
                      <span className="block truncate text-[11px] text-[#505A6E]">
                        {source.space.name} · {source.processing.label}
                      </span>
                    </span>
                  </label>
                  <Badge variant={selectable ? "success" : "warning"} size="sm">
                    {source.fileType.toUpperCase()}
                  </Badge>
                  {isLocalUploaded ? (
                    <button
                      type="button"
                      onClick={() => onRemoveUploaded(source.id)}
                      aria-label={copy.pickerRemoveLocal(source.name)}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[#505A6E] transition-colors hover:bg-white hover:text-[#DC2626]"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-[#0D1321]/16 px-3 py-5 text-center text-xs text-[#505A6E]">
          {copy.pickerEmpty}
        </p>
      )}
    </section>
  );
}

function SourceReaderFooter({
  source,
  openDetailLabel,
  localSourceNote,
}: Readonly<{
  source: ChatCitationSource;
  openDetailLabel: string;
  localSourceNote: string;
}>) {
  return (
    <footer className="border-t border-[#0D1321]/8 bg-white p-3.5">
      {source.isLocalUpload ? (
        <p className="flex items-center justify-center gap-2 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3.5 py-2 text-center text-xs font-medium text-[#1635C7]">
          <FileUp aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{localSourceNote}</span>
        </p>
      ) : (
        <Link
          href={
            source.chunkId
              ? `/documents/${encodeURIComponent(source.id)}?chunk=${encodeURIComponent(source.chunkId)}#chunk-${encodeURIComponent(source.chunkId)}`
              : `/documents/${encodeURIComponent(source.id)}`
          }
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:bg-[#EEF1FF] hover:text-[#1635C7]"
        >
          <Link2 aria-hidden="true" className="size-3.5" />
          {openDetailLabel}
        </Link>
      )}
    </footer>
  );
}

function CitationButton({
  source,
  onOpen,
  copy,
}: Readonly<{
  source: ChatCitationSource;
  onOpen: (number: number, trigger: HTMLButtonElement) => void;
  copy: (typeof CHAT_COPY)[keyof typeof CHAT_COPY];
}>) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] =
    useState<CitationPreviewPosition | null>(null);
  const previewId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);

  function openPreview(trigger: HTMLButtonElement) {
    setPreviewPosition(getCitationPreviewPosition(trigger));
    setIsPreviewOpen(true);
  }

  useLayoutEffect(() => {
    if (isPreviewOpen && triggerRef.current && previewRef.current) {
      setPreviewPosition(
        getCitationPreviewPosition(triggerRef.current, previewRef.current),
      );
    }
  }, [isPreviewOpen]);

  useEffect(() => {
    if (!isPreviewOpen) return;

    function updatePosition() {
      if (triggerRef.current) {
        setPreviewPosition(
          getCitationPreviewPosition(triggerRef.current, previewRef.current),
        );
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPreviewOpen(false);
      }
    }

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("keydown", closeOnEscape);
    visualViewport?.addEventListener("resize", updatePosition);
    visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("keydown", closeOnEscape);
      visualViewport?.removeEventListener("resize", updatePosition);
      visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [isPreviewOpen]);

  return (
    <span
      className="relative mx-0.5 inline-flex align-baseline"
      onMouseEnter={() => {
        if (triggerRef.current) openPreview(triggerRef.current);
      }}
      onMouseLeave={() => {
        if (document.activeElement !== triggerRef.current) {
          setIsPreviewOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            openPreview(event.currentTarget);
          }
        }}
        onBlur={() => setIsPreviewOpen(false)}
        onClick={(event) => onOpen(source.number, event.currentTarget)}
        aria-label={`${copy.readerSourcePrefix} ${source.number}: ${source.title}`}
        aria-describedby={isPreviewOpen ? previewId : undefined}
        className="glean-tabular relative inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-1.5 text-[11px] font-bold text-[#1635C7] transition-colors hover:bg-[#1B44FF] hover:[color:#FFFFFF]"
      >
        {source.number}
      </button>

      {isPreviewOpen && previewPosition ? (
        <span
          ref={previewRef}
          id={previewId}
          role="tooltip"
          style={{
            top: previewPosition.top,
            left: previewPosition.left,
            width: previewPosition.width,
          }}
          className="fixed z-50 rounded-2xl border border-[#0D1321]/12 bg-white p-3.5 text-left text-xs font-normal leading-5 text-[#323B4D] shadow-[0_20px_40px_-10px_rgba(11,18,32,0.22)]"
        >
          <span className="block font-bold text-[#0D1321]">{source.title}</span>
          <span className="mt-1 block text-[11px] text-[#505A6E]">
            {source.knowledgeSpace} · {source.location} · {source.version}
          </span>
          <span className="mt-1.5 block rounded-lg bg-[#F7F8FC] p-2 text-[11px] leading-4 text-[#323B4D]">
            “{source.quote}”
          </span>
        </span>
      ) : null}
    </span>
  );
}

function RetrievalStatusLine({
  stage,
  copy,
}: Readonly<{
  stage: RetrievalActiveStage;
  copy: (typeof CHAT_COPY)[keyof typeof CHAT_COPY];
}>) {
  const activeStepIndex = copy.steps.findIndex((step) => step.stage === stage);

  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]">
        <Sparkles aria-hidden="true" className="size-4 animate-pulse" />
      </span>
      <div className="min-w-0 flex-1 space-y-2 rounded-2xl border border-[#C8D2FF]/80 bg-[#F7F9FF] px-4 py-3">
        {copy.steps.map((step, idx) => {
          const isDone = idx < activeStepIndex;
          const isCurrent = idx === activeStepIndex;
          return (
            <div key={step.stage} className="flex items-center gap-2.5 text-xs">
              <span
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
                  isDone
                    ? "bg-[#E7F7EF] text-[#076944]"
                    : isCurrent
                      ? "bg-[#1B44FF] [color:#FFFFFF]"
                      : "bg-[#E6E9F2] text-[#505A6E]",
                )}
              >
                {isDone ? (
                  <Check aria-hidden="true" className="size-2.5" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span
                className={cn(
                  isCurrent
                    ? "font-semibold text-[#0D1321]"
                    : isDone
                      ? "text-[#076944]"
                      : "text-[#505A6E]",
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

let clientIdSequence = 0;

function createUniqueChatId(prefix: string): string {
  clientIdSequence += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${clientIdSequence}`;
}

export function ChatDemo({
  initialPrompt = "",
  initialScope = "workspace",
  spaces,
  documents,
  readyDetails,
}: Readonly<{
  initialPrompt?: string;
  initialScope?: ChatFixtureScope;
  spaces: readonly SpaceSummaryView[];
  documents: readonly DocumentSummaryView[];
  readyDetails: readonly DocumentDetailView[];
}>) {
  const { locale } = usePreferences();
  const copy = CHAT_COPY[locale];

  const sessions = useSyncExternalStore(
    subscribeChatSessions,
    getChatSessionsSnapshot,
    getChatSessionsServerSnapshot,
  );

  const initialContextScope = FIXTURE_TO_CONTEXT_SCOPE[initialScope];
  const hasInitialPrompt = initialPrompt.trim().length > 0;

  const [sidebarOpenDesktop, setSidebarOpenDesktop] = useState(true);
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ephemeralTurns, setEphemeralTurns] = useState<readonly ChatTurn[]>([]);
  const [contextScope, setContextScope] = useState<ContextScopeType>(initialContextScope);
  const [uploadedEntries, setUploadedEntries] = useState<ParsedLocalFileEntry[]>([]);
  const [removedUploadedIds, setRemovedUploadedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedSources, setSelectedSources] = useState<DocumentSummaryView[]>([]);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activeSourceNumber, setActiveSourceNumber] = useState(1);
  const [draft, setDraft] = useState("");
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [turnStatusNote, setTurnStatusNote] = useState("");
  const [composerHasError, setComposerHasError] = useState(false);
  const [composerMessage, setComposerMessage] = useState<string | null>(null);
  const [retrievalStage, setRetrievalStage] = useState<RetrievalStage>(
    hasInitialPrompt ? "preparing" : "idle",
  );
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(
    hasInitialPrompt
      ? {
          sessionId: `sess-${initialScope}-${initialPrompt.trim().slice(0, 24)}`,
          turnId: "turn-1",
          prompt: initialPrompt.trim(),
          scope: initialContextScope,
          selectedDocumentIds: [],
        }
      : null,
  );

  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sourcePanelRef = useRef<HTMLElement>(null);
  const lastCitationTriggerRef = useRef<HTMLButtonElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const turns = activeSession ? activeSession.turns : ephemeralTurns;

  const activeTurn =
    turns.find((turn) => turn.id === activeTurnId) ?? turns[turns.length - 1] ?? null;
  const activeCitations = activeTurn?.citations ?? [];
  const currentSource =
    activeCitations.find((s) => s.number === activeSourceNumber) ?? activeCitations[0] ?? null;

  const activeRetrievalStep = copy.steps.find((step) => step.stage === retrievalStage);
  const isRetrievalRunning = activeRetrievalStep !== undefined && pendingTurn !== null;

  const uploadedSummaryList = uploadedEntries
    .map((entry) => entry.summary)
    .filter((item) => !removedUploadedIds.has(item.id));
  const seenDocIds = new Set(uploadedSummaryList.map((item) => item.id));
  const serverDocumentsFiltered = documents.filter(
    (doc) => !removedUploadedIds.has(doc.id) && !seenDocIds.has(doc.id),
  );
  const allDocuments = [...uploadedSummaryList, ...serverDocumentsFiltered];
  const uploadedIds = new Set(
    allDocuments
      .filter((doc) => doc.id.startsWith("upload-") || doc.id.startsWith("local-") || seenDocIds.has(doc.id))
      .map((doc) => doc.id),
  );

  const readyDocsCount = allDocuments.filter((d) => d.processing.kind === "ready").length;
  const activeScopeSpaceId = resolveScopeToSpaceId(contextScope);
  const readyInScopeCount =
    contextScope === "selected-documents"
      ? selectedSources.length
      : allDocuments.filter(
          (doc) =>
            doc.processing.kind === "ready" &&
            (activeScopeSpaceId === "all" || doc.space.id === activeScopeSpaceId),
        ).length;

  const sourcePickerSources =
    activeScopeSpaceId === "all"
      ? allDocuments
      : allDocuments.filter(
          (doc) => uploadedIds.has(doc.id) || doc.space.id === activeScopeSpaceId,
        );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/workspace/chat/sessions", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          sessions?: ChatSession[];
        };
        if (data.ok && Array.isArray(data.sessions) && data.sessions.length > 0) {
          saveChatSessions(data.sessions);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!pendingTurn) return;
    if (retrievalStage !== "preparing" && retrievalStage !== "retrieving") return;

    const nextStage = NEXT_RETRIEVAL_STAGE[retrievalStage];
    if (!nextStage || nextStage === "completed") return;

    const timeoutId = window.setTimeout(() => {
      setRetrievalStage(nextStage);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [pendingTurn, retrievalStage]);

  useEffect(() => {
    if (!pendingTurn) return;
    const currentPending = pendingTurn;
    const controller = new AbortController();

    const finishWithTurn = (nextSession: ChatSession, builtTurn: ChatTurn) => {
      upsertChatSession(nextSession);
      setActiveSessionId(nextSession.id);
      setEphemeralTurns(nextSession.turns);
      setActiveTurnId(builtTurn.id);
      setActiveSourceNumber(1);
      setPendingTurn(null);
      setRetrievalStage("completed");
      setComposerMessage(null);

      requestAnimationFrame(() => {
        threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    };

    const existingSession =
      getChatSessionsSnapshot().find((s) => s.id === currentPending.sessionId) ?? null;
    const historyPayload = (existingSession?.turns ?? [])
      .filter((t) => t.id !== currentPending.replaceTurnId)
      .slice(-4)
      .map((t) => ({
        prompt: t.prompt,
        answerSummary: [t.intro, ...t.points.map((p) => p.detail)].filter(Boolean).join(" "),
      }));

    (async () => {
      try {
        const response = await fetch("/api/v1/workspace/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            prompt: currentPending.prompt,
            scope: currentPending.scope,
            selectedDocumentIds: currentPending.selectedDocumentIds,
            sessionId: currentPending.sessionId,
            turnId: currentPending.turnId,
            replaceTurnId: currentPending.replaceTurnId,
            locale,
            history: historyPayload,
            stream: true,
          }),
        });

        const contentType = response.headers.get("content-type") ?? "";
        if (response.ok && contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let finished = false;

          while (!finished) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              let eventName = "message";
              let dataLine = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event:")) {
                  eventName = line.slice(6).trim();
                } else if (line.startsWith("data:")) {
                  dataLine += line.slice(5).trim();
                }
              }
              if (!dataLine) continue;
              try {
                const parsed = JSON.parse(dataLine) as {
                  stage?: RetrievalStage;
                  ok?: boolean;
                  session?: ChatSession;
                  turn?: ChatTurn;
                  error?: { message?: string };
                };
                if (eventName === "stage" && parsed.stage) {
                  setRetrievalStage(parsed.stage);
                } else if (eventName === "done" && parsed.ok && parsed.session && parsed.turn) {
                  finishWithTurn(parsed.session, parsed.turn);
                  finished = true;
                } else if (eventName === "error") {
                  setPendingTurn(null);
                  setRetrievalStage("idle");
                  setComposerMessage(parsed.error?.message ?? copy.chatApiError);
                  setDraft((prev) => prev || currentPending.prompt);
                  finished = true;
                }
              } catch {
                // Ignore malformed SSE chunks
              }
            }
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          session?: ChatSession;
          turn?: ChatTurn;
          error?: { message?: string };
        } | null;

        if (!response.ok || !payload?.ok || !payload.session || !payload.turn) {
          setPendingTurn(null);
          setRetrievalStage("idle");
          setComposerMessage(payload?.error?.message ?? copy.chatApiError);
          setDraft((prev) => prev || currentPending.prompt);
          return;
        }

        finishWithTurn(payload.session, payload.turn);
      } catch (error) {
        if (controller.signal.aborted) return;

        // Pure offline fallback when network is unreachable (e.g. headless unit runner)
        if (error instanceof TypeError) {
          const fallbackDocs = [
            ...uploadedEntries.map((entry) => entry.summary),
            ...documents,
          ];
          const fallbackDetails = [
            ...uploadedEntries.map((entry) => entry.detail),
            ...readyDetails,
          ];
          const fallbackLocalText: Readonly<Record<string, string>> = Object.fromEntries(
            uploadedEntries
              .filter(
                (entry) => typeof entry.rawText === "string" && entry.rawText.trim().length > 0,
              )
              .map((entry) => [entry.summary.id, entry.rawText as string]),
          );
          const builtTurn = buildChatTurnResponse({
            id: currentPending.turnId,
            prompt: currentPending.prompt,
            scope: currentPending.scope,
            selectedDocumentIds: currentPending.selectedDocumentIds,
            documents: fallbackDocs,
            readyDetails: fallbackDetails,
            localTextById: fallbackLocalText,
            spaces,
            locale,
          });
          const baseTurns = existingSession ? existingSession.turns : [];
          const nextTurns = currentPending.replaceTurnId
            ? baseTurns.map((t) => (t.id === currentPending.replaceTurnId ? builtTurn : t))
            : [...baseTurns, builtTurn];
          finishWithTurn(
            {
              id: currentPending.sessionId,
              title: existingSession?.title ?? currentPending.prompt,
              scope: currentPending.scope,
              turns: nextTurns,
            },
            builtTurn,
          );
          return;
        }

        setPendingTurn(null);
        setRetrievalStage("idle");
        setComposerMessage(copy.chatApiError);
        setDraft((prev) => prev || currentPending.prompt);
      }
    })();

    return () => controller.abort();
    // Only restart request when pendingTurn identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTurn]);

  function resizeComposer(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }

  function startQuestion(
    promptText: string,
    overrideScope?: ContextScopeType,
    replaceTurnId?: string,
  ) {
    const cleaned = promptText.trim();
    if (!cleaned) {
      setComposerHasError(true);
      setComposerMessage(copy.composerEmptyError);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (isRetrievalRunning) {
      setComposerMessage(copy.composerBusyError);
      return;
    }

    const targetScope = overrideScope ?? contextScope;
    if (overrideScope && overrideScope !== contextScope) {
      setContextScope(overrideScope);
    }

    const targetSessionId = activeSessionId ?? createUniqueChatId("sess");
    const targetTurnId = replaceTurnId ?? createUniqueChatId("turn");

    setComposerHasError(false);
    setComposerMessage(null);
    setTurnStatusNote("");
    setPendingTurn({
      sessionId: targetSessionId,
      turnId: targetTurnId,
      prompt: cleaned,
      scope: targetScope,
      selectedDocumentIds: selectedSources.map((s) => s.id),
      replaceTurnId,
    });
    setRetrievalStage("preparing");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = draft.trim();
    if (!cleaned) {
      setComposerHasError(true);
      setComposerMessage(copy.composerEmptyError);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (isRetrievalRunning) {
      setComposerMessage(copy.composerBusyError);
      return;
    }
    setDraft("");
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    startQuestion(cleaned);
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function commitSelectedSources(nextSources: DocumentSummaryView[]) {
    setSelectedSources(nextSources);
    if (nextSources.length === 0 && contextScope === "selected-documents") {
      setContextScope("workspace");
    } else if (nextSources.length > 0 && contextScope !== "selected-documents") {
      setContextScope("selected-documents");
    }
  }

  function changeSourceSelection(source: DocumentSummaryView, selected: boolean) {
    const exists = selectedSources.some((item) => item.id === source.id);
    if (selected === exists) return;
    commitSelectedSources(
      selected
        ? [...selectedSources, source]
        : selectedSources.filter((item) => item.id !== source.id),
    );
  }

  async function handleDeviceFileUpload(fileList: FileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setUploadError(null);
    setIsUploading(true);
    const addedEntries: ParsedLocalFileEntry[] = [];
    const errors: string[] = [];

    try {
      for (const file of files) {
        const validationError = validateLocalUploadFile(file.name, file.size);
        if (validationError === "unsupported_type") {
          errors.push(copy.pickerUploadUnsupported(file.name));
          continue;
        }
        if (validationError === "file_too_large") {
          errors.push(copy.pickerUploadTooLarge(file.name));
          continue;
        }

        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const targetSpaceId =
          activeScopeSpaceId !== "all" ? activeScopeSpaceId : (spaces[0]?.id ?? "space-hr");

        try {
          const formData = new FormData();
          formData.set("file", file);
          formData.set("locale", locale);
          formData.set("spaceId", targetSpaceId);

          const res = await fetch("/api/v1/workspace/documents", {
            method: "POST",
            body: formData,
          });
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            document?: DocumentDetailView;
            error?: { message?: string };
          } | null;

          if (res.ok && data?.ok && data.document) {
            const doc = data.document;
            addedEntries.push({
              summary: {
                id: doc.id,
                name: doc.name,
                fileType: doc.fileType,
                versionLabel: doc.versionLabel,
                detail: doc.detail,
                ownerLabel: doc.ownerLabel,
                updatedLabel: doc.updatedLabel,
                space: doc.space,
                processing: doc.processing,
                governance: doc.governance,
              },
              detail: doc,
              rawText:
                doc.preview.kind === "fixture-excerpt" ? doc.preview.excerpt : undefined,
              extension,
            });
            continue;
          }
          errors.push(data?.error?.message ?? copy.pickerUploadFailed);
        } catch (uploadErr) {
          // Offline fallback only when network itself is unavailable
          if (uploadErr instanceof TypeError) {
            let textContent: string | undefined;
            if (TEXT_READABLE_EXTENSIONS.has(extension)) {
              try {
                textContent = await file.text();
              } catch {
                textContent = undefined;
              }
            }
            addedEntries.push(
              buildLocalDocumentFromFile({
                id: createUniqueChatId("local"),
                name: file.name,
                sizeBytes: file.size,
                textContent,
                locale,
              }),
            );
          } else {
            errors.push(copy.pickerUploadFailed);
          }
        }
      }
    } finally {
      setIsUploading(false);
    }

    if (errors.length > 0) {
      setUploadError(errors[0]);
    }

    if (addedEntries.length > 0) {
      setUploadedEntries((prev) => [...addedEntries, ...prev]);
      commitSelectedSources([
        ...selectedSources,
        ...addedEntries.map((entry) => entry.summary),
      ]);
    }
  }

  function handleRemoveUploadedEntry(id: string) {
    setRemovedUploadedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setUploadedEntries((prev) => prev.filter((entry) => entry.summary.id !== id));
    if (selectedSources.some((item) => item.id === id)) {
      commitSelectedSources(selectedSources.filter((item) => item.id !== id));
    }
    if (id.startsWith("upload-")) {
      fetch(`/api/v1/workspace/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  }

  function handleNewChat() {
    setActiveSessionId(null);
    setEphemeralTurns([]);
    setPendingTurn(null);
    setRetrievalStage("idle");
    setActiveTurnId(null);
    setActiveSourceNumber(1);
    setIsSourceOpen(false);
    setCopiedTurnId(null);
    setTurnStatusNote("");
    setComposerHasError(false);
    setComposerMessage(null);
    setSidebarOpenMobile(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleSelectSession(session: ChatSession) {
    setActiveSessionId(session.id);
    setEphemeralTurns(session.turns);
    setContextScope(session.scope);
    setPendingTurn(null);
    setRetrievalStage("idle");
    const lastTurn = session.turns[session.turns.length - 1];
    setActiveTurnId(lastTurn?.id ?? null);
    setActiveSourceNumber(1);
    setIsSourceOpen(false);
    setSidebarOpenMobile(false);
  }

  function handleDeleteSession(sessionId: string) {
    deleteChatSession(sessionId);
    if (activeSessionId === sessionId) {
      handleNewChat();
    }
    fetch(`/api/v1/workspace/chat/sessions?id=${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }

  function openSourceReader(turnId: string, number: number, trigger?: HTMLButtonElement) {
    if (trigger) lastCitationTriggerRef.current = trigger;
    if (typeof window !== "undefined" && window.innerWidth >= 1024 && window.innerWidth < 1400) {
      setSidebarOpenDesktop(false);
    }
    setActiveTurnId(turnId);
    setActiveSourceNumber(number);
    setIsSourceOpen(true);
    requestAnimationFrame(() => sourcePanelRef.current?.focus());
  }

  async function handleCopyTurn(turn: ChatTurn) {
    const formatted = formatChatTurnForCopy(turn, locale);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formatted);
      }
      setCopiedTurnId(turn.id);
      setTurnStatusNote("");
    } catch {
      setCopiedTurnId(turn.id);
      setTurnStatusNote(copy.copyFallback);
    }
  }

  function toggleFeedback(turnId: string, nextValue: "up" | "down") {
    if (!activeSession) return;
    let updatedFeedback: "up" | "down" | null = null;
    const nextTurns = activeSession.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      updatedFeedback = turn.feedback === nextValue ? null : nextValue;
      return { ...turn, feedback: updatedFeedback };
    });
    upsertChatSession({ ...activeSession, turns: nextTurns });
    setEphemeralTurns(nextTurns);
    fetch("/api/v1/workspace/chat/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSession.id,
        turnId,
        feedback: updatedFeedback,
      }),
    }).catch(() => undefined);
  }

  function renderEvidenceBadge(
    state: ChatTurnEvidenceState,
    citationCount: number,
  ) {
    const badgeInfo =
      state === "grounded" && citationCount === 0
        ? copy.aiGeneralBadge
        : copy.evidenceLabels[state];
    return (
      <Badge variant={badgeInfo.variant} size="sm">
        {badgeInfo.label}
      </Badge>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={handleNewChat}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0B1220] px-3 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#192338]"
        >
          <Plus aria-hidden="true" className="size-4" />
          <span>{copy.newChat}</span>
        </button>
      </div>

      <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#505A6E]">
        {copy.sidebarHeading}
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.length > 0 ? (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
                  isActive
                    ? "bg-[#EEF1FF] text-[#1635C7]"
                    : "text-[#323B4D] hover:bg-white hover:text-[#0D1321]",
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectSession(session)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <MessageSquareText aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {session.title}
                    </span>
                    <span className="block text-[10px] opacity-75">
                      {copy.turnsCount(session.turns.length)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSession(session.id)}
                  aria-label={copy.deleteSession(session.title)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[#505A6E] opacity-60 transition-opacity hover:bg-[#FDECEC] hover:text-[#B32018] group-hover:opacity-100"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <p className="px-2 py-4 text-xs leading-5 text-[#505A6E]">
            {copy.historyEmpty}
          </p>
        )}
      </div>

      <div className="border-t border-[#0D1321]/8 p-2.5 text-xs xl:hidden">
        <button
          type="button"
          onClick={(event) => {
            setSidebarOpenMobile(false);
            requestPreferencesOpen(event.currentTarget);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-medium text-[#323B4D] hover:bg-white hover:text-[#1635C7]"
        >
          <Settings2 aria-hidden="true" className="size-3.5 text-[#505A6E]" />
          <span>{copy.sidebarSettingsLink}</span>
        </button>
      </div>
    </div>
  );

  const sourceReaderBody = currentSource ? (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <div className="flex flex-wrap gap-1.5">
        {activeCitations.map((source) => (
          <button
            key={source.number}
            type="button"
            aria-pressed={activeSourceNumber === source.number}
            onClick={() => setActiveSourceNumber(source.number)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
              activeSourceNumber === source.number
                ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                : "border-[#0D1321]/10 bg-white text-[#505A6E] hover:border-[#C8D2FF] hover:text-[#0D1321]",
            )}
          >
            <span className="glean-tabular">[{source.number}]</span>
            <span className="max-w-[140px] truncate">{source.location}</span>
          </button>
        ))}
      </div>

      <article className="mt-3.5 overflow-hidden rounded-2xl border border-[#0D1321]/10 bg-white">
        <div className="flex items-start gap-3 border-b border-[#0D1321]/8 p-3.5">
          <span
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border",
              currentSource.fileType === "pdf"
                ? "border-[#FACACA] bg-[#FDECEC] text-[#B32018]"
                : "border-[#C8D2FF] bg-[#EEF1FF] text-[#1945C2]",
            )}
          >
            <FileText aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-bold leading-5 text-[#0D1321]">
              {currentSource.title}
            </h3>
            <p className="mt-0.5 text-xs text-[#505A6E]">
              {currentSource.version} · {currentSource.location} · {currentSource.updatedLabel}
            </p>
            <p
              className={cn(
                "mt-1 text-xs font-medium",
                currentSource.isDeprecated ? "text-[#924D05]" : "text-[#076944]",
              )}
            >
              {currentSource.statusLabel}
            </p>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1635C7]">
              {currentSource.knowledgeSpace}
            </p>
            <h4 className="mt-0.5 text-sm font-bold text-[#0D1321]">
              {currentSource.heading}
            </h4>
          </div>
          <p className="text-xs font-medium text-[#505A6E]">{copy.readerExcerptContext}</p>
          <blockquote className="rounded-r-xl border-l-4 border-[#1B44FF] bg-[#EEF1FF] px-3.5 py-2.5 text-sm font-medium leading-6 text-[#0D1321]">
            “{currentSource.quote}”
          </blockquote>
          <p className="text-xs leading-5 text-[#505A6E]">{copy.readerProvenanceNote}</p>
        </div>
      </article>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <BookOpen aria-hidden="true" className="size-7 text-[#1945C2]" />
      <p className="mt-3 text-xs leading-6 text-[#505A6E]">{copy.readerEmpty}</p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#0D1321]/10 bg-white shadow-[0_12px_32px_-12px_rgba(11,18,32,0.1)]">
      {/* Desktop Collapsible History Sidebar */}
      {sidebarOpenDesktop ? (
        <aside
          aria-label={copy.sidebarHeading}
          className="hidden w-[224px] shrink-0 border-r border-[#0D1321]/8 bg-[#FAF9FB] lg:flex lg:flex-col 2xl:w-[252px]"
        >
          {sidebarContent}
        </aside>
      ) : null}

      {/* Mobile History Drawer */}
      {sidebarOpenMobile ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label={copy.closeSidebar}
            onClick={() => setSidebarOpenMobile(false)}
            className="fixed inset-0 bg-[#0B1220]/40"
          />
          <aside
            aria-label={copy.sidebarHeading}
            className="relative z-10 flex h-full w-[min(82vw,280px)] flex-col border-r border-[#0D1321]/10 bg-[#FAF9FB] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#0D1321]/8 px-3 py-2.5">
              <span className="text-xs font-bold text-[#0D1321]">{copy.sidebarHeading}</span>
              <button
                type="button"
                onClick={() => setSidebarOpenMobile(false)}
                aria-label={copy.closeSidebar}
                className="inline-flex size-8 items-center justify-center rounded-full text-[#323B4D] hover:bg-white"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {/* Main Centered Chat Area */}
      <section
        id="chat-answer-panel"
        aria-labelledby="chat-answer-heading"
        className="flex min-w-0 flex-1 flex-col bg-white"
      >
        {/* Slim Chat App Topbar */}
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[#0D1321]/8 px-3 sm:h-12 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpenMobile(true)}
              aria-label={copy.toggleSidebar}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321] lg:hidden"
            >
              <PanelLeft aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpenDesktop((open) => !open)}
              aria-label={copy.toggleSidebar}
              aria-expanded={sidebarOpenDesktop}
              className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321] lg:inline-flex"
            >
              <PanelLeft aria-hidden="true" className="size-4" />
            </button>

            <h1
              id="chat-answer-heading"
              className="truncate text-sm font-bold text-[#0D1321]"
            >
              {activeSession?.title ?? pendingTurn?.prompt ?? copy.headerNewTitle}
            </h1>

            <span className="hidden items-center rounded-full bg-[#E7F7EF] px-2.5 py-0.5 text-[11px] font-semibold text-[#076944] sm:inline-flex">
              {copy.readyBadgeShort(readyInScopeCount)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {activeCitations.length > 0 ? (
              <button
                type="button"
                onClick={() => setIsSourceOpen((open) => !open)}
                aria-pressed={isSourceOpen}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
                  isSourceOpen
                    ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                    : "border-[#0D1321]/12 bg-white text-[#323B4D] hover:bg-[#F3F4F8]",
                )}
              >
                <BookOpen aria-hidden="true" className="size-3.5" />
                <span>{copy.sourcesButton(activeCitations.length)}</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleNewChat}
              title={copy.newChat}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[#0D1321]/12 bg-white px-2.5 text-xs font-semibold text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">{copy.newChat}</span>
            </button>
          </div>
        </header>

        {/* Scrollable Message Stream */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5"
          aria-busy={isRetrievalRunning}
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
            {turns.length === 0 && !isRetrievalRunning ? (
              <div className="flex flex-1 flex-col justify-center py-2 sm:py-4">
                <div className="mb-4 text-center sm:mb-6">
                  <span className="mx-auto inline-flex size-10 items-center justify-center rounded-2xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF] sm:size-11">
                    <Sparkles aria-hidden="true" className="size-5" />
                  </span>
                  <h2 className="mt-3 text-lg font-bold tracking-[-0.02em] text-[#0D1321] sm:mt-4 sm:text-2xl">
                    {copy.welcomeTitle}
                  </h2>
                  <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-[#505A6E] sm:mt-1.5 sm:text-sm sm:leading-6">
                    {copy.welcomeSub(readyDocsCount, allDocuments.length)}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 sm:gap-2.5">
                  {CHAT_STARTER_PROMPTS.map((starter) => (
                    <button
                      key={starter.id}
                      type="button"
                      onClick={() => startQuestion(starter[locale], starter.scope)}
                      className="group flex items-start justify-between gap-2.5 rounded-2xl border border-[#0D1321]/10 bg-[#FAF9FB] p-3 text-left transition-colors hover:border-[#1B44FF] hover:bg-white sm:gap-3 sm:p-3.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5 text-[#0D1321] group-hover:text-[#1635C7]">
                          {starter[locale]}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-[#505A6E]">
                          {getContextScopeLabel(starter.scope, locale)}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-[#505A6E] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1635C7]"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {turns.map((turn) => {
                  const isCopied = copiedTurnId === turn.id;

                  return (
                    <div key={turn.id} className="space-y-5">
                      {/* User Prompt Bubble */}
                      <div className="flex justify-end">
                        <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-[#0B1220] px-4 py-2.5 text-[15px] leading-6 [color:#FFFFFF]">
                          {turn.prompt}
                        </div>
                      </div>

                      {/* Assistant Editorial Response */}
                      <article className="flex items-start gap-3.5">
                        <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF] sm:inline-flex">
                          <Sparkles aria-hidden="true" className="size-4" />
                        </span>

                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-[#0D1321]">
                              {copy.assistantName}
                            </span>
                            <span className="text-xs text-[#505A6E]">· {turn.scopeLabel}</span>
                            {renderEvidenceBadge(turn.evidenceState, turn.citations.length)}
                          </div>

                          <p className="whitespace-pre-line text-[15px] leading-7 text-[#1F2937]">
                            {turn.intro}
                          </p>

                          {turn.points.length > 0 ? (
                            <ol className="space-y-2.5">
                              {turn.points.map((point, idx) => {
                                const citation = turn.citations.find(
                                  (c) => c.number === point.citationNumber,
                                );
                                return (
                                  <li
                                    key={`${turn.id}-pt-${idx}`}
                                    className="grid grid-cols-[auto_1fr] gap-2.5 text-[15px] leading-7 text-[#1F2937]"
                                  >
                                    <span className="mt-1 inline-flex size-5 items-center justify-center rounded-full bg-[#EEF1FF] text-[11px] font-bold text-[#1635C7]">
                                      {idx + 1}
                                    </span>
                                    <p>
                                      <strong className="font-semibold text-[#0D1321]">
                                        {point.heading}:
                                      </strong>{" "}
                                      {point.detail}
                                      {citation ? (
                                        <CitationButton
                                          source={citation}
                                          onOpen={(num, trigger) =>
                                            openSourceReader(turn.id, num, trigger)
                                          }
                                          copy={copy}
                                        />
                                      ) : null}
                                    </p>
                                  </li>
                                );
                              })}
                            </ol>
                          ) : turn.evidenceState === "empty" ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {turn.scope !== "workspace" ? (
                                <button
                                  type="button"
                                  onClick={() => startQuestion(turn.prompt, "workspace")}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3 text-xs font-semibold text-[#1635C7] hover:bg-[#DCE3FF]"
                                >
                                  {copy.broadenScope}
                                </button>
                              ) : null}
                              <Link
                                href={`/search?q=${encodeURIComponent(turn.prompt)}`}
                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-xs font-semibold text-[#323B4D] hover:bg-[#F3F4F8]"
                              >
                                <Search aria-hidden="true" className="size-3.5" />
                                {copy.openSearch}
                              </Link>
                            </div>
                          ) : null}

                          {/* Compact Clickable Citations Strip */}
                          {turn.citations.length > 0 ? (
                            <div className="pt-1">
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#505A6E]">
                                {copy.referencesLabel}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {turn.citations.map((c) => (
                                  <button
                                    key={`${c.id}-${c.number}`}
                                    type="button"
                                    onClick={(e) =>
                                      openSourceReader(turn.id, c.number, e.currentTarget)
                                    }
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-[#0D1321]/10 bg-[#FAF9FB] px-2.5 py-1.5 text-left text-xs transition-colors hover:border-[#1B44FF] hover:bg-[#EEF1FF]/60"
                                  >
                                    <span className="glean-tabular font-bold text-[#1635C7]">
                                      [{c.number}]
                                    </span>
                                    <span className="max-w-[190px] truncate font-semibold text-[#0D1321]">
                                      {c.title}
                                    </span>
                                    <span className="text-[11px] text-[#505A6E]">
                                      · {c.location}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <p className="text-xs leading-5 text-[#505A6E]">{turn.footnote}</p>

                          {/* Action Bar */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => void handleCopyTurn(turn)}
                              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#505A6E] transition-colors hover:bg-[#F3F4F8] hover:text-[#0D1321]"
                            >
                              {isCopied ? (
                                <Check aria-hidden="true" className="size-3.5 text-[#076944]" />
                              ) : (
                                <Copy aria-hidden="true" className="size-3.5" />
                              )}
                              <span>{isCopied ? copy.copiedAnswer : copy.copyAnswer}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                startQuestion(turn.prompt, turn.scope, turn.id)
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#505A6E] transition-colors hover:bg-[#F3F4F8] hover:text-[#0D1321]"
                            >
                              <RefreshCw aria-hidden="true" className="size-3.5" />
                              <span>{copy.regenerate}</span>
                            </button>

                            <button
                              type="button"
                              aria-pressed={turn.feedback === "up"}
                              onClick={() => toggleFeedback(turn.id, "up")}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors",
                                turn.feedback === "up"
                                  ? "bg-[#E7F7EF] text-[#076944]"
                                  : "text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]",
                              )}
                            >
                              <ThumbsUp aria-hidden="true" className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">{copy.helpful}</span>
                            </button>

                            <button
                              type="button"
                              aria-pressed={turn.feedback === "down"}
                              onClick={() => toggleFeedback(turn.id, "down")}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors",
                                turn.feedback === "down"
                                  ? "bg-[#FDECEC] text-[#B32018]"
                                  : "text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]",
                              )}
                            >
                              <ThumbsDown aria-hidden="true" className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">{copy.needsWork}</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })}

                {isRetrievalRunning && pendingTurn ? (
                  <div className="space-y-5">
                    {!pendingTurn.replaceTurnId ? (
                      <div className="flex justify-end">
                        <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-[#0B1220] px-4 py-2.5 text-[15px] leading-6 [color:#FFFFFF]">
                          {pendingTurn.prompt}
                        </div>
                      </div>
                    ) : null}
                    <RetrievalStatusLine stage={activeRetrievalStep.stage} copy={copy} />
                  </div>
                ) : null}

                {turnStatusNote ? (
                  <p className="text-xs text-[#505A6E]" aria-live="polite">
                    {turnStatusNote}
                  </p>
                ) : null}
                <div ref={threadEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Pinned Bottom ChatGPT-style Composer */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[#0D1321]/6 bg-white px-3 pb-2.5 pt-2 sm:px-6 sm:pb-3"
        >
          <div className="relative mx-auto w-full max-w-3xl">
            {isSourcePickerOpen ? (
              <SourcePicker
                sources={sourcePickerSources}
                selectedSources={selectedSources}
                uploadedIds={uploadedIds}
                uploadError={uploadError}
                isUploading={isUploading}
                onUploadFiles={handleDeviceFileUpload}
                onRemoveUploaded={handleRemoveUploadedEntry}
                onSelectionChange={changeSourceSelection}
                onClose={() => {
                  setIsSourcePickerOpen(false);
                  setUploadError(null);
                  requestAnimationFrame(() => attachButtonRef.current?.focus());
                }}
                copy={copy}
              />
            ) : null}

            <div
              className={cn(
                "rounded-3xl border bg-[#FAF9FB] px-3 py-2 transition-colors sm:px-3.5",
                composerHasError
                  ? "border-[#DC2626] bg-white ring-2 ring-[#DC2626]/15"
                  : "border-[#0D1321]/14 focus-within:border-[#1B44FF] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#1B44FF]/15",
              )}
            >
              {selectedSources.length > 0 ? (
                <AttachedSources
                  sources={selectedSources}
                  onRemove={(id) =>
                    commitSelectedSources(selectedSources.filter((item) => item.id !== id))
                  }
                  fallbackFocusRef={attachButtonRef}
                  headingText={copy.attachedHeading(selectedSources.length)}
                  removeLabel={copy.removeSourceLabel}
                />
              ) : null}

              <label htmlFor="chat-composer" className="sr-only">
                {copy.composerLabel}
              </label>
              <textarea
                ref={composerRef}
                id="chat-composer"
                rows={1}
                value={draft}
                onKeyDown={handleComposerKeyDown}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  setDraft(nextDraft);
                  resizeComposer(event.currentTarget);
                  if (composerHasError && nextDraft.trim()) {
                    setComposerHasError(false);
                    setComposerMessage(null);
                  }
                }}
                placeholder={copy.composerPlaceholder}
                className="chat-composer-textarea max-h-36 min-h-7 w-full resize-none bg-transparent text-sm leading-6 text-[#0D1321] outline-none placeholder:text-[#505A6E]"
                aria-describedby="chat-composer-help"
                aria-invalid={composerHasError}
                aria-errormessage={composerHasError ? "chat-composer-help" : undefined}
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#0D1321]/8 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    ref={attachButtonRef}
                    type="button"
                    onClick={() => setIsSourcePickerOpen((open) => !open)}
                    aria-label={copy.attachButtonLabel}
                    aria-expanded={isSourcePickerOpen}
                    aria-controls={isSourcePickerOpen ? "chat-source-picker" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                      isSourcePickerOpen || selectedSources.length > 0
                        ? "border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]"
                        : "border-[#0D1321]/10 bg-white text-[#323B4D] hover:bg-[#F3F4F8]",
                    )}
                  >
                    <Paperclip aria-hidden="true" className="size-3.5" />
                    <span>{copy.attachButtonText}</span>
                    {selectedSources.length > 0 ? (
                      <span className="glean-tabular rounded-full bg-[#1B44FF] px-1.5 text-[10px] font-bold [color:#FFFFFF]">
                        {selectedSources.length}
                      </span>
                    ) : null}
                  </button>

                  <label htmlFor="chat-context-scope" className="sr-only">
                    {copy.scopeSelectLabel}
                  </label>
                  <select
                    id="chat-context-scope"
                    value={contextScope}
                    onChange={(event) => {
                      const nextScope = event.currentTarget.value;
                      if (isContextScopeType(nextScope)) {
                        setContextScope(nextScope);
                      }
                    }}
                    className="h-8 max-w-[165px] rounded-full border border-[#0D1321]/10 bg-white px-2.5 text-xs font-medium text-[#323B4D] outline-none hover:border-[#0D1321]/25 focus-visible:border-[#1B44FF] sm:max-w-[210px]"
                  >
                    {CONTEXT_SCOPE_VALUES.map((scopeVal) => (
                      <option
                        key={scopeVal}
                        value={scopeVal}
                        disabled={
                          scopeVal === "selected-documents" && selectedSources.length === 0
                        }
                      >
                        {getContextScopeLabel(scopeVal, locale, selectedSources.length, spaces)}
                      </option>
                    ))}
                    {spaces
                      .filter(
                        (s) =>
                          s.id !== "spc_8f2a01" &&
                          s.id !== "spc_c14d72" &&
                          s.id !== "spc_6be903",
                      )
                      .map((s) => {
                        const customScope = `space:${s.id}` as ContextScopeType;
                        return (
                          <option key={customScope} value={customScope}>
                            {getContextScopeLabel(
                              customScope,
                              locale,
                              selectedSources.length,
                              spaces,
                            )}
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="hidden text-[11px] text-[#505A6E] sm:inline">
                    {copy.composerShortcut}
                  </span>
                  <button
                    type="submit"
                    disabled={isRetrievalRunning}
                    aria-label={copy.sendButtonLabel}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1B44FF] [color:#FFFFFF] transition-colors hover:bg-[#1436D6] disabled:cursor-not-allowed disabled:bg-[#E6E9F2] disabled:text-[#505A6E]"
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            <p
              id="chat-composer-help"
              role={composerHasError ? "alert" : undefined}
              aria-live="polite"
              aria-atomic="true"
              className={cn(
                "mt-1 text-center text-[11px]",
                composerHasError ? "font-medium text-[#B32018]" : "chat-composer-footnote text-[#505A6E]",
              )}
            >
              {composerMessage ?? copy.composerFootnote}
            </p>
          </div>
        </form>
      </section>

      {/* Right On-Demand Source Citation Reader (Desktop Split / Mobile Drawer) */}
      {isSourceOpen ? (
        <>
          <aside
            ref={sourcePanelRef}
            id="chat-source-panel"
            aria-labelledby="chat-source-heading"
            tabIndex={-1}
            className="hidden w-[336px] shrink-0 flex-col border-l border-[#0D1321]/8 bg-[#FAF9FB] xl:flex 2xl:w-[380px]"
          >
            <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-[#0D1321]/8 bg-white px-4">
              <div className="min-w-0">
                <h2 id="chat-source-heading" className="truncate text-sm font-bold text-[#0D1321]">
                  {copy.readerTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSourceOpen(false);
                  requestAnimationFrame(() => lastCitationTriggerRef.current?.focus());
                }}
                aria-label={copy.closeReader}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[#323B4D] hover:bg-[#F3F4F8]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </header>

            {sourceReaderBody}

            {currentSource ? (
              <SourceReaderFooter
                source={currentSource}
                openDetailLabel={copy.readerOpenDetail}
                localSourceNote={copy.readerLocalSourceNote}
              />
            ) : null}
          </aside>

          <div className="fixed inset-0 z-50 flex justify-end xl:hidden">
            <button
              type="button"
              aria-label={copy.closeReader}
              onClick={() => setIsSourceOpen(false)}
              className="fixed inset-0 bg-[#0B1220]/40"
            />
            <aside
              aria-label={copy.readerTitle}
              className="relative z-10 flex h-full w-[min(92vw,400px)] flex-col border-l border-[#0D1321]/10 bg-[#FAF9FB] shadow-2xl"
            >
              <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-[#0D1321]/8 bg-white px-4">
                <h2 className="truncate text-sm font-bold text-[#0D1321]">{copy.readerTitle}</h2>
                <button
                  type="button"
                  onClick={() => setIsSourceOpen(false)}
                  aria-label={copy.closeReader}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[#323B4D] hover:bg-[#F3F4F8]"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </header>
              {sourceReaderBody}
              {currentSource ? (
                <SourceReaderFooter
                  source={currentSource}
                  openDetailLabel={copy.readerOpenDetail}
                  localSourceNote={copy.readerLocalSourceNote}
                />
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
