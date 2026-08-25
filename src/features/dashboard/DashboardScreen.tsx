"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Bookmark,
  Bot,
  Boxes,
  CheckSquare2,
  ChevronDown,
  CircleAlert,
  Cloud,
  CodeXml,
  DatabaseZap,
  FileDiff,
  FileText,
  FolderKanban,
  Globe2,
  Link2,
  ListChecks,
  LockKeyhole,
  Mail,
  MessageSquareText,
  PanelTop,
  Pin,
  Plus,
  ScanText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  UsersRound,
  WandSparkles,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Badge } from "@/components/ui";
import type {
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import { cn } from "@/lib/utils";

type DashboardMode = "chat" | "search";
type DialogKind = "upload" | "website" | "create" | null;
type CreateTool =
  | "summary"
  | "compare"
  | "checklist"
  | "report"
  | "email"
  | "tasks";

type DashboardScreenProps = Readonly<{
  spaces: readonly SpaceSummaryView[];
  documents: readonly DocumentSummaryView[];
}>;

type ScopeOption = Readonly<{
  value: string;
  label: string;
  description: string;
  group: "space" | "source";
  icon: LucideIcon;
}>;

const sourceScopeOptions = [
  {
    value: "source:drive",
    label: "Google Drive",
    description: "Nguồn Drive đã được cấp quyền",
    group: "source",
    icon: Cloud,
  },
  {
    value: "source:website",
    label: "Website",
    description: "Các website đã lập chỉ mục",
    group: "source",
    icon: Globe2,
  },
  {
    value: "source:uploads",
    label: "Tệp đã tải lên",
    description: "Tài liệu ở trạng thái Sẵn sàng",
    group: "source",
    icon: UploadCloud,
  },
] as const satisfies readonly ScopeOption[];

const createTools = [
  {
    value: "summary",
    label: "Tóm tắt",
    description: "Rút ra điểm chính, rủi ro và quyết định.",
    icon: Sparkles,
  },
  {
    value: "compare",
    label: "So sánh",
    description: "Tìm nội dung thêm, xóa và thay đổi.",
    icon: FileDiff,
  },
  {
    value: "checklist",
    label: "Tạo checklist",
    description: "Chuyển tri thức thành các bước có thể thực hiện.",
    icon: CheckSquare2,
  },
  {
    value: "report",
    label: "Tạo báo cáo",
    description: "Tạo bản nháp có cấu trúc và nguồn tham chiếu.",
    icon: PanelTop,
  },
  {
    value: "email",
    label: "Soạn email",
    description: "Tạo bản nháp để xem lại; không tự động gửi.",
    icon: Mail,
  },
  {
    value: "tasks",
    label: "Trích xuất công việc",
    description: "Nhận diện đầu việc, người phụ trách và thời hạn.",
    icon: ListChecks,
  },
] as const satisfies readonly Readonly<{
  value: CreateTool;
  label: string;
  description: string;
  icon: LucideIcon;
}>[];

const suggestedActions = [
  {
    label: "Tóm tắt chính sách làm việc từ xa",
    action: "fill",
  },
  {
    label: "So sánh 2 phiên bản hợp đồng",
    action: "compare",
  },
  {
    label: "Tạo checklist onboarding",
    action: "checklist",
  },
  {
    label: "Tìm tài liệu mới cập nhật",
    action: "search",
  },
] as const;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: Readonly<{
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}>) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">
            {eyebrow}
          </p>
        ) : null}
        <h2 id={id} className="text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ScopeSelector({
  options,
  selectedValues,
  onToggle,
}: Readonly<{
  options: readonly ScopeOption[];
  selectedValues: readonly string[];
  onToggle: (value: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selectedOptions = options.filter((option) =>
    selectedValues.includes(option.value),
  );
  const label = selectedValues.includes("workspace")
    ? "Toàn bộ tri thức"
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length} phạm vi`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const spaceOptions = options.filter((option) => option.group === "space");
  const sourceOptions = options.filter((option) => option.group === "source");

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-3.5 text-left text-sm font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-blue-300" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Chọn phạm vi tri thức"
          className="fixed inset-x-4 bottom-4 z-40 w-auto overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/35 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-[calc(100%+0.6rem)] sm:w-[min(25rem,calc(100vw-2rem))]"
        >
          <div className="border-b border-slate-800 px-4 py-3.5">
            <p className="text-sm font-semibold text-white">Tìm trong</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Kết quả luôn được giới hạn thêm bởi quyền hiện tại của bạn.
            </p>
          </div>

          <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto p-2 sm:max-h-[min(28rem,65vh)]">
            <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-900">
              <input
                type="checkbox"
                checked={selectedValues.includes("workspace")}
                onChange={() => onToggle("workspace")}
                className="mt-1 size-4 accent-blue-600"
              />
              <Boxes aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blue-300" />
              <span>
                <span className="block text-sm font-medium text-slate-100">Toàn bộ tri thức</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-400">
                  Mọi nguồn bạn được phép xem
                </span>
              </span>
            </label>

            <ScopeGroup
              label="Kho tri thức"
              options={spaceOptions}
              selectedValues={selectedValues}
              onToggle={onToggle}
            />
            <ScopeGroup
              label="Nguồn dữ liệu"
              options={sourceOptions}
              selectedValues={selectedValues}
              onToggle={onToggle}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScopeGroup({
  label,
  options,
  selectedValues,
  onToggle,
}: Readonly<{
  label: string;
  options: readonly ScopeOption[];
  selectedValues: readonly string[];
  onToggle: (value: string) => void;
}>) {
  return (
    <fieldset className="mt-2 border-t border-slate-800 pt-2">
      <legend className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </legend>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-slate-900"
          >
            <input
              type="checkbox"
              checked={selectedValues.includes(option.value)}
              onChange={() => onToggle(option.value)}
              className="mt-1 size-4 accent-blue-600"
            />
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-300" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-400">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function DashboardDialog({
  title,
  description,
  onClose,
  children,
}: Readonly<{
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  const headingId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      const autofocusTarget = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus]",
      );
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
        focusableSelector,
      );
      (autofocusTarget ?? firstFocusable ?? panelRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/45 sm:rounded-3xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur sm:px-6 sm:py-5">
          <div>
            <h2 id={headingId} className="text-lg font-semibold text-white sm:text-xl">
              {title}
            </h2>
            <p id={descriptionId} className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Đóng ${title}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function UploadDialogContent({
  spaces,
  onClose,
}: Readonly<{
  spaces: readonly SpaceSummaryView[];
  onClose: () => void;
}>) {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit} className="p-5 sm:p-6">
      <label
        htmlFor="dashboard-upload-file"
        className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-slate-900/55 px-5 py-8 text-center transition-colors hover:border-blue-600 hover:bg-blue-950/20"
      >
        <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-blue-800/70 bg-blue-950/70 text-blue-300">
          <UploadCloud aria-hidden="true" className="size-6" />
        </span>
        <span className="mt-4 text-sm font-semibold text-slate-100">
          Chọn tệp hoặc kéo thả vào đây
        </span>
        <span className="mt-1 text-xs leading-5 text-slate-400">
          PDF, Word, Excel, PowerPoint hoặc ảnh
        </span>
        <input
          data-autofocus
          id="dashboard-upload-file"
          type="file"
          required
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"
          className="mt-4 block max-w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-200"
        />
      </label>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-200">
          Kho tri thức
          <select
            required
            className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 sm:text-sm"
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-200">
          Quyền truy cập
          <select className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 sm:text-sm">
            <option>Kế thừa từ kho tri thức</option>
            <option>Chỉ thành viên của kho</option>
          </select>
        </label>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Sau khi tải lên
        </p>
        <ol className="mt-3 grid gap-3 sm:grid-cols-4">
          {[
            [ShieldCheck, "Kiểm tra an toàn"],
            [ScanText, "Đọc / OCR"],
            [DatabaseZap, "Lập chỉ mục"],
            [BadgeCheck, "Sẵn sàng"],
          ].map(([Icon, label], index) => {
            const StepIcon = Icon as LucideIcon;
            return (
              <li key={label as string} className="flex items-center gap-2 sm:block">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
                  <StepIcon aria-hidden="true" className="size-4" />
                </span>
                <span className="text-xs text-slate-300 sm:mt-2 sm:block">
                  {index + 1}. {label as string}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {submitted ? (
        <p role="status" className="mt-5 rounded-xl border border-blue-800/60 bg-blue-950/35 px-4 py-3 text-sm leading-6 text-blue-200">
          Cấu hình đã được kiểm tra trong giao diện mẫu. Chưa có tệp nào được truyền đi vì upload API và worker xử lý chưa được kết nối.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
        >
          Hủy
        </button>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <UploadCloud aria-hidden="true" className="size-4" />
          Kiểm tra luồng tải lên
        </button>
      </div>
    </form>
  );
}

function WebsiteDialogContent({
  spaces,
  onClose,
}: Readonly<{
  spaces: readonly SpaceSummaryView[];
  onClose: () => void;
}>) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
      className="p-5 sm:p-6"
    >
      <label htmlFor="website-url" className="text-sm font-medium text-slate-200">
        Địa chỉ website
      </label>
      <div className="relative mt-2">
        <Globe2 aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          data-autofocus
          id="website-url"
          type="url"
          required
          placeholder="https://company.com/policies/"
          className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 pl-10 pr-4 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-200">Phạm vi thu thập</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            ["page", "Chỉ trang này"],
            ["section", "Phần website này"],
            ["site", "Toàn website"],
          ].map(([value, label], index) => (
            <label
              key={value}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 text-sm text-slate-200 transition-colors hover:border-slate-600"
            >
              <input
                type="radio"
                name="crawl-scope"
                value={value}
                defaultChecked={index === 1}
                className="size-4 accent-blue-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block text-sm font-medium text-slate-200">
        Kho tri thức
        <select className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 sm:text-sm">
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-300" />
        <p className="text-xs leading-5 text-slate-400">
          Nội dung chỉ có thể được dùng cho tìm kiếm sau khi crawler loại nhiễu, lập chỉ mục và trả trạng thái Sẵn sàng.
        </p>
      </div>

      {submitted ? (
        <p role="status" className="mt-5 rounded-xl border border-blue-800/60 bg-blue-950/35 px-4 py-3 text-sm leading-6 text-blue-200">
          Cấu hình website đã hợp lệ ở phía giao diện. Prototype chưa gọi crawler hoặc lưu URL.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
        >
          Hủy
        </button>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus aria-hidden="true" className="size-4" />
          Kiểm tra cấu hình
        </button>
      </div>
    </form>
  );
}

function CreateDialogContent({
  documents,
  initialTool,
  onToolChange,
  onClose,
}: Readonly<{
  documents: readonly DocumentSummaryView[];
  initialTool: CreateTool;
  onToolChange: (tool: CreateTool) => void;
  onClose: () => void;
}>) {
  const [submitted, setSubmitted] = useState(false);
  const readyDocuments = documents.filter(
    (document) => document.processing.kind === "ready",
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
      className="p-5 sm:p-6"
    >
      <fieldset>
        <legend className="text-sm font-semibold text-slate-200">Chọn đầu ra</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {createTools.map((tool, index) => {
            const Icon = tool.icon;
            const selected = initialTool === tool.value;
            return (
              <label
                key={tool.value}
                className={cn(
                  "flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                  selected
                    ? "border-blue-600 bg-blue-950/45"
                    : "border-slate-800 bg-slate-900/45 hover:border-slate-700",
                )}
              >
                <input
                  data-autofocus={index === 0 ? "true" : undefined}
                  type="radio"
                  name="create-tool"
                  value={tool.value}
                  checked={selected}
                  onChange={() => onToolChange(tool.value)}
                  className="sr-only"
                />
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-blue-300">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-100">{tool.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    {tool.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-200">
          Nguồn Sẵn sàng
          <select
            required
            className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 sm:text-sm"
          >
            <option value="">Chọn một tài liệu</option>
            {readyDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-200">
          Hướng dẫn cho AI
          <input
            required
            placeholder="Mô tả đầu ra bạn cần"
            className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
        </label>
      </div>

      {initialTool === "email" ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-800/60 bg-amber-950/25 px-4 py-3 text-xs leading-5 text-amber-200">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Luồng này chỉ tạo bản nháp để xem lại và sao chép; không gửi email tự động.
        </p>
      ) : null}

      {submitted ? (
        <p role="status" className="mt-5 rounded-xl border border-blue-800/60 bg-blue-950/35 px-4 py-3 text-sm leading-6 text-blue-200">
          Đã ghi nhận cấu hình trong giao diện mẫu. Chưa có nội dung nào được sinh vì AI generation API chưa được kết nối.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Link
          href={`/utility?tool=${initialTool}`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-950/35 hover:text-blue-200"
        >
          Xem toàn bộ tiện ích
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <WandSparkles aria-hidden="true" className="size-4" />
            Kiểm tra luồng tạo
          </button>
        </div>
      </div>
    </form>
  );
}

function getChatScope(
  selectedValues: readonly string[],
  spaces: readonly SpaceSummaryView[],
) {
  if (selectedValues.length !== 1 || selectedValues.includes("workspace")) {
    return "workspace";
  }

  const selectedSpaceId = selectedValues[0].startsWith("space:")
    ? selectedValues[0].slice("space:".length)
    : "";
  const spaceName = spaces
    .find((space) => space.id === selectedSpaceId)
    ?.name.toLocaleLowerCase("vi");

  if (spaceName === "nhân sự") return "hr";
  if (spaceName === "vận hành") return "operations";
  if (spaceName?.includes("atlas")) return "atlas";
  return "workspace";
}

function getDocumentHref(document?: DocumentSummaryView) {
  return document ? `/documents/${document.id}` : "/documents";
}

export function DashboardScreen({ spaces, documents }: DashboardScreenProps) {
  const router = useRouter();
  const [mode, setMode] = useState<DashboardMode>("chat");
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["workspace"]);
  const [activeDialog, setActiveDialog] = useState<DialogKind>(null);
  const [createTool, setCreateTool] = useState<CreateTool>("summary");
  const [pinnedItems, setPinnedItems] = useState<Set<string>>(new Set());
  const [liveMessage, setLiveMessage] = useState("");
  const [isNavigating, startNavigation] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const scopeOptions = useMemo<readonly ScopeOption[]>(
    () => [
      ...spaces.map((space, index) => ({
        value: `space:${space.id}`,
        label: space.name,
        description: `${space.documentCount} tài liệu trong fixture`,
        group: "space" as const,
        icon: [UsersRound, Workflow, FolderKanban][index % 3],
      })),
      ...sourceScopeOptions,
    ],
    [spaces],
  );
  const readyDocuments = documents.filter(
    (document) => document.processing.kind === "ready",
  );
  const recentDocument = readyDocuments[0] ?? documents[0];
  const savedDocument = readyDocuments[1] ?? readyDocuments[0] ?? documents[0];
  const expiringDocument = documents.find((document) =>
    document.governance.some((marker) => marker.kind === "expiring"),
  );
  const featuredDocuments = [
    recentDocument,
    savedDocument,
    expiringDocument ?? readyDocuments[2],
  ].filter(
    (document, index, collection): document is DocumentSummaryView =>
      Boolean(document) &&
      collection.findIndex((item) => item?.id === document?.id) === index,
  );

  function toggleScope(value: string) {
    if (value === "workspace") {
      setSelectedScopes(["workspace"]);
      return;
    }

    setSelectedScopes((current) => {
      const withoutWorkspace = current.filter((item) => item !== "workspace");
      const next = withoutWorkspace.includes(value)
        ? withoutWorkspace.filter((item) => item !== value)
        : [...withoutWorkspace, value];
      return next.length ? next : ["workspace"];
    });
  }

  function submitKnowledgeQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setQueryError("Hãy nhập câu hỏi hoặc từ khóa trước khi tiếp tục.");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    setQueryError("");
    const params = new URLSearchParams();

    if (mode === "chat") {
      params.set("prompt", normalizedQuery);
      params.set("scope", getChatScope(selectedScopes, spaces));
      params.set("scopeIds", selectedScopes.join(","));
      startNavigation(() => router.push(`/chat?${params.toString()}`));
      return;
    }

    params.set("q", normalizedQuery);
    const selectedSpaces = selectedScopes.filter((item) => item.startsWith("space:"));
    if (selectedSpaces.length === 1 && selectedScopes.length === 1) {
      params.set("space", selectedSpaces[0].slice("space:".length));
    }
    startNavigation(() => router.push(`/search?${params.toString()}`));
  }

  function handleSuggestion(label: string, action: (typeof suggestedActions)[number]["action"]) {
    if (action === "compare") {
      startNavigation(() => router.push("/documents/compare"));
      return;
    }
    if (action === "checklist") {
      setCreateTool("checklist");
      setActiveDialog("create");
      return;
    }

    setMode(action === "search" ? "search" : "chat");
    setQuery(label);
    setQueryError("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openCreateDialog(tool: CreateTool) {
    setCreateTool(tool);
    setActiveDialog("create");
  }

  function togglePin(document: DocumentSummaryView) {
    setPinnedItems((current) => {
      const next = new Set(current);
      if (next.has(document.id)) {
        next.delete(document.id);
        setLiveMessage(`Đã bỏ ghim ${document.name}.`);
      } else {
        next.add(document.id);
        setLiveMessage(`Đã ghim ${document.name} trong phiên prototype.`);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
              Tổng quan workspace
            </p>
            <Badge variant="neutral" size="sm">Dữ liệu fixture</Badge>
          </div>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Chào An, bạn muốn tìm hiểu điều gì?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Hỏi, tìm và tiếp tục công việc với tri thức được tổ chức theo đúng phạm vi bạn có thể truy cập.
          </p>
        </div>
        <Link
          href="/documents"
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-900/60 px-4 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:self-auto"
        >
          <BookOpen aria-hidden="true" className="size-4" />
          Mở thư viện
        </Link>
      </header>

      <aside
        aria-label="Thông báo dữ liệu minh họa"
        className="mt-6 flex items-start gap-3 rounded-2xl border border-blue-900/60 bg-blue-950/25 px-4 py-3 text-sm text-blue-100"
      >
        <CodeXml aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blue-300" />
        <p className="leading-6">
          Home này chạy trên adapter fixture cục bộ. Các luồng điều hướng và trạng thái giao diện hoạt động; Search, AI, upload và connector chưa gọi backend thật.
        </p>
      </aside>

      <section
        aria-labelledby="knowledge-entry-heading"
        className="relative mt-7 overflow-hidden rounded-[1.75rem] border border-blue-800/55 bg-gradient-to-br from-blue-950/80 via-slate-950 to-violet-950/55 p-5 shadow-2xl shadow-blue-950/20 sm:p-7 lg:p-9"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-blue-500/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
                <Sparkles aria-hidden="true" className="size-4" />
                AI Knowledge Workspace
              </p>
              <h2 id="knowledge-entry-heading" className="mt-3 text-balance text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">
                Hỏi bất kỳ điều gì về tổ chức của bạn
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Tìm trên tài liệu và nguồn đã được cấp quyền. AI tổng hợp câu trả lời; Search đưa bạn tới đúng tài liệu.
              </p>
            </div>

            <div
              role="group"
              aria-label="Chọn chế độ truy vấn"
              className="grid w-full grid-cols-2 rounded-xl border border-slate-700/80 bg-slate-950/70 p-1 sm:w-auto"
            >
              <button
                type="button"
                aria-pressed={mode === "chat"}
                onClick={() => setMode("chat")}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                  mode === "chat"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
                )}
              >
                <Bot aria-hidden="true" className="size-4" />
                Trợ lý AI
              </button>
              <button
                type="button"
                aria-pressed={mode === "search"}
                onClick={() => setMode("search")}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                  mode === "search"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
                )}
              >
                <Search aria-hidden="true" className="size-4" />
                Tìm kiếm
              </button>
            </div>
          </div>

          <form onSubmit={submitKnowledgeQuery} role="search" className="mt-7">
            <label htmlFor="dashboard-knowledge-query" className="sr-only">
              {mode === "chat" ? "Câu hỏi cho Trợ lý AI" : "Từ khóa tìm kiếm"}
            </label>
            <div className="grid gap-3 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(0,2.1fr)_auto]">
              <ScopeSelector
                options={scopeOptions}
                selectedValues={selectedScopes}
                onToggle={toggleScope}
              />
              <div className="min-w-0">
                <input
                  ref={inputRef}
                  id="dashboard-knowledge-query"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (queryError && event.target.value.trim()) setQueryError("");
                  }}
                  aria-invalid={Boolean(queryError)}
                  aria-describedby={queryError ? "dashboard-query-error" : "dashboard-query-help"}
                  placeholder={
                    mode === "chat"
                      ? "Ví dụ: Quy trình phê duyệt chi phí gồm những bước nào?"
                      : "Tìm theo tên, từ khóa hoặc ý nghĩa…"
                  }
                  className={cn(
                    "h-12 w-full rounded-xl border bg-slate-950/80 px-4 text-base text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:ring-2",
                    queryError
                      ? "border-rose-600 focus:border-rose-500 focus:ring-rose-500/25"
                      : "border-slate-700 focus:border-blue-500 focus:ring-blue-500/30",
                  )}
                />
              </div>
              <button
                type="submit"
                disabled={isNavigating}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:bg-slate-700 disabled:text-slate-400"
              >
                {mode === "chat" ? <Send aria-hidden="true" className="size-4" /> : <Search aria-hidden="true" className="size-4" />}
                {isNavigating
                  ? "Đang mở…"
                  : mode === "chat"
                    ? "Đặt câu hỏi"
                    : "Tìm kiếm"}
              </button>
            </div>
            <p
              id={queryError ? "dashboard-query-error" : "dashboard-query-help"}
              role={queryError ? "alert" : undefined}
              className={cn(
                "mt-2 min-h-5 text-xs leading-5",
                queryError ? "text-rose-300" : "text-slate-400",
              )}
            >
              {queryError ||
                (mode === "chat"
                  ? "Câu hỏi sẽ được giữ nguyên khi mở một hội thoại mới."
                  : "Kết quả chỉ gồm tài liệu fixture đã ở trạng thái Sẵn sàng.")}
            </p>
          </form>

          <div className="mt-3 flex flex-wrap gap-2" aria-label="Gợi ý bắt đầu nhanh">
            {suggestedActions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => handleSuggestion(suggestion.label, suggestion.action)}
                className="inline-flex min-h-10 items-center rounded-full border border-slate-700/80 bg-slate-900/65 px-3.5 text-left text-xs font-medium text-slate-300 transition-colors hover:border-blue-700 hover:bg-blue-950/40 hover:text-blue-200"
              >
                {suggestion.label}
              </button>
            ))}
          </div>

          <div className="mt-7 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
            {[
              [LockKeyhole, "Theo đúng quyền", "Scope luôn giao với quyền hiện tại."],
              [BadgeCheck, "Có thể kiểm chứng", "Câu trả lời mở được nguồn và vị trí."],
              [DatabaseZap, "Ready-only", "Chưa lập chỉ mục thì chưa dùng cho AI/Search."],
            ].map(([Icon, title, description]) => {
              const TrustIcon = Icon as LucideIcon;
              return (
                <div key={title as string} className="flex items-start gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-blue-300">
                    <TrustIcon aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{title as string}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{description as string}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section aria-labelledby="continue-heading" className="mt-12">
        <SectionHeading
          id="continue-heading"
          eyebrow="Cá nhân"
          title="Tiếp tục công việc"
          description="Quay lại tài liệu, hội thoại và nội dung bạn vừa dùng trong workspace."
          action={
            <Link href="/documents" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-950/35 hover:text-blue-200">
              Xem hoạt động
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-3">
          <ContinueCard
            label="Đã xem gần đây"
            title={recentDocument?.name ?? "Mở thư viện tài liệu"}
            meta={recentDocument ? `${recentDocument.space.name} · ${recentDocument.updatedLabel}` : "Chưa có dữ liệu fixture"}
            href={getDocumentHref(recentDocument)}
            icon={FileText}
          />
          <ContinueCard
            label="Chat gần đây"
            title="Đối chiếu quy trình bàn giao dự án"
            meta="Hội thoại mẫu · có thể tiếp tục"
            href="/chat"
            icon={MessageSquareText}
          />
          <ContinueCard
            label="Đã lưu"
            title={savedDocument?.name ?? "Mở nội dung đã lưu"}
            meta={savedDocument ? `${savedDocument.space.name} · ${savedDocument.versionLabel}` : "Chưa có dữ liệu fixture"}
            href={getDocumentHref(savedDocument)}
            icon={Bookmark}
          />
        </div>
      </section>

      <section aria-labelledby="spaces-heading" className="mt-12">
        <SectionHeading
          id="spaces-heading"
          eyebrow="Tổ chức tri thức"
          title="Kho tri thức bạn có thể truy cập"
          description="Số lượng dưới đây được lấy từ cùng adapter fixture với Search và Tài liệu."
          action={
            <Link href="/documents" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-950/35 hover:text-blue-200">
              Xem tất cả
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {spaces.map((space, index) => {
            const Icon = [UsersRound, Workflow, FolderKanban][index % 3];
            return (
              <Link
                key={space.id}
                href={`/documents/spaces/${space.id}`}
                className="group rounded-2xl border border-slate-800 bg-slate-900/55 p-5 transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-blue-700 hover:bg-slate-900 hover:shadow-xl hover:shadow-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex size-11 items-center justify-center rounded-xl border border-blue-800/60 bg-blue-950/55 text-blue-300">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <Badge variant="neutral" size="sm">{space.documentCount} tài liệu</Badge>
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{space.name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-400">{space.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-300">
                  Mở kho
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="quick-actions-heading" className="mt-12">
        <SectionHeading
          id="quick-actions-heading"
          eyebrow="Bắt đầu nhanh"
          title="Đưa tri thức vào hoặc biến tri thức thành đầu ra"
          description="Mỗi hành động đi tới một workflow rõ ràng; các bước chưa có backend được đánh dấu trong giao diện."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <QuickActionButton
            icon={UploadCloud}
            label="Tải tệp lên"
            description="Tệp → OCR → index → Ready"
            onClick={() => setActiveDialog("upload")}
          />
          <QuickActionButton
            icon={Globe2}
            label="Thêm website"
            description="Crawl nội dung vào kho"
            onClick={() => setActiveDialog("website")}
          />
          <QuickActionLink
            icon={Link2}
            label="Kết nối nguồn"
            description="Drive, SharePoint và hơn nữa"
            href="/admin/connectors"
          />
          <QuickActionLink
            icon={FileDiff}
            label="So sánh tài liệu"
            description="Đối chiếu nội dung / phiên bản"
            href="/documents/compare"
          />
          <QuickActionButton
            icon={WandSparkles}
            label="Tạo bằng AI"
            description="Checklist, báo cáo, email…"
            onClick={() => openCreateDialog("summary")}
          />
        </div>
      </section>

      <section aria-labelledby="for-you-heading" className="mt-12">
        <SectionHeading
          id="for-you-heading"
          eyebrow="Liên quan tới bạn"
          title="Cập nhật cần chú ý"
          description="Bản mẫu ưu tiên tài liệu Sẵn sàng và governance marker có trong catalog fixture."
          action={
            <Link href="/documents" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-950/35 hover:text-blue-200">
              Xem thư viện
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55">
            {featuredDocuments.map((document, index) => {
              const governance = document.governance[0];
              return (
                <div
                  key={document.id}
                  className={cn(
                    "flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between",
                    index > 0 && "border-t border-slate-800",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-300">
                      <FileText aria-hidden="true" className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold leading-6 text-slate-100">{document.name}</h3>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-slate-400">
                        <span>{document.space.name}</span>
                        <span aria-hidden="true">·</span>
                        <span>{document.updatedLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{document.versionLabel}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[3.4rem] sm:pl-0">
                    {governance ? (
                      <Badge variant={governance.variant} size="sm">{governance.label}</Badge>
                    ) : null}
                    <Link
                      href={getDocumentHref(document)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-700 hover:bg-blue-950/30 hover:text-blue-200"
                    >
                      Mở tài liệu
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="rounded-2xl border border-violet-800/45 bg-gradient-to-br from-violet-950/35 to-slate-900/60 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-950/70 text-violet-300">
                <Sparkles aria-hidden="true" className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold text-white">Đề xuất theo ngữ cảnh</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  V1 dùng quy tắc từ kho tham gia và hoạt động fixture, không tự suy đoán sở thích.
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-2">
              {readyDocuments.slice(0, 2).map((document) => (
                <li key={document.id}>
                  <Link
                    href={getDocumentHref(document)}
                    className="group flex min-h-16 items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/35 px-3.5 py-3 transition-colors hover:border-violet-700 hover:bg-violet-950/20"
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-slate-100">{document.name}</span>
                      <span className="mt-1 block text-xs text-slate-400">Vì thuộc kho {document.space.name}</span>
                    </span>
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section aria-labelledby="essentials-heading" className="mt-12">
        <SectionHeading
          id="essentials-heading"
          eyebrow="Nguồn chính thức"
          title="Tài liệu thiết yếu của đội ngũ"
          description="Nội dung được tổ chức ghim; nút sao lưu My Pins trong phiên prototype."
        />
        {readyDocuments.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {readyDocuments.slice(0, 3).map((document) => {
              const pinned = pinnedItems.has(document.id);
              return (
                <article key={document.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-800 text-blue-300">
                      <ShieldCheck aria-hidden="true" className="size-5" />
                    </span>
                    <button
                      type="button"
                      aria-pressed={pinned}
                      aria-label={`${pinned ? "Bỏ ghim" : "Ghim"} ${document.name}`}
                      onClick={() => togglePin(document)}
                      className={cn(
                        "inline-flex size-11 items-center justify-center rounded-xl transition-colors",
                        pinned
                          ? "bg-amber-950/50 text-amber-300"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                      )}
                    >
                      <Star aria-hidden="true" className={cn("size-5", pinned && "fill-current")} />
                    </button>
                  </div>
                  <h3 className="mt-5 break-words text-base font-semibold text-white">{document.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {document.space.name} · {document.versionLabel}
                  </p>
                  <Link
                    href={getDocumentHref(document)}
                    className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-300 transition-colors hover:text-blue-200"
                  >
                    Mở nguồn chính thức
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/35 px-5 py-10 text-center">
            <Pin aria-hidden="true" className="mx-auto size-6 text-slate-500" />
            <p className="mt-3 text-sm text-slate-400">Chưa có tài liệu fixture Sẵn sàng để ghim.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="ai-tools-heading" className="mb-8 mt-12">
        <SectionHeading
          id="ai-tools-heading"
          eyebrow="AI utilities"
          title="Tạo đầu ra từ đúng nguồn đã chọn"
          description="AI chỉ dùng tài liệu bạn chọn trong phạm vi được phép; mọi đầu ra đều cần xem lại trước khi sử dụng."
          action={
            <Link href="/utility" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-950/35 hover:text-blue-200">
              Mở catalog
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {createTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.value}
                type="button"
                onClick={() => openCreateDialog(tool.value)}
                className="group min-h-32 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-950/20"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-800 text-blue-300 transition-colors group-hover:bg-blue-950/70">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="mt-4 block text-sm font-semibold text-slate-100">{tool.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </p>

      {activeDialog === "upload" ? (
        <DashboardDialog
          title="Tải tài liệu"
          description="Chọn tệp, kho tri thức và cách kế thừa quyền trước khi đưa tài liệu vào pipeline."
          onClose={() => setActiveDialog(null)}
        >
          <UploadDialogContent spaces={spaces} onClose={() => setActiveDialog(null)} />
        </DashboardDialog>
      ) : null}

      {activeDialog === "website" ? (
        <DashboardDialog
          title="Thêm website"
          description="Chọn URL, phạm vi crawl và kho đích. Nội dung chỉ khả dụng sau khi lập chỉ mục hoàn tất."
          onClose={() => setActiveDialog(null)}
        >
          <WebsiteDialogContent spaces={spaces} onClose={() => setActiveDialog(null)} />
        </DashboardDialog>
      ) : null}

      {activeDialog === "create" ? (
        <DashboardDialog
          title="Tạo từ tri thức"
          description="Chọn loại đầu ra, nguồn Sẵn sàng và hướng dẫn. Email chỉ được tạo dưới dạng bản nháp."
          onClose={() => setActiveDialog(null)}
        >
          <CreateDialogContent
            documents={documents}
            initialTool={createTool}
            onToolChange={setCreateTool}
            onClose={() => setActiveDialog(null)}
          />
        </DashboardDialog>
      ) : null}
    </div>
  );
}

function ContinueCard({
  label,
  title,
  meta,
  href,
  icon: Icon,
}: Readonly<{
  label: string;
  title: string;
  meta: string;
  href: string;
  icon: LucideIcon;
}>) {
  return (
    <Link
      href={href}
      className="group flex min-h-36 flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-blue-700 hover:bg-slate-900 hover:shadow-xl hover:shadow-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">{label}</span>
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-slate-800 text-blue-300">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>
      <h3 className="mt-5 break-words text-sm font-semibold leading-6 text-slate-100">{title}</h3>
      <p className="mt-auto pt-2 text-xs leading-5 text-slate-400">{meta}</p>
      <ArrowRight aria-hidden="true" className="mt-4 size-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-300" />
    </Link>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  description,
  onClick,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-h-32 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-950/20"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-800 text-blue-300 transition-colors group-hover:bg-blue-950/70">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="mt-4 block text-sm font-semibold text-slate-100">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span>
    </button>
  );
}

function QuickActionLink({
  icon: Icon,
  label,
  description,
  href,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  description: string;
  href: string;
}>) {
  return (
    <Link
      href={href}
      className="group min-h-32 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-800 text-blue-300 transition-colors group-hover:bg-blue-950/70">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="mt-4 block text-sm font-semibold text-slate-100">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span>
    </Link>
  );
}
