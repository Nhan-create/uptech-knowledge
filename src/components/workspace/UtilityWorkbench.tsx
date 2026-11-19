"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlignLeft,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileChartColumn,
  GitCompareArrows,
  Languages,
  ListChecks,
  Loader2,
  Mail,
  PencilLine,
  Play,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge, Card } from "@/components/ui";
import {
  UtilitySourceConfigurator,
  type UtilityInputMode,
} from "@/components/workspace/UtilitySourceConfigurator";
import { IconTile, type IconTone } from "@/components/workspace/WorkspacePrimitives";
import type { DocumentSummaryView, SpaceSummaryView } from "@/features/knowledge/model";
import { cn } from "@/lib/utils";

type UtilityTaskId = "summary" | "checklist" | "translate" | "report" | "email";

type UtilityToolDef = Readonly<{
  id: UtilityTaskId;
  icon: LucideIcon;
  tone: IconTone;
  vi: { title: string; subtitle: string; badge: string };
  en: { title: string; subtitle: string; badge: string };
}>;

const UTILITY_TOOLS: readonly UtilityToolDef[] = [
  {
    id: "summary",
    icon: AlignLeft,
    tone: "blue",
    vi: {
      title: "Tóm tắt điều hành",
      subtitle: "Cô đọng ý chính, số liệu, SLA & hạn mốc quan trọng.",
      badge: "Nhanh",
    },
    en: {
      title: "Executive Summary",
      subtitle: "Distill key points, metrics, SLAs, and deadlines.",
      badge: "Fast",
    },
  },
  {
    id: "checklist",
    icon: ListChecks,
    tone: "emerald",
    vi: {
      title: "Checklist hành động",
      subtitle: "Chuyển quy trình thành từng đầu việc có thể tick kiểm tra.",
      badge: "Thực thi",
    },
    en: {
      title: "Action Checklist",
      subtitle: "Turn policies into checkable action items.",
      badge: "Tasks",
    },
  },
  {
    id: "translate",
    icon: Languages,
    tone: "violet",
    vi: {
      title: "Dịch thuật chuẩn ngữ cảnh",
      subtitle: "Dịch giữ nguyên thuật ngữ, cấu trúc và số liệu gốc.",
      badge: "Đa ngôn ngữ",
    },
    en: {
      title: "Accurate Translation",
      subtitle: "Preserve domain terminology, structure, and figures.",
      badge: "Multilingual",
    },
  },
  {
    id: "report",
    icon: FileChartColumn,
    tone: "amber",
    vi: {
      title: "Báo cáo phân tích",
      subtitle: "Tạo bản brief 4 phần: Bối cảnh, Phát hiện, Rủi ro & Đề xuất.",
      badge: "Cấu trúc",
    },
    en: {
      title: "Structured Report",
      subtitle: "Context, findings, risks, and concrete recommendations.",
      badge: "Brief",
    },
  },
  {
    id: "email",
    icon: Mail,
    tone: "blue",
    vi: {
      title: "Soạn Email nội bộ",
      subtitle: "Viết email sẵn sàng gửi với tiêu đề và hành động rõ ràng.",
      badge: "Giao tiếp",
    },
    en: {
      title: "Draft Workplace Email",
      subtitle: "Ready-to-edit email with crisp subject and next steps.",
      badge: "Comms",
    },
  },
];

const TARGET_LANGUAGES = [
  "English",
  "Tiếng Việt",
  "日本語 (Japanese)",
  "한국어 (Korean)",
];

const QUICK_INSTRUCTIONS = {
  vi: [
    "Tập trung vào thời hạn, SLA & người phụ trách",
    "Viết ngắn gọn dưới 180 chữ để đọc nhanh",
    "Giọng văn trang trọng gửi Ban quản lý",
  ],
  en: [
    "Focus on deadlines, SLAs & owners",
    "Keep under 180 words for quick scanning",
    "Executive tone for leadership review",
  ],
} as const;

type UtilityApiSuccess = Readonly<{
  ok: true;
  task: UtilityTaskId;
  model: string;
  title: string;
  output: string;
  takeaways: readonly string[];
  sourcesUsed: ReadonlyArray<{
    documentId: string | null;
    title: string;
    spaceName: string | null;
  }>;
  disclaimer: string;
}>;

type UtilityRunHistoryItem = Readonly<{
  id: string;
  task: UtilityTaskId;
  title: string;
  output: string;
  takeaways: readonly string[];
  sourcesUsed: ReadonlyArray<{
    documentId: string | null;
    title: string;
    spaceName: string | null;
  }>;
  model: string;
  createdAt: string;
}>;

type UtilityWorkbenchProps = Readonly<{
  documents: readonly DocumentSummaryView[];
  spaces: readonly SpaceSummaryView[];
}>;

export function UtilityWorkbench({ documents, spaces }: UtilityWorkbenchProps) {
  const { locale } = usePreferences();
  const readyDocuments = documents.filter((doc) => doc.processing.kind === "ready");

  const [activeTool, setActiveTool] = useState<UtilityTaskId>("summary");
  const [inputMode, setInputMode] = useState<UtilityInputMode>(
    readyDocuments.length > 0 ? "library" : "paste",
  );
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(
    readyDocuments[0] ? [readyDocuments[0].id] : [],
  );
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [customInstruction, setCustomInstruction] = useState("");

  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UtilityApiSuccess | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [viewMode, setViewMode] = useState<"rendered" | "edit">("rendered");
  const [copied, setCopied] = useState(false);
  const [checkedLines, setCheckedLines] = useState<Record<number, boolean>>({});
  const [savingCards, setSavingCards] = useState(false);
  const [savedCardsCount, setSavedCardsCount] = useState<number | null>(null);
  const [recentRuns, setRecentRuns] = useState<readonly UtilityRunHistoryItem[]>([]);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/workspace/utility", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { runs?: UtilityRunHistoryItem[] } | null) => {
        if (active && data?.runs) {
          setRecentRuns(data.runs);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const selectedTool =
    UTILITY_TOOLS.find((item) => item.id === activeTool) ?? UTILITY_TOOLS[0];

  const hasValidLibrary =
    inputMode === "library" && selectedDocIds.length > 0;
  const hasValidPaste =
    inputMode === "paste" && pastedText.trim().length >= 15;
  const canRun = (hasValidLibrary || hasValidPaste) && !isRunning;

  async function handleRunUtility() {
    if (!canRun) return;
    setIsRunning(true);
    setErrorMessage(null);
    setSavedCardsCount(null);
    setCheckedLines({});

    try {
      const response = await fetch("/api/v1/workspace/utility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: activeTool,
          documentIds: inputMode === "library" ? selectedDocIds : [],
          pastedTitle: inputMode === "paste" ? pastedTitle : "",
          pastedText: inputMode === "paste" ? pastedText : "",
          targetLanguage: activeTool === "translate" ? targetLanguage : undefined,
          customInstruction: customInstruction.trim() || undefined,
          locale,
        }),
      });
      const payload = (await response.json()) as
        | UtilityApiSuccess
        | { error?: { message?: string } };

      if (!response.ok || !("ok" in payload)) {
        const msg =
          "error" in payload && payload.error?.message
            ? payload.error.message
            : locale === "en"
              ? "Failed to run AI utility."
              : "Không thể chạy tiện ích AI.";
        setErrorMessage(msg);
        return;
      }

      setResult(payload);
      setEditableOutput(payload.output);
      setViewMode("rendered");
      setRecentRuns((prev) => [
        {
          id: `run-${Date.now()}`,
          task: payload.task,
          title: payload.title,
          output: payload.output,
          takeaways: payload.takeaways,
          sourcesUsed: payload.sourcesUsed,
          model: payload.model,
          createdAt: new Date().toISOString(),
        },
        ...prev.slice(0, 19),
      ]);
    } catch {
      setErrorMessage(
        locale === "en"
          ? "Network connection error while calling AI."
          : "Lỗi kết nối mạng khi gọi máy chủ AI.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function handleCopyOutput() {
    if (!editableOutput) return;
    try {
      await navigator.clipboard.writeText(editableOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-HTTPS context
    }
  }

  function handleDownloadMarkdown() {
    if (!editableOutput) return;
    const blob = new Blob([editableOutput], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `uptech-${activeTool}-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveToKnowledgeCard() {
    if (!result || savingCards || savedCardsCount !== null) return;
    setSavingCards(true);
    try {
      const firstDoc =
        inputMode === "library" && selectedDocIds[0]
          ? readyDocuments.find((d) => d.id === selectedDocIds[0])
          : undefined;
      const summaryText =
        result.takeaways.length > 0
          ? result.takeaways.join(" • ")
          : editableOutput.slice(0, 400);

      const response = await fetch("/api/v1/workspace/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          kind: activeTool === "checklist" ? "rule" : "decision",
          title: result.title,
          summary: summaryText,
          rationale:
            locale === "en"
              ? `Saved from AI Utility (${selectedTool.en.title})`
              : `Lưu từ Tiện ích AI (${selectedTool.vi.title})`,
          spaceId: firstDoc?.space.id ?? spaces[0]?.id ?? "spc_8f2a01",
          sourceDocumentId: firstDoc?.id ?? null,
          sourceDocumentName:
            firstDoc?.name ??
            (pastedTitle.trim() || result.sourcesUsed[0]?.title || null),
        }),
      });
      if (response.ok) {
        setSavedCardsCount(1);
      }
    } finally {
      setSavingCards(false);
    }
  }

  function toggleChecklistLine(lineIndex: number) {
    setCheckedLines((prev) => ({
      ...prev,
      [lineIndex]: !prev[lineIndex],
    }));
  }

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.92fr)] xl:items-start">
      {/* Left column: Tool + Source + Options */}
      <section aria-labelledby="utility-tools-heading" className="min-w-0 space-y-6">
        <div>
          <h2 id="utility-tools-heading" className="text-base font-bold text-[#0D1321]">
            {locale === "en" ? "1. Choose AI task" : "1. Chọn tác vụ AI"}
          </h2>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {UTILITY_TOOLS.map((tool) => {
              const selected = activeTool === tool.id;
              const labels = tool[locale];
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setActiveTool(tool.id);
                    setErrorMessage(null);
                  }}
                  className={cn(
                    "group flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-all",
                    selected
                      ? "border-[#1B44FF] bg-[#F4F6FF] shadow-[0_10px_24px_-12px_rgba(27,68,255,0.28)]"
                      : "border-[#0D1321]/10 bg-white hover:border-[#C8D2FF]",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <IconTile icon={tool.icon} tone={tool.tone} className="size-8 rounded-xl" />
                    {selected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#1B44FF] px-2 py-0.5 text-[10px] font-semibold [color:#FFFFFF]">
                        <Check aria-hidden="true" className="size-3" />
                        {locale === "en" ? "Active" : "Đang chọn"}
                      </span>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        {labels.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2.5">
                    <h3 className="text-sm font-bold text-[#0D1321]">{labels.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-[#505A6E]">{labels.subtitle}</p>
                  </div>
                </button>
              );
            })}

            <Link
              href="/documents/compare"
              className="group flex flex-col justify-between rounded-2xl border border-dashed border-[#0D1321]/16 bg-[#FAF9FB] p-3.5 text-left transition-all hover:border-[#1B44FF] hover:bg-[#F4F6FF]"
            >
              <div className="flex items-start justify-between gap-2">
                <IconTile icon={GitCompareArrows} tone="violet" className="size-8 rounded-xl" />
                <Badge variant="info" size="sm">
                  Diff
                </Badge>
              </div>
              <div className="mt-2.5">
                <h3 className="text-sm font-bold text-[#0D1321]">
                  {locale === "en" ? "Compare 2 Documents" : "So sánh 2 tài liệu"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#505A6E]">
                  {locale === "en"
                    ? "Open side-by-side Diff workspace for two Ready versions."
                    : "Đối chiếu điểm thêm, sửa và xóa giữa hai phiên bản."}
                </p>
              </div>
            </Link>
          </div>
        </div>

        {/* Step 2: Source selection */}
        <Card className="p-5">
          <h2 className="text-base font-bold text-[#0D1321]">
            {locale === "en" ? "2. Select input source" : "2. Chọn dữ liệu đầu vào"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#505A6E]">
            {locale === "en"
              ? "Pick 1–5 Ready documents from your workspace or paste raw text directly."
              : "Chọn tối đa 5 tài liệu Sẵn sàng trong Thư viện hoặc dán trực tiếp văn bản bạn cần xử lý."}
          </p>

          <div className="mt-4">
            <UtilitySourceConfigurator
              locale={locale}
              documents={readyDocuments}
              spaces={spaces}
              inputMode={inputMode}
              onChangeInputMode={setInputMode}
              selectedDocIds={selectedDocIds}
              onChangeDocIds={setSelectedDocIds}
              pastedTitle={pastedTitle}
              onChangePastedTitle={setPastedTitle}
              pastedText={pastedText}
              onChangePastedText={setPastedText}
            />
          </div>

          {/* Step 3: Task options */}
          <div className="mt-5 space-y-3 border-t border-[#0D1321]/8 pt-4">
            {activeTool === "translate" ? (
              <div>
                <p className="text-xs font-semibold text-[#323B4D]">
                  {locale === "en" ? "Target language" : "Ngôn ngữ đích"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TARGET_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setTargetLanguage(lang)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        targetLanguage === lang
                          ? "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]"
                          : "border-[#0D1321]/10 bg-white text-[#505A6E] hover:text-[#0D1321]",
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="utility-custom-instruction"
                className="block text-xs font-semibold text-[#323B4D]"
              >
                {locale === "en"
                  ? "Custom instructions (optional)"
                  : "Yêu cầu bổ sung cho AI (tuỳ chọn)"}
              </label>
              <input
                id="utility-custom-instruction"
                type="text"
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                placeholder={
                  locale === "en"
                    ? "E.g., Emphasize compliance risks and highlight owners..."
                    : "Ví dụ: Nhấn mạnh các mốc SLA và trách nhiệm từng phòng ban..."
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/12 bg-white px-3 text-sm text-[#0D1321] outline-none placeholder:text-[#505A6E] focus:border-[#1B44FF]"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_INSTRUCTIONS[locale].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setCustomInstruction(chip)}
                    className="rounded-full bg-[#F3F4F8] px-2.5 py-1 text-[11px] font-medium text-[#505A6E] transition-colors hover:bg-[#EEF1FF] hover:text-[#1635C7]"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {errorMessage ? (
              <p
                role="alert"
                className="rounded-xl border border-[#F5C6C3] bg-[#FFF5F5] px-3.5 py-2.5 text-xs font-medium text-[#B32018]"
              >
                {errorMessage}
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleRunUtility}
              disabled={!canRun}
              className="glean-btn glean-btn-cobalt mt-2 w-full justify-center py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  <span>
                    {locale === "en"
                      ? `Running ${selectedTool.en.title} with AI...`
                      : `Đang chạy ${selectedTool.vi.title} bằng AI...`}
                  </span>
                </>
              ) : (
                <>
                  <Play aria-hidden="true" className="size-4" />
                  <span>
                    {locale === "en"
                      ? `Run ${selectedTool.en.title}`
                      : `Chạy ${selectedTool.vi.title}`}
                  </span>
                </>
              )}
            </button>
          </div>
        </Card>
      </section>

      {/* Right column: Live AI Output Studio */}
      <section aria-labelledby="utility-output-heading" className="min-w-0 xl:sticky xl:top-24">
        <Card className="overflow-hidden border-[#0D1321]/10 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#0D1321]/8 bg-[#FAF9FB] px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#505A6E]">
                {locale === "en" ? "AI Output Canvas" : "Kết quả Tiện ích AI"}
              </p>
              <h2 id="utility-output-heading" className="truncate text-sm font-bold text-[#0D1321]">
                {result ? result.title : selectedTool[locale].title}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              {result ? (
                <Badge variant="success" size="sm">
                  {locale === "en" ? "Completed" : "Hoàn tất"}
                </Badge>
              ) : (
                <Badge variant={isRunning ? "warning" : "neutral"} size="sm">
                  {isRunning
                    ? locale === "en"
                      ? "Processing"
                      : "Đang xử lý"
                    : locale === "en"
                      ? "Ready"
                      : "Sẵn sàng"}
                </Badge>
              )}
            </div>
          </header>

          <div className="p-5">
            {!result ? (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-[#0D1321]/14 bg-[#FAF9FB] px-6 py-12 text-center">
                <IconTile icon={Sparkles} tone="blue" className="size-12" />
                <h3 className="mt-4 text-base font-bold text-[#0D1321]">
                  {locale === "en" ? "Output will appear here" : "Bản kết quả AI sẽ hiển thị tại đây"}
                </h3>
                <p className="mt-1.5 max-w-sm text-xs leading-6 text-[#505A6E]">
                  {locale === "en"
                    ? "Choose a utility on the left, select Ready library documents or paste text, then click Run to generate a grounded result."
                    : "Chọn tác vụ bên trái, chọn tài liệu Thư viện hoặc dán văn bản trực tiếp rồi bấm Chạy để hệ thống AI xử lý dữ liệu thật."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Action Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#0D1321]/8 pb-3">
                  <div className="inline-flex rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("rendered")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                        viewMode === "rendered"
                          ? "bg-white text-[#0D1321] shadow-xs"
                          : "text-[#505A6E]",
                      )}
                    >
                      <Eye aria-hidden="true" className="size-3.5" />
                      <span>{locale === "en" ? "Formatted" : "Xem đẹp"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("edit")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                        viewMode === "edit"
                          ? "bg-white text-[#0D1321] shadow-xs"
                          : "text-[#505A6E]",
                      )}
                    >
                      <PencilLine aria-hidden="true" className="size-3.5" />
                      <span>{locale === "en" ? "Edit" : "Chỉnh sửa"}</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyOutput}
                      className="glean-btn glean-btn-secondary glean-btn-sm"
                    >
                      {copied ? (
                        <Check aria-hidden="true" className="size-3.5 text-[#137333]" />
                      ) : (
                        <Copy aria-hidden="true" className="size-3.5" />
                      )}
                      <span>
                        {copied
                          ? locale === "en"
                            ? "Copied"
                            : "Đã chép"
                          : locale === "en"
                            ? "Copy"
                            : "Sao chép"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="glean-btn glean-btn-secondary glean-btn-sm"
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      <span>.md</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRunUtility}
                      disabled={isRunning}
                      title={locale === "en" ? "Regenerate" : "Tạo lại"}
                      className="glean-btn glean-btn-secondary glean-btn-sm"
                    >
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content body */}
                {viewMode === "edit" ? (
                  <textarea
                    aria-label={locale === "en" ? "Editable AI result" : "Nội dung chỉnh sửa"}
                    value={editableOutput}
                    onChange={(e) => setEditableOutput(e.target.value)}
                    rows={14}
                    className="w-full resize-y rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] p-3.5 text-sm leading-6 text-[#0D1321] outline-none focus:border-[#1B44FF]"
                  />
                ) : (
                  <div className="max-h-[460px] space-y-2 overflow-y-auto rounded-xl border border-[#0D1321]/8 bg-[#FAF9FB] p-4 text-sm leading-6 text-[#1E2534]">
                    {editableOutput.split(/\r?\n/u).map((line, index) => {
                      const trimmed = line.trim();
                      if (!trimmed) return <div key={index} className="h-1.5" />;
                      if (trimmed.startsWith("### ")) {
                        return (
                          <h4 key={index} className="pt-2 text-sm font-bold text-[#0D1321]">
                            {trimmed.slice(4)}
                          </h4>
                        );
                      }
                      if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
                        const headingText = trimmed.replace(/^#+\s*/u, "");
                        return (
                          <h3 key={index} className="pt-2 text-base font-bold text-[#0D1321]">
                            {headingText}
                          </h3>
                        );
                      }
                      const checkboxMatch = trimmed.match(/^(?:-|\*)\s*\[( |x|X)\]\s*(.+)$/u);
                      if (checkboxMatch) {
                        const isChecked =
                          checkedLines[index] ?? checkboxMatch[1]?.toLowerCase() === "x";
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => toggleChecklistLine(index)}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white"
                          >
                            <span
                              className={cn(
                                "mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded border",
                                isChecked
                                  ? "border-[#137333] bg-[#137333] [color:#FFFFFF]"
                                  : "border-[#0D1321]/25 bg-white",
                              )}
                            >
                              {isChecked ? <Check className="size-3" /> : null}
                            </span>
                            <span
                              className={cn(
                                "text-sm leading-6",
                                isChecked && "text-[#505A6E] line-through",
                              )}
                            >
                              {checkboxMatch[2]}
                            </span>
                          </button>
                        );
                      }
                      if (/^(?:-|\*)\s+/u.test(trimmed)) {
                        return (
                          <p key={index} className="flex items-start gap-2 pl-1">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#1B44FF]" />
                            <span>{trimmed.replace(/^(?:-|\*)\s+/u, "")}</span>
                          </p>
                        );
                      }
                      return <p key={index}>{trimmed}</p>;
                    })}
                  </div>
                )}

                {/* Key Takeaways + 1-click Save to Knowledge Card */}
                {result.takeaways.length > 0 ? (
                  <div className="rounded-xl border border-[#C8D2FF] bg-[#F4F6FF] p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#1635C7]">
                        {locale === "en"
                          ? "Key takeaways extracted"
                          : "Điểm cốt lõi rút ra"}
                      </p>
                      {savedCardsCount ? (
                        <Link
                          href="/knowledge"
                          className="inline-flex items-center gap-1 rounded-full bg-[#E6F4EA] px-3 py-1 text-xs font-semibold text-[#137333]"
                        >
                          <CheckCircle2 aria-hidden="true" className="size-3.5" />
                          <span>
                            {locale === "en" ? "Saved to Knowledge Cards →" : "Đã lưu sang Thẻ tri thức →"}
                          </span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSaveToKnowledgeCard}
                          disabled={savingCards}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#0B1220] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#172136] disabled:opacity-50"
                        >
                          <BookmarkPlus aria-hidden="true" className="size-3.5" />
                          <span>
                            {savingCards
                              ? locale === "en"
                                ? "Saving..."
                                : "Đang lưu..."
                              : locale === "en"
                                ? "Save as Knowledge Card"
                                : "Lưu thành Thẻ tri thức"}
                          </span>
                        </button>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-[#323B4D]">
                      {result.takeaways.map((bullet, idx) => (
                        <li key={idx}>• {bullet}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Sources & grounding footer */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#505A6E]">
                  <span className="font-semibold text-[#323B4D]">
                    {locale === "en" ? "Sources used:" : "Nguồn sử dụng:"}
                  </span>
                  {result.sourcesUsed.map((source, i) =>
                    source.documentId ? (
                      <Link
                        key={`${source.documentId}-${i}`}
                        href={`/documents/${source.documentId}`}
                        className="rounded-full border border-[#0D1321]/10 bg-white px-2.5 py-0.5 font-medium text-[#1635C7] hover:underline"
                      >
                        {source.title}
                      </Link>
                    ) : (
                      <span
                        key={i}
                        className="rounded-full border border-[#0D1321]/10 bg-white px-2.5 py-0.5 font-medium"
                      >
                        {source.title}
                      </span>
                    ),
                  )}
                </div>

                <p className="text-[11px] leading-5 text-[#505A6E]">{result.disclaimer}</p>
              </div>
            )}
          </div>
        </Card>
      </section>

      {recentRuns.length > 0 ? (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#111827]">
                {locale === "en" ? "Saved Utility Run History" : "Lịch sử chạy Tiện ích AI gần đây"}
              </h3>
              <p className="text-xs text-[#647084]">
                {locale === "en"
                  ? "Click any past run to reload its output and takeaways."
                  : "Nhấp vào kết quả đã chạy để mở lại nội dung và điểm cốt lõi."}
              </p>
            </div>
            <Badge variant="neutral">{recentRuns.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {recentRuns.slice(0, 6).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTool(item.task);
                  setResult({
                    ok: true,
                    task: item.task,
                    model: item.model,
                    title: item.title,
                    output: item.output,
                    takeaways: item.takeaways,
                    sourcesUsed: item.sourcesUsed,
                    disclaimer:
                      locale === "en"
                        ? "Loaded from saved workspace utility run history."
                        : "Đã nạp lại từ lịch sử chạy Tiện ích AI của không gian làm việc.",
                  });
                  setEditableOutput(item.output);
                  setViewMode("rendered");
                }}
                className="flex flex-col justify-between rounded-xl border border-[#0D1321]/10 bg-[#FAFBFF] p-3 text-left transition-colors hover:border-[#1635C7]/35 hover:bg-[#F3F6FF]"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-[#EEF3FF] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#1635C7]">
                      {item.task}
                    </span>
                    <span className="text-[11px] text-[#647084]">
                      {new Date(item.createdAt).toLocaleString(locale === "en" ? "en-US" : "vi-VN")}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-[#111827]">
                    {item.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[#505A6E]">
                    {item.output}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
