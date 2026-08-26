import {
  Bot,
  Check,
  ChevronRight,
  FileCheck2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LockKeyhole,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";

import type { PublicInfoSection } from "@/components/landing/public-info-content";
import type { Locale } from "@/lib/preferences";

type PreviewCopy = Readonly<{
  preview: "dashboard" | "trust" | "capabilities" | "workflow";
  eyebrow: string;
  title: string;
  description: string;
  purposeLabel: string;
  purpose: string;
  benefits: readonly string[];
}>;

const vietnameseCopy: Record<PublicInfoSection, PreviewCopy> = {
  product: {
    preview: "dashboard",
    eyebrow: "Giao diện tổng quan sản phẩm",
    title: "Một workspace thống nhất cho toàn bộ tri thức doanh nghiệp.",
    description:
      "Dashboard đưa những khu vực quan trọng nhất vào một màn hình: hỏi AI, tìm kiếm, tài liệu và không gian tri thức.",
    purposeLabel: "Dùng để",
    purpose:
      "Giúp người dùng biết tài liệu mới, truy cập nhanh công cụ thường dùng và bắt đầu công việc mà không phải chuyển qua nhiều hệ thống.",
    benefits: [
      "Theo dõi tài liệu và Knowledge Spaces gần đây",
      "Mở nhanh Trợ lý AI hoặc tìm kiếm toàn workspace",
      "Tiếp tục đúng công việc đang làm dở",
    ],
  },
  principles: {
    preview: "trust",
    eyebrow: "Giao diện tin cậy và phân quyền",
    title: "Người dùng luôn thấy AI đang dựa vào nguồn nào.",
    description:
      "Phạm vi nguồn, trạng thái quyền và citation được hiển thị ngay cạnh câu trả lời thay vì ẩn phía sau hệ thống.",
    purposeLabel: "Dùng để",
    purpose:
      "Giúp người dùng kiểm tra bằng chứng trước khi sử dụng kết quả, đồng thời bảo đảm AI chỉ đọc tài liệu họ được cấp quyền.",
    benefits: [
      "Nhìn rõ workspace và tài liệu đang được sử dụng",
      "Mở đúng đoạn nội dung tạo nên câu trả lời",
      "Nhận cảnh báo khi nguồn chưa đủ hoặc bị giới hạn",
    ],
  },
  capabilities: {
    preview: "capabilities",
    eyebrow: "Giao diện các chức năng chính",
    title: "Từ câu hỏi đến tài liệu và công cụ xử lý trong một luồng.",
    description:
      "AI Chat, Search và so sánh tài liệu dùng chung nguồn tri thức để người dùng không mất ngữ cảnh khi chuyển tác vụ.",
    purposeLabel: "Dùng để",
    purpose:
      "Tìm thông tin, hỏi đáp có trích dẫn, đối chiếu phiên bản và tạo bản tóm tắt từ chính tài liệu doanh nghiệp.",
    benefits: [
      "Hỏi AI bằng ngôn ngữ tự nhiên",
      "Tìm theo từ khóa, ý nghĩa và bộ lọc",
      "So sánh tài liệu và nhận diện điểm thay đổi",
    ],
  },
  workflow: {
    preview: "workflow",
    eyebrow: "Giao diện quy trình sử dụng",
    title: "Một đường đi rõ ràng từ tài liệu đến kết quả có thể kiểm tra.",
    description:
      "Mỗi bước trong sản phẩm nối tiếp nhau và giữ nguyên nguồn, quyền cùng ngữ cảnh của người dùng.",
    purposeLabel: "Dùng để",
    purpose:
      "Giúp đội ngũ chuẩn hóa cách đưa tài liệu vào hệ thống, khai thác bằng AI và xác minh kết quả trước khi hành động.",
    benefits: [
      "Tải và tổ chức tài liệu theo workspace",
      "Chọn đúng phạm vi trước khi hỏi AI",
      "Kiểm tra citation rồi mới sử dụng kết quả",
    ],
  },
};

const englishCopy: Record<PublicInfoSection, PreviewCopy> = {
  product: {
    ...vietnameseCopy.product,
    eyebrow: "Product overview interface",
    title: "One workspace for all enterprise knowledge.",
    description:
      "The dashboard brings AI, search, documents, and knowledge spaces into one clear starting point.",
    purposeLabel: "Use it to",
    purpose:
      "See recent knowledge, open common tools, and resume work without switching between systems.",
    benefits: [
      "Track recent documents and Knowledge Spaces",
      "Open AI Assistant or workspace search quickly",
      "Continue the work already in progress",
    ],
  },
  principles: {
    ...vietnameseCopy.principles,
    eyebrow: "Trust and permission interface",
    title: "Users can always see what an AI answer is based on.",
    description:
      "Source scope, permission status, and citations appear beside the answer instead of being hidden by the system.",
    purposeLabel: "Use it to",
    purpose:
      "Verify evidence before using a result while ensuring AI only reads authorized documents.",
    benefits: [
      "See the active workspace and source set",
      "Open the exact passage behind an answer",
      "Receive warnings when evidence is limited",
    ],
  },
  capabilities: {
    ...vietnameseCopy.capabilities,
    eyebrow: "Core feature interfaces",
    title: "Move from a question to documents and tools in one flow.",
    description:
      "AI Chat, Search, and document comparison share one knowledge context across tasks.",
    purposeLabel: "Use it to",
    purpose:
      "Find information, ask cited questions, compare versions, and summarize enterprise documents.",
    benefits: [
      "Ask AI in natural language",
      "Search with keywords, meaning, and filters",
      "Compare documents and identify changes",
    ],
  },
  workflow: {
    ...vietnameseCopy.workflow,
    eyebrow: "Product workflow interface",
    title: "A clear path from documents to verifiable results.",
    description:
      "Every step stays connected while preserving the source, permissions, and user context.",
    purposeLabel: "Use it to",
    purpose:
      "Standardize how teams add documents, work with AI, and verify results before acting.",
    benefits: [
      "Upload and organize workspace documents",
      "Select the right scope before asking AI",
      "Verify citations before using the result",
    ],
  },
};

const navItems = [
  { icon: LayoutDashboard, label: "Tổng quan" },
  { icon: MessageSquareText, label: "Trợ lý AI" },
  { icon: Search, label: "Tìm kiếm" },
  { icon: FileText, label: "Tài liệu" },
] as const;

function ProductFrame({
  children,
  activeLabel,
  locale,
}: {
  readonly children: React.ReactNode;
  readonly activeLabel: string;
  readonly locale: Locale;
}) {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-slate-700/90 bg-slate-950 shadow-2xl shadow-slate-950/50">
      <div className="flex h-11 items-center gap-2 border-b border-slate-800 bg-slate-900 px-4">
        <span className="size-2.5 rounded-full bg-rose-400/80" />
        <span className="size-2.5 rounded-full bg-amber-300/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 text-[10px] font-semibold tracking-[0.16em] text-slate-400">
          UPTECH KNOWLEDGE
        </span>
        <span className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-[9px] text-slate-400">
          {locale === "en" ? "Product preview" : "Giao diện dự kiến"}
        </span>
      </div>
      <div className="grid min-h-[25rem] grid-cols-[4.25rem_1fr] sm:grid-cols-[10.5rem_1fr]">
        <aside className="border-r border-slate-800 bg-slate-950/90 p-2.5 sm:p-3">
          <div className="mb-4 flex h-9 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-bold text-white sm:justify-start sm:px-3">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            <span className="ml-2 hidden sm:inline">Workspace</span>
          </div>
          <nav aria-label={locale === "en" ? "Preview navigation" : "Điều hướng giao diện mẫu"} className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.label === activeLabel;
              return (
                <div
                  key={item.label}
                  className={`flex h-9 items-center justify-center rounded-lg text-xs sm:justify-start sm:px-3 ${active ? "bg-blue-500/15 font-semibold text-blue-300" : "text-slate-500"}`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="ml-2 hidden sm:inline">{item.label}</span>
                </div>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 bg-slate-900/55 p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function DashboardPreview({ locale }: { readonly locale: Locale }) {
  return (
    <ProductFrame activeLabel="Tổng quan" locale={locale}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">
        {locale === "en" ? "Workspace overview" : "Tổng quan workspace"}
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">
        {locale === "en" ? "Good morning, Minh" : "Chào buổi sáng, Minh"}
      </h3>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["24", locale === "en" ? "Documents" : "Tài liệu"],
          ["03", "Knowledge Spaces"],
          ["12", locale === "en" ? "AI answers" : "Câu trả lời AI"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <p className="text-xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-[10px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-blue-400/25 bg-blue-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Bot className="size-4 text-blue-300" aria-hidden="true" />
          {locale === "en" ? "AI Assistant" : "Trợ lý AI"}
        </div>
        <div className="mt-3 flex min-h-10 items-center rounded-lg border border-slate-700 bg-slate-950 px-3 text-[11px] text-slate-500">
          {locale === "en" ? "Ask across this workspace..." : "Hỏi toàn bộ workspace..."}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {["Quy trình onboarding.pdf", "Chính sách bảo mật.docx"].map((file) => (
          <div key={file} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/65 p-3">
            <FileText className="size-4 text-violet-300" aria-hidden="true" />
            <span className="truncate text-[11px] text-slate-300">{file}</span>
          </div>
        ))}
      </div>
    </ProductFrame>
  );
}

function TrustPreview({ locale }: { readonly locale: Locale }) {
  return (
    <ProductFrame activeLabel="Trợ lý AI" locale={locale}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-semibold text-blue-200">
          {locale === "en" ? "Source scope: HR Space" : "Phạm vi nguồn: Không gian Nhân sự"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-300">
          <ShieldCheck className="size-3" aria-hidden="true" />
          {locale === "en" ? "Authorized" : "Được cấp quyền"}
        </span>
      </div>
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="text-[10px] font-semibold text-slate-500">AI CHAT</p>
        <p className="mt-3 text-xs leading-6 text-slate-200">
          {locale === "en"
            ? "Employees receive 12 annual leave days after probation, based on the current HR policy."
            : "Nhân viên có 12 ngày phép năm sau thời gian thử việc, theo chính sách nhân sự hiện hành."}
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-500/15 px-3 py-2 text-[10px] font-semibold text-blue-200">
          <FileCheck2 className="size-3.5" aria-hidden="true" />
          {locale === "en" ? "Citation source · page 8" : "Nguồn trích dẫn · trang 8"}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/75 p-4">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-white">
              {locale === "en" ? "Permission checked" : "Quyền đã được kiểm tra"}
            </p>
            <p className="mt-1 text-[10px] leading-5 text-slate-400">
              {locale === "en"
                ? "Only documents available to this account were used."
                : "Chỉ những tài liệu tài khoản này được phép xem mới được sử dụng."}
            </p>
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}

function CapabilitiesPreview({ locale }: { readonly locale: Locale }) {
  const cards = [
    {
      icon: MessageSquareText,
      title: "AI Chat",
      detail: locale === "en" ? "Answers with citations" : "Hỏi đáp kèm trích dẫn",
      accent: "text-blue-300 bg-blue-500/10 border-blue-400/25",
    },
    {
      icon: Search,
      title: locale === "en" ? "Search" : "Tìm kiếm",
      detail: locale === "en" ? "Keywords + meaning" : "Từ khóa + ngữ nghĩa",
      accent: "text-violet-300 bg-violet-500/10 border-violet-400/25",
    },
    {
      icon: FileCheck2,
      title: locale === "en" ? "Document comparison" : "So sánh tài liệu",
      detail: locale === "en" ? "Review changes" : "Đối chiếu thay đổi",
      accent: "text-emerald-300 bg-emerald-500/10 border-emerald-400/25",
    },
  ] as const;

  return (
    <ProductFrame activeLabel="Tìm kiếm" locale={locale}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">
        {locale === "en" ? "Knowledge tools" : "Bộ công cụ tri thức"}
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <span className={`flex size-9 items-center justify-center rounded-lg border ${card.accent}`}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <p className="mt-6 text-xs font-semibold text-white">{card.title}</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">{card.detail}</p>
              <ChevronRight className="mt-4 size-3.5 text-slate-600" aria-hidden="true" />
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/75 p-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-[10px] text-slate-400">
          <Search className="size-3.5" aria-hidden="true" />
          {locale === "en" ? "Search this workspace..." : "Tìm trong workspace..."}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {["Chính sách bảo mật.pdf", "Hợp đồng dịch vụ.docx"].map((file) => (
            <div key={file} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-[10px] text-slate-300">
              <FileText className="size-3.5 text-blue-300" aria-hidden="true" />
              {file}
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}

function WorkflowPreview({ locale }: { readonly locale: Locale }) {
  const steps = [
    [Upload, locale === "en" ? "Upload documents" : "Tải tài liệu"],
    [FolderOpen, locale === "en" ? "Select sources" : "Chọn nguồn"],
    [Bot, locale === "en" ? "Ask AI" : "Hỏi AI"],
    [FileCheck2, locale === "en" ? "Verify citations" : "Kiểm tra trích dẫn"],
  ] as const;

  return (
    <ProductFrame activeLabel="Tài liệu" locale={locale}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
        {locale === "en" ? "End-to-end workflow" : "Quy trình xuyên suốt"}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {steps.map(([Icon, label], index) => (
          <div key={label} className="relative rounded-xl border border-slate-700 bg-slate-900 p-3">
            <span className="font-mono text-[9px] text-blue-300">0{index + 1}</span>
            <Icon className="mt-5 size-4 text-slate-200" aria-hidden="true" />
            <p className="mt-2 text-[10px] font-semibold leading-4 text-white">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-dashed border-blue-400/40 bg-blue-500/5 p-4 text-center">
          <Upload className="mx-auto size-5 text-blue-300" aria-hidden="true" />
          <p className="mt-2 text-[10px] font-semibold text-slate-200">Quy trình vận hành.pdf</p>
          <p className="mt-1 text-[9px] text-emerald-300">{locale === "en" ? "Ready" : "Sẵn sàng"}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/75 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-200">
            <Check className="size-3.5 text-emerald-300" aria-hidden="true" />
            {locale === "en" ? "Answer verified" : "Câu trả lời đã kiểm tra"}
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800">
            <div className="h-full w-4/5 rounded-full bg-blue-500" />
          </div>
          <p className="mt-3 text-[9px] leading-4 text-slate-500">
            {locale === "en" ? "Source · page 12 · section 3" : "Nguồn · trang 12 · mục 3"}
          </p>
        </div>
      </div>
    </ProductFrame>
  );
}

function PreviewForSection({ section, locale }: { readonly section: PublicInfoSection; readonly locale: Locale }) {
  switch (section) {
    case "product":
      return <DashboardPreview locale={locale} />;
    case "principles":
      return <TrustPreview locale={locale} />;
    case "capabilities":
      return <CapabilitiesPreview locale={locale} />;
    case "workflow":
      return <WorkflowPreview locale={locale} />;
  }
}

export function ProductInterfacePreview({
  section,
  locale,
}: {
  readonly section: PublicInfoSection;
  readonly locale: Locale;
}) {
  const copy = (locale === "en" ? englishCopy : vietnameseCopy)[section];

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-12">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
              {copy.eyebrow}
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              {copy.title}
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">{copy.description}</p>
            <div data-testid="preview-purpose" className="mt-7 rounded-2xl border border-blue-400/25 bg-blue-500/10 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
                {copy.purposeLabel}
              </p>
              <p className="mt-3 text-sm font-medium leading-7 text-slate-100">{copy.purpose}</p>
            </div>
            <ul className="mt-6 space-y-3">
              {copy.benefits.map((benefit) => (
                <li key={benefit} className="flex gap-3 text-sm leading-6 text-slate-300">
                  <Check className="mt-1 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
          <div data-product-preview={copy.preview} aria-label={copy.eyebrow}>
            <PreviewForSection section={section} locale={locale} />
          </div>
        </div>
      </div>
    </section>
  );
}
