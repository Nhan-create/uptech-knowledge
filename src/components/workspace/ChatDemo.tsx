"use client";

import {
  FormEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  FileText,
  Link2,
  MessageSquareText,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

type Panel = "answer" | "source";

type RetrievalStage =
  | "idle"
  | "preparing"
  | "retrieving"
  | "generating"
  | "completed";

type RetrievalActiveStage = Exclude<RetrievalStage, "idle" | "completed">;

type CitationSource = Readonly<{
  id: string;
  number: number;
  title: string;
  version: string;
  location: string;
  quote: string;
  knowledgeSpace: string;
  statusLabel: string;
}>;

type CitationPreviewPosition = Readonly<{
  top: number;
  left: number;
  width: number;
}>;

type ContextScopeType =
  | "workspace"
  | "space:hr"
  | "space:operations"
  | "space:atlas"
  | "selected-documents";

type KnowledgeSpaceScope = Extract<ContextScopeType, `space:${string}`>;

export type ChatFixtureScope = "workspace" | "hr" | "operations" | "atlas";

type ChatSourceFileType = "pdf" | "docx" | "xlsx" | "pptx" | "image";

type ChatSource = Readonly<{
  id: string;
  title: string;
  fileType: ChatSourceFileType;
  spaceId: KnowledgeSpaceScope;
  spaceLabel: string;
  version?: string;
  statusLabel: string;
  selectable: boolean;
}>;

type ContextScopeOption = Readonly<{
  value: ContextScopeType;
  label: string;
  disabled?: boolean;
}>;

const contextScopeOptions: readonly ContextScopeOption[] = [
  { value: "workspace", label: "Toàn workspace" },
  { value: "space:hr", label: "Không gian: Nhân sự" },
  { value: "space:operations", label: "Không gian: Vận hành" },
  { value: "space:atlas", label: "Không gian: Dự án Atlas" },
  {
    value: "selected-documents",
    label: "Chỉ tài liệu đã chọn — chưa có nguồn",
  },
];

const availableChatSources = [
  {
    id: "doc_a91f07",
    title: "Quy định làm việc từ xa 2026.pdf",
    fileType: "pdf",
    spaceId: "space:hr",
    spaceLabel: "Nhân sự",
    version: "Phiên bản mẫu 1.2",
    statusLabel: "Sẵn sàng · Official",
    selectable: true,
  },
  {
    id: "doc_b40c22",
    title: "Cẩm nang quản lý đội nhóm.docx",
    fileType: "docx",
    spaceId: "space:hr",
    spaceLabel: "Nhân sự",
    version: "Phiên bản mẫu 1.1",
    statusLabel: "Sẵn sàng · Verified",
    selectable: true,
  },
  {
    id: "doc_d18e43",
    title: "Sổ tay nhân sự 2026.pdf",
    fileType: "pdf",
    spaceId: "space:hr",
    spaceLabel: "Nhân sự",
    version: "Phiên bản mẫu 1.0",
    statusLabel: "Đang tải lên 24% · chưa sẵn sàng",
    selectable: false,
  },
  {
    id: "doc_f51a26",
    title: "Checklist nghiệm thu nội bộ.docx",
    fileType: "docx",
    spaceId: "space:atlas",
    spaceLabel: "Dự án Atlas",
    version: "Phiên bản mẫu 1.4",
    statusLabel: "Đang xác thực 42% · chưa sẵn sàng",
    selectable: false,
  },
  {
    id: "doc_07ac64",
    title: "Quy trình bàn giao dự án.pdf",
    fileType: "pdf",
    spaceId: "space:atlas",
    spaceLabel: "Dự án Atlas",
    version: "Phiên bản mẫu 2.1",
    statusLabel: "Đang trích xuất 56% · chưa sẵn sàng",
    selectable: false,
  },
  {
    id: "doc_19de58",
    title: "Hướng dẫn vận hành dự án.pdf",
    fileType: "pdf",
    spaceId: "space:atlas",
    spaceLabel: "Dự án Atlas",
    version: "Phiên bản mẫu 3.0",
    statusLabel: "Sẵn sàng · Deprecated",
    selectable: true,
  },
] as const satisfies readonly ChatSource[];

const retrievalSteps = [
  {
    stage: "preparing",
    label: "Chuẩn bị phạm vi nguồn",
    description: "Ghi nhận phạm vi và các nguồn mẫu đã chọn.",
  },
  {
    stage: "retrieving",
    label: "Đối chiếu nguồn mẫu",
    description: "Mô phỏng bước tìm đoạn liên quan trong fixture cục bộ.",
  },
  {
    stage: "generating",
    label: "Soạn câu trả lời có trích dẫn",
    description: "Mô phỏng cách ghép câu trả lời với marker nguồn.",
  },
] as const satisfies readonly Readonly<{
  stage: RetrievalActiveStage;
  label: string;
  description: string;
}>[];

const nextRetrievalStage: Readonly<
  Partial<Record<RetrievalStage, RetrievalStage>>
> = {
  preparing: "retrieving",
  retrieving: "generating",
  generating: "completed",
};

const defaultComposerMessage =
  "Chế độ bản mẫu: câu hỏi sẽ không được gửi đi.";

const runningComposerMessage =
  "Đang mô phỏng cục bộ; câu hỏi và dữ liệu không được gửi tới backend.";

const contextScopeByFixtureScope: Readonly<
  Record<ChatFixtureScope, ContextScopeType>
> = {
  workspace: "workspace",
  hr: "space:hr",
  operations: "space:operations",
  atlas: "space:atlas",
};

const sources = [
  {
    id: "doc_07ac64",
    number: 1,
    title: "Quy trình bàn giao dự án.pdf",
    version: "Phiên bản mẫu 2.1",
    location: "Chưa có vị trí",
    quote:
      "Nội dung chưa sẵn sàng trong fixture vì tài liệu vẫn đang được trích xuất.",
    knowledgeSpace: "Dự án Atlas",
    statusLabel: "Đang trích xuất 56% · chưa sẵn sàng để tìm kiếm",
  },
  {
    id: "doc_f51a26",
    number: 2,
    title: "Checklist nghiệm thu nội bộ.docx",
    version: "Phiên bản mẫu 1.4",
    location: "Chưa có vị trí",
    quote:
      "Nội dung chưa sẵn sàng trong fixture vì tài liệu vẫn đang được xác thực.",
    knowledgeSpace: "Dự án Atlas",
    statusLabel: "Đang xác thực 42% · chưa sẵn sàng để tìm kiếm",
  },
  {
    id: "doc_19de58",
    number: 3,
    title: "Hướng dẫn vận hành dự án.pdf",
    version: "Phiên bản mẫu 3.0",
    location: "Trang mẫu 14",
    quote:
      "Các điểm chưa thống nhất được ghi thành hành động tiếp theo, kèm người phụ trách và thời hạn dự kiến.",
    knowledgeSpace: "Dự án Atlas",
    statusLabel: "Sẵn sàng trong fixture · Deprecated",
  },
] as const satisfies readonly CitationSource[];

function isContextScopeType(value: string): value is ContextScopeType {
  return contextScopeOptions.some((option) => option.value === value);
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

function getContextScopeHelper(
  value: ContextScopeType,
  selectedSourceCount: number,
) {
  if (value === "workspace") {
    return "Phạm vi dự kiến: toàn workspace trong giới hạn quyền truy cập của bạn.";
  }

  if (value === "selected-documents") {
    return `Phạm vi dự kiến: ${selectedSourceCount} tài liệu đã chọn; Chat API chưa áp dụng phạm vi này.`;
  }

  return "Phạm vi dự kiến: không gian tri thức đã chọn trong giới hạn quyền truy cập của bạn.";
}

function ContextScopeSelector({
  value,
  selectedSourceCount,
  onScopeChange,
}: Readonly<{
  value: ContextScopeType;
  selectedSourceCount: number;
  onScopeChange: (scope: ContextScopeType) => void;
}>) {
  const helperText = getContextScopeHelper(value, selectedSourceCount);

  return (
    <div className="mb-3 flex min-w-0 flex-col gap-2.5 2xl:flex-row 2xl:items-end 2xl:justify-between 2xl:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label
            htmlFor="chat-context-scope"
            className="text-xs font-semibold text-slate-200"
          >
            Phạm vi nguồn
          </label>
          <span className="font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300">
            [PROPOSED UI]
          </span>
        </div>
        <p
          id="chat-context-scope-help"
          className="mt-1 text-xs leading-5 text-slate-400"
        >
          {helperText}
        </p>
      </div>

      <select
        id="chat-context-scope"
        value={value}
        onChange={(event) => {
          const nextScope = event.currentTarget.value;

          if (isContextScopeType(nextScope)) {
            onScopeChange(nextScope);
          }
        }}
        aria-describedby="chat-context-scope-help"
        className="h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-slate-200 outline-none transition-colors hover:border-slate-600 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30 sm:text-sm 2xl:w-72 2xl:shrink-0"
      >
        {contextScopeOptions.map((option) => {
          const isSelectedDocuments = option.value === "selected-documents";
          const optionLabel =
            isSelectedDocuments && selectedSourceCount > 0
              ? `Chỉ ${selectedSourceCount} tài liệu đã chọn`
              : option.label;

          return (
            <option
              key={option.value}
              value={option.value}
              disabled={
                option.disabled ||
                (isSelectedDocuments && selectedSourceCount === 0)
              }
            >
              {optionLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function AttachedSources({
  sources,
  onRemove,
  fallbackFocusRef,
}: Readonly<{
  sources: readonly ChatSource[];
  onRemove: (sourceId: string) => void;
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
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
    <section aria-labelledby="attached-sources-heading" className="mb-3 min-w-0">
      <h2
        id="attached-sources-heading"
        aria-live="polite"
        aria-atomic="true"
        className="text-xs font-semibold text-slate-200"
      >
        Nguồn đã chọn · {sources.length}
      </h2>
      <ul className="mt-2 flex min-w-0 flex-wrap gap-2">
        {sources.map((source, sourceIndex) => (
          <li
            key={source.id}
            className="flex h-11 min-w-0 max-w-full items-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200"
          >
            <FileText
              aria-hidden="true"
              className="ml-3 size-4 shrink-0 text-blue-300"
            />
            <span
              title={source.title}
              className="ml-2 min-w-0 truncate text-xs font-medium"
            >
              {source.title}
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
              aria-label={`Bỏ nguồn ${source.title}`}
              className="ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourcePicker({
  sources,
  selectedSources,
  onSelectionChange,
  onClose,
}: Readonly<{
  sources: readonly ChatSource[];
  selectedSources: readonly ChatSource[];
  onSelectionChange: (source: ChatSource, selected: boolean) => void;
  onClose: () => void;
}>) {
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const firstSelectableSourceIndex = sources.findIndex(
    (source) => source.selectable,
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
      className="mb-3 min-w-0 rounded-xl border border-slate-700 bg-slate-950/90 p-3 sm:p-4"
    >
      <div className="min-w-0">
        <h2
          id="chat-source-picker-heading"
          className="text-sm font-semibold text-white"
        >
          Chọn nguồn
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Chỉ hiển thị các tài liệu mẫu trong phạm vi hiện tại.
        </p>
      </div>

      {sources.length ? (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
          {sources.map((source, sourceIndex) => {
            const isSelected = selectedSources.some(
              (selectedSource) => selectedSource.id === source.id,
            );
            const checkboxId = `chat-source-${source.id}`;

            return (
              <li key={source.id}>
                <label
                  htmlFor={checkboxId}
                  aria-disabled={!source.selectable || undefined}
                  className={cn(
                    "flex min-h-14 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    isSelected
                      ? "cursor-pointer border-blue-600 bg-blue-950/55"
                      : source.selectable
                        ? "cursor-pointer border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900"
                        : "cursor-not-allowed border-slate-800 bg-slate-900/35 opacity-75",
                  )}
                >
                  <input
                    ref={
                      sourceIndex === firstSelectableSourceIndex
                        ? firstCheckboxRef
                        : undefined
                    }
                    id={checkboxId}
                    type="checkbox"
                    checked={isSelected}
                    disabled={!source.selectable}
                    onChange={(event) =>
                      onSelectionChange(source, event.currentTarget.checked)
                    }
                    className="mt-1 size-4 shrink-0 accent-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  />
                  <FileText
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-blue-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold leading-5 text-slate-100">
                      {source.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs leading-5 text-slate-400">
                      <Badge variant="neutral" size="sm">
                        {source.fileType.toUpperCase()}
                      </Badge>
                      <span>{source.spaceLabel}</span>
                      {source.version ? <span>· {source.version}</span> : null}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-[11px] leading-4",
                        source.selectable ? "text-slate-400" : "text-amber-300",
                      )}
                    >
                      {source.statusLabel}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-400">
          Không có tài liệu khả dụng trong bản mẫu.
        </p>
      )}

      <div className="mt-3 flex justify-end border-t border-slate-800 pt-3">
        <button
          ref={doneButtonRef}
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Xong
        </button>
      </div>
    </section>
  );
}

function RetrievalProgress({
  stage,
}: Readonly<{
  stage: RetrievalActiveStage;
}>) {
  const activeStepIndex = retrievalSteps.findIndex(
    (step) => step.stage === stage,
  );

  return (
    <section
      aria-labelledby="retrieval-progress-heading"
      className="max-w-3xl rounded-2xl rounded-tl-md border border-blue-800/70 bg-blue-950/35 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-blue-700/70 bg-blue-950 text-blue-300">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h2
            id="retrieval-progress-heading"
            className="text-sm font-semibold text-white"
          >
            Đang chuẩn bị câu trả lời mẫu
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Chuỗi trạng thái chạy cục bộ theo thứ tự cố định; chưa kết nối
            Retrieval/RAG API.
          </p>
          <p className="mt-1 font-data text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-300">
            [PROPOSED UI] · [PROTOTYPE LOCAL STATE] · [SHARED CONTRACT GAP]
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2" aria-label="Tiến trình truy xuất mẫu">
        {retrievalSteps.map((step, stepIndex) => {
          const isCompleted = stepIndex < activeStepIndex;
          const isCurrent = stepIndex === activeStepIndex;
          const statusLabel = isCompleted
            ? "Hoàn tất"
            : isCurrent
              ? "Đang thực hiện"
              : "Chưa bắt đầu";

          return (
            <li
              key={step.stage}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border px-3 py-3",
                isCurrent
                  ? "border-blue-700 bg-blue-950/60"
                  : "border-slate-800 bg-slate-950/45",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 inline-flex size-6 items-center justify-center rounded-full border",
                  isCompleted
                    ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                    : isCurrent
                      ? "border-blue-600 bg-blue-900 text-blue-200"
                      : "border-slate-700 bg-slate-900 text-slate-500",
                )}
              >
                {isCompleted ? (
                  <Check className="size-3.5" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-slate-100">
                    {step.label}
                  </span>
                  <span className="text-xs font-medium text-slate-400">
                    {statusLabel}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  {step.description}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ChatDemo({
  initialPrompt = "",
  initialScope = "workspace",
}: Readonly<{
  initialPrompt?: string;
  initialScope?: ChatFixtureScope;
}>) {
  const hasInitialPrompt = initialPrompt.trim().length > 0;
  const [panel, setPanel] = useState<Panel>("answer");
  const [activeSource, setActiveSource] = useState(1);
  const [contextScope, setContextScope] =
    useState<ContextScopeType>(contextScopeByFixtureScope[initialScope]);
  const [selectedSources, setSelectedSources] = useState<ChatSource[]>([]);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [scopeStatusMessage, setScopeStatusMessage] = useState("");
  const [draft, setDraft] = useState(initialPrompt);
  const [actionMessage, setActionMessage] = useState("");
  const [retrievalStage, setRetrievalStage] =
    useState<RetrievalStage>(hasInitialPrompt ? "preparing" : "idle");
  const answerPanelRef = useRef<HTMLElement>(null);
  const sourcePanelRef = useRef<HTMLElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastCitationTriggerRef = useRef<HTMLButtonElement>(null);
  const [composerHasError, setComposerHasError] = useState(false);
  const [composerMessage, setComposerMessage] = useState(
    hasInitialPrompt ? runningComposerMessage : defaultComposerMessage,
  );

  const currentSource =
    sources.find((source) => source.number === activeSource) ?? sources[0];
  const activeRetrievalStep = retrievalSteps.find(
    (step) => step.stage === retrievalStage,
  );
  const isRetrievalRunning = activeRetrievalStep !== undefined;
  const retrievalAnnouncement =
    retrievalStage === "preparing"
      ? "Đã bắt đầu tiến trình tạo câu trả lời mẫu."
      : retrievalStage === "completed"
        ? "Tiến trình mẫu đã hoàn tất. Câu trả lời minh họa đã sẵn sàng."
        : "";
  const sourcePickerSources =
    contextScope === "space:hr" ||
    contextScope === "space:operations" ||
    contextScope === "space:atlas"
      ? availableChatSources.filter(
          (source) => source.spaceId === contextScope,
        )
      : availableChatSources;

  useEffect(() => {
    const nextStage = nextRetrievalStage[retrievalStage];

    if (!nextStage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRetrievalStage((currentStage) =>
        currentStage === retrievalStage ? nextStage : currentStage,
      );
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [retrievalStage]);

  function changeContextScope(scope: ContextScopeType) {
    setContextScope(scope);
    setScopeStatusMessage("");
  }

  function commitSelectedSources(nextSources: ChatSource[]) {
    setSelectedSources(nextSources);

    if (
      nextSources.length === 0 &&
      contextScope === "selected-documents"
    ) {
      setContextScope("workspace");
      setScopeStatusMessage(
        "Đã chuyển về Toàn workspace vì không còn tài liệu được chọn.",
      );
    } else {
      setScopeStatusMessage("");
    }
  }

  function changeSourceSelection(source: ChatSource, selected: boolean) {
    const isAlreadySelected = selectedSources.some(
      (selectedSource) => selectedSource.id === source.id,
    );

    if (selected === isAlreadySelected) {
      return;
    }

    commitSelectedSources(
      selected
        ? [...selectedSources, source]
        : selectedSources.filter(
            (selectedSource) => selectedSource.id !== source.id,
          ),
    );
  }

  function removeSelectedSource(sourceId: string) {
    commitSelectedSources(
      selectedSources.filter((source) => source.id !== sourceId),
    );
  }

  function closeSourcePicker() {
    setIsSourcePickerOpen(false);
    requestAnimationFrame(() => attachButtonRef.current?.focus());
  }

  function openSource(number: number, trigger: HTMLButtonElement) {
    lastCitationTriggerRef.current = trigger;
    setActiveSource(number);
    setPanel("source");
    requestAnimationFrame(() => sourcePanelRef.current?.focus());
  }

  function showAnswer() {
    setPanel("answer");
    requestAnimationFrame(() => {
      (lastCitationTriggerRef.current ?? answerPanelRef.current)?.focus();
    });
  }

  function submitDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isRetrievalRunning) {
      setComposerMessage(
        "Tiến trình mẫu đang chạy; không tạo thêm một lượt trùng lặp.",
      );
      return;
    }

    if (!draft.trim()) {
      setComposerHasError(true);
      setComposerMessage("Hãy nhập một câu hỏi mẫu trước khi thử gửi.");
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }

    setComposerHasError(false);
    setComposerMessage(runningComposerMessage);
    setRetrievalStage("preparing");
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
      <div
        className="border-b border-slate-800 bg-slate-900/80 p-2 xl:hidden"
        role="group"
        aria-label="Chuyển giữa câu trả lời và nguồn"
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={panel === "answer"}
            aria-controls="chat-answer-panel"
            onClick={() => setPanel("answer")}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              panel === "answer"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
            )}
          >
            <MessageSquareText aria-hidden="true" className="size-4" />
            Câu trả lời
          </button>
          <button
            type="button"
            aria-pressed={panel === "source"}
            aria-controls="chat-source-panel"
            onClick={() => setPanel("source")}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              panel === "source"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
            )}
          >
            <BookOpen aria-hidden="true" className="size-4" />
            Nguồn ({sources.length})
          </button>
        </div>
      </div>

      <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <section
          ref={answerPanelRef}
          id="chat-answer-panel"
          aria-labelledby="chat-answer-heading"
          tabIndex={-1}
          className={cn(
            "min-w-0 flex-col border-slate-800 xl:flex xl:border-r",
            panel === "answer" ? "flex" : "hidden",
          )}
        >
          <header className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-800 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2
                id="chat-answer-heading"
                className="truncate text-sm font-semibold text-white"
              >
                Quy trình bàn giao dự án
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">Hội thoại minh họa</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-800/60 bg-amber-950/50 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              <Sparkles aria-hidden="true" className="size-3" />
              Chưa xác minh
            </span>
          </header>

          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {retrievalAnnouncement}
          </p>

          <div
            className="flex-1 space-y-6 p-4 sm:p-6"
            aria-busy={isRetrievalRunning}
          >
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm leading-6 text-white shadow-lg shadow-blue-950/30">
              Quy trình bàn giao dự án nội bộ gồm những bước nào?
            </div>

            {activeRetrievalStep ? (
              <RetrievalProgress stage={activeRetrievalStep.stage} />
            ) : (
              <>
                {retrievalStage === "completed" ? (
                  <div className="max-w-3xl rounded-xl border border-emerald-800/70 bg-emerald-950/35 p-4 text-sm text-emerald-100">
                    <div className="flex items-start gap-3">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-emerald-300"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold">Tiến trình mẫu đã hoàn tất</p>
                        <p className="mt-1 text-xs leading-5 text-emerald-200/80">
                          Câu trả lời fixture bên dưới chỉ được hiển thị lại ở
                          local UI; chưa có kết quả Retrieval/RAG từ backend.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <article className="max-w-3xl">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <span className="inline-flex size-8 items-center justify-center rounded-lg border border-violet-800/60 bg-violet-950/70 text-violet-300">
                  <Sparkles aria-hidden="true" className="size-4" />
                </span>
                Trả lời mẫu của AI
              </div>
              <div className="rounded-2xl rounded-tl-md border border-slate-800 bg-slate-900/70 p-4 text-sm leading-7 text-slate-300 sm:p-5 sm:text-base">
                <div className="mb-4 rounded-xl border border-amber-800/70 bg-amber-950/35 p-3 text-xs leading-5 text-amber-100">
                  <p className="font-semibold">
                    Trạng thái nguồn chưa đồng nhất · fixture
                  </p>
                  <p className="mt-1 text-amber-200/80">
                    Hai nguồn đầu vẫn đang xử lý và chưa thể dùng để tìm kiếm;
                    backend chưa xác minh mức độ đầy đủ của bằng chứng.
                  </p>
                  <p className="mt-1 font-data text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-300">
                    [PROPOSED UI] · [PROTOTYPE LOCAL STATE] · [SHARED CONTRACT GAP]
                  </p>
                </div>
                <p>
                  Theo các nguồn minh họa, quy trình có thể được tổ chức thành ba
                  chặng để người giao và người nhận cùng kiểm tra:
                </p>
                <ol className="mt-4 space-y-4">
                  <li className="grid grid-cols-[auto_1fr] gap-3">
                    <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-blue-950 text-xs font-bold text-blue-300">
                      1
                    </span>
                    <p>
                      <strong className="font-semibold text-white">Chuẩn bị:</strong>{" "}
                      hoàn thiện biên bản, danh mục tài sản và đầu việc còn mở
                      <CitationButton source={sources[0]} onOpen={openSource} />.
                    </p>
                  </li>
                  <li className="grid grid-cols-[auto_1fr] gap-3">
                    <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-blue-950 text-xs font-bold text-blue-300">
                      2
                    </span>
                    <p>
                      <strong className="font-semibold text-white">Rà soát:</strong>{" "}
                      kiểm tra quyền truy cập, tài liệu hướng dẫn và mốc hỗ trợ
                      <CitationButton source={sources[1]} onOpen={openSource} />.
                    </p>
                  </li>
                  <li className="grid grid-cols-[auto_1fr] gap-3">
                    <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-blue-950 text-xs font-bold text-blue-300">
                      3
                    </span>
                    <p>
                      <strong className="font-semibold text-white">Chốt bàn giao:</strong>{" "}
                      ghi nhận điểm còn mở, người phụ trách và thời hạn dự kiến
                      <CitationButton source={sources[2]} onOpen={openSource} />.
                    </p>
                  </li>
                </ol>
                <div className="mt-5 border-t border-slate-800 pt-4 text-xs leading-5 text-slate-400">
                  Nội dung trên chỉ minh họa cách trình bày câu trả lời có trích dẫn;
                  không phải hướng dẫn vận hành đã được phê duyệt.
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActionMessage(
                      "Đã mô phỏng thao tác sao chép; clipboard không bị thay đổi.",
                    )
                  }
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Copy aria-hidden="true" className="size-3.5" />
                  Sao chép bản mẫu
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActionMessage(
                      "Đã ghi nhận phản hồi trong phiên prototype; không có dữ liệu được gửi.",
                    )
                  }
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Check aria-hidden="true" className="size-3.5" />
                  Hữu ích
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400" aria-live="polite">
                {actionMessage}
              </p>
                </article>
              </>
            )}
          </div>

          <form
            onSubmit={submitDemo}
            className="border-t border-slate-800 bg-slate-900/75 p-3 sm:p-4"
          >
            <ContextScopeSelector
              value={contextScope}
              selectedSourceCount={selectedSources.length}
              onScopeChange={changeContextScope}
            />
            <p
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {scopeStatusMessage}
            </p>
            {selectedSources.length ? (
              <AttachedSources
                sources={selectedSources}
                onRemove={removeSelectedSource}
                fallbackFocusRef={attachButtonRef}
              />
            ) : null}
            {isSourcePickerOpen ? (
              <SourcePicker
                sources={sourcePickerSources}
                selectedSources={selectedSources}
                onSelectionChange={changeSourceSelection}
                onClose={closeSourcePicker}
              />
            ) : null}
            <label htmlFor="chat-composer" className="sr-only">
              Nhập câu hỏi cho bản mẫu
            </label>
            <div
              className={cn(
                "flex items-end gap-2 rounded-xl border bg-slate-950 p-2",
                composerHasError
                  ? "border-rose-600 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500/40"
                  : "border-slate-700 focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600",
              )}
            >
              <button
                ref={attachButtonRef}
                type="button"
                onClick={() => setIsSourcePickerOpen((isOpen) => !isOpen)}
                aria-label="Chọn tài liệu làm nguồn"
                aria-expanded={isSourcePickerOpen}
                aria-controls={
                  isSourcePickerOpen ? "chat-source-picker" : undefined
                }
                className={cn(
                  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  isSourcePickerOpen
                    ? "bg-blue-950/70 text-blue-300"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                )}
              >
                <Paperclip aria-hidden="true" className="size-4" />
              </button>
              <textarea
                ref={composerRef}
                id="chat-composer"
                rows={1}
                value={draft}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  setDraft(nextDraft);

                  if (composerHasError && nextDraft.trim()) {
                    setComposerHasError(false);
                    setComposerMessage(defaultComposerMessage);
                  }
                }}
                placeholder="Hỏi về tài liệu mẫu…"
                className="min-h-11 min-w-0 flex-1 resize-y bg-transparent px-1 py-2.5 text-base leading-6 text-slate-100 outline-none placeholder:text-slate-400 sm:text-sm"
                aria-describedby="chat-composer-help"
                aria-invalid={composerHasError}
                aria-errormessage={
                  composerHasError ? "chat-composer-help" : undefined
                }
              />
              <button
                type="submit"
                disabled={isRetrievalRunning}
                aria-label="Thử gửi câu hỏi trong bản mẫu"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <Send aria-hidden="true" className="size-4" />
              </button>
            </div>
            <p
              id="chat-composer-help"
              aria-live="polite"
              aria-atomic="true"
              className={cn(
                "mt-2 px-1 text-xs leading-5",
                composerHasError ? "text-rose-300" : "text-slate-400",
              )}
            >
              {composerMessage}
            </p>
          </form>
        </section>

        <section
          ref={sourcePanelRef}
          id="chat-source-panel"
          aria-labelledby="chat-source-heading"
          tabIndex={-1}
          className={cn(
            "min-w-0 flex-col bg-slate-900/40 xl:flex",
            panel === "source" ? "flex" : "hidden",
          )}
        >
          <header className="flex min-h-16 items-center gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={showAnswer}
              aria-label="Quay lại câu trả lời"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 xl:hidden"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 id="chat-source-heading" className="text-sm font-semibold text-white">
                Trình đọc nguồn mẫu
              </h2>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                Mở lại cần được kiểm tra quyền trong sản phẩm thật
              </p>
            </div>
            <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs tabular-nums text-slate-300">
              {activeSource}/{sources.length}
            </span>
          </header>

          <div className="flex-1 p-4 sm:p-5">
            <nav aria-label="Danh sách trích dẫn mẫu">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Trích dẫn trong câu trả lời
              </p>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {sources.map((source) => (
                  <button
                    key={source.number}
                    type="button"
                    aria-pressed={activeSource === source.number}
                    onClick={() => setActiveSource(source.number)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      activeSource === source.number
                        ? "border-blue-600 bg-blue-950/55 text-blue-100"
                        : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200",
                    )}
                  >
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-xs font-bold tabular-nums text-blue-300">
                      {source.number}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">
                        Nguồn {source.number}
                      </span>
                      <span className="block truncate text-[11px] opacity-70">
                        {source.location}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </nav>

            <article className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
              <div className="flex items-start gap-3 border-b border-slate-800 p-4">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-rose-900/60 bg-rose-950/50 text-rose-300">
                  <FileText aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold leading-5 text-white">
                    {currentSource.title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {currentSource.version} · {currentSource.location}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-300">
                    {currentSource.statusLabel}
                  </p>
                </div>
              </div>

              <div className="relative min-h-[360px] bg-slate-100 p-5 text-slate-800 sm:p-7">
                <div className="mx-auto max-w-xl rounded-sm bg-white p-6 shadow-xl shadow-slate-950/10 sm:p-8">
                  <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                        Tài liệu minh họa
                      </p>
                      <h3 className="mt-1 text-sm font-bold text-slate-900">
                        Ghi chú bàn giao
                      </h3>
                    </div>
                    <span className="text-xs tabular-nums text-slate-500">
                      {currentSource.location}
                    </span>
                  </div>
                  <p className="text-sm leading-7 text-slate-600">
                    Phần nội dung xung quanh vị trí được trích dẫn sẽ xuất hiện tại
                    đây để người đọc kiểm tra ngữ cảnh.
                  </p>
                  <blockquote className="my-5 border-l-4 border-blue-600 bg-blue-50 px-4 py-3 text-sm font-medium leading-7 text-slate-800">
                    “{currentSource.quote}”
                  </blockquote>
                  <p className="text-sm leading-7 text-slate-600">
                    Trong sản phẩm hoàn chỉnh, trình đọc cần dùng vị trí do nguồn cung
                    cấp và có phương án thay thế rõ ràng khi không có số trang.
                  </p>
                </div>
              </div>
            </article>
          </div>

          <footer className="border-t border-slate-800 p-4">
            <Link
              href={`/documents/${encodeURIComponent(currentSource.id)}`}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-200 transition-colors hover:border-blue-700 hover:bg-blue-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Link2 aria-hidden="true" className="size-4" />
              Mở chi tiết nguồn mẫu
            </Link>
          </footer>
        </section>
      </div>
    </div>
  );
}

function CitationButton({
  source,
  onOpen,
}: Readonly<{
  source: CitationSource;
  onOpen: (number: number, trigger: HTMLButtonElement) => void;
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
    if (!isPreviewOpen) {
      return;
    }

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
      className="relative mx-0.5 inline-flex align-middle"
      onMouseEnter={() => {
        if (triggerRef.current) {
          openPreview(triggerRef.current);
        }
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
        aria-label={`Mở nguồn trích dẫn mẫu số ${source.number}: ${source.title}`}
        aria-describedby={isPreviewOpen ? previewId : undefined}
        className="relative inline-flex size-11 items-center justify-center rounded-lg border border-blue-700 bg-blue-950 text-xs font-bold tabular-nums text-blue-300 transition-colors hover:bg-blue-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
          className="fixed z-50 rounded-xl border border-slate-700 bg-slate-950 p-4 text-left text-xs font-normal leading-5 text-slate-300 shadow-2xl shadow-black/40"
        >
          <span className="block">
            <span className="block font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Title
            </span>
            <span className="mt-0.5 block break-words font-semibold text-white">
              {source.title}
            </span>
          </span>
          <span className="mt-2 block">
            <span className="font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Version
            </span>
            <span className="ml-2 text-slate-200">{source.version}</span>
          </span>
          <span className="mt-2 block">
            <span className="font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Location
            </span>
            <span className="ml-2 text-slate-200">{source.location}</span>
          </span>
          <span className="mt-2 block">
            <span className="font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Knowledge Space
            </span>
            <span className="ml-2 text-slate-200">
              {source.knowledgeSpace}
            </span>
          </span>
          <span className="mt-2 block">
            <span className="block font-data text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Trạng thái fixture
            </span>
            <span className="mt-0.5 block text-amber-300">
              {source.statusLabel}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
