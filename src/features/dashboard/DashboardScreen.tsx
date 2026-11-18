"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  GitCompareArrows,
  Layers,
  MessageSquareText,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge } from "@/components/ui";
import {
  IconTile,
  PageIntro,
  SectionHeading,
  WorkspacePage,
  type IconTone,
} from "@/components/workspace/WorkspacePrimitives";
import type {
  DocumentSummaryView,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import { DashboardHeroShowcase } from "./DashboardHeroShowcase";
import { DashboardSourceDrawer } from "./DashboardSourceDrawer";

type DashboardScreenProps = Readonly<{
  spaces: readonly SpaceSummaryView[];
  documents: readonly DocumentSummaryView[];
}>;

type QueueFilter = "recent" | "attention";

type FeatureToolCard = Readonly<{
  id: string;
  href: string;
  title: string;
  description: string;
  meta: string;
  badge: string;
  badgeVariant: "neutral" | "info" | "success" | "warning" | "danger";
  tone: IconTone;
  icon: typeof Search;
}>;

const statusVariantMap = {
  ready: "success",
  failed: "danger",
  uploading: "info",
  validating: "warning",
  extracting: "info",
  ocr: "warning",
  indexing: "info",
} as const;

const DASHBOARD_COPY = {
  vi: {
    eyebrow: "Workspace Overview · Ready-Only",
    title: "Tổng quan không gian tri thức",
    description: (docCount: number, spaceCount: number) =>
      `Theo dõi trạng thái chỉ mục trên ${docCount} tài liệu thuộc ${spaceCount} không gian, truy vấn nhanh nguồn Sẵn sàng hoặc mở trực tiếp các công cụ xử lý.`,
    actionCompare: "So sánh Diff",
    actionUpload: "Tải tài liệu",
    actionChat: "Mở Trợ lý AI",
    statReadyTitle: "Tài liệu Sẵn sàng",
    statReadySub: "Đủ điều kiện hỏi đáp & tìm kiếm",
    statSpacesTitle: "Không gian tri thức",
    statProcessingTitle: "Đang xử lý / OCR",
    statProcessingSub: "Chưa đưa vào nguồn AI",
    statAttentionTitle: "Cần rà soát / Lỗi",
    statAttentionSub: "Hết hiệu lực, lỗi hoặc chờ duyệt",
    toolsTitle: "Tiện ích & tính năng chính",
    toolsDesc: "Mở nhanh từng tác vụ AI, bộ lọc tìm kiếm hoặc quản trị tài liệu trong workspace.",
    toolsOpenAll: "Mở Tiện ích AI →",
    spacesTitle: "Không gian tri thức",
    spacesDesc: "Tỉ lệ tài liệu đạt trạng thái Sẵn sàng trong từng không gian.",
    spacesOpenAll: "Quản lý thư viện →",
    spaceReadyCount: (ready: number, total: number) => `${ready}/${total} Sẵn sàng`,
    queueTitle: "Tài liệu & trạng thái xử lý",
    queueDesc: "Bấm vào từng tệp để mở ngăn xem nhanh chi tiết và kiểm chứng nguồn.",
    tabRecent: "Gần đây",
    tabAttention: (count: number) => `Cần rà soát (${count})`,
    queueEmptyAttention: "Không có tệp nào đang lỗi hoặc chờ rà soát.",
    shortcutsTitle: "Thông báo & tài khoản",
    notifTitle: "Trung tâm thông báo xử lý tệp",
    notifDesc: "Theo dõi sự kiện hoàn tất OCR, lập chỉ mục và cảnh báo nguồn.",
    notifBadge: "Mở hộp tin",
    profileTitle: "Hồ sơ, giao diện & bảo mật",
    profileDesc: "Kiểm tra phiên đăng nhập, ngôn ngữ hiển thị và nhật ký bảo mật.",
    profileBadge: "Cấu hình",
    buildToolCards: ({
      readyCount,
      docCount,
      compareLeft,
      compareRight,
    }: {
      readyCount: number;
      docCount: number;
      compareLeft: string;
      compareRight: string;
    }): FeatureToolCard[] => [
      {
        id: "chat",
        href: "/chat",
        title: "Hỏi đáp Trợ lý AI",
        description: "Đặt câu hỏi theo từng không gian phòng ban kèm trích dẫn đoạn nguồn.",
        meta: "Phạm vi: HR · Vận hành · Atlas",
        badge: "AI Chat",
        badgeVariant: "info",
        tone: "blue",
        icon: MessageSquareText,
      },
      {
        id: "search",
        href: "/search",
        title: "Tìm kiếm toàn văn",
        description: "Tra cứu từ khóa, lọc theo không gian tri thức và định dạng PDF/DOCX/MD.",
        meta: `${readyCount} tài liệu Sẵn sàng`,
        badge: "Sẵn sàng",
        badgeVariant: "success",
        tone: "slate",
        icon: Search,
      },
      {
        id: "utility",
        href: "/utility",
        title: "Xưởng Tiện ích AI",
        description: "Tóm tắt điều hành, checklist hành động, dịch thuật, báo cáo & soạn email tự động.",
        meta: "5 tác vụ AI + dán text",
        badge: "Tiện ích AI",
        badgeVariant: "success",
        tone: "emerald",
        icon: Sparkles,
      },
      {
        id: "compare",
        href:
          compareLeft && compareRight
            ? `/documents/compare?left=${encodeURIComponent(compareLeft)}&right=${encodeURIComponent(compareRight)}`
            : "/documents/compare",
        title: "So sánh Diff phiên bản",
        description: "Đối chiếu điểm thêm mới và chỉnh sửa giữa hai phiên bản tài liệu.",
        meta: compareLeft && compareRight ? "Sẵn sàng đối chiếu" : "Chọn 2 tài liệu",
        badge: "Diff",
        badgeVariant: "info",
        tone: "violet",
        icon: GitCompareArrows,
      },
      {
        id: "documents",
        href: "/documents",
        title: "Thư viện & Tải tài liệu",
        description: "Duyệt cây không gian, theo dõi pipeline OCR/indexing và tải tệp mới.",
        meta: `${docCount} tệp trong danh mục`,
        badge: "Thư viện",
        badgeVariant: "neutral",
        tone: "amber",
        icon: FolderOpen,
      },
      {
        id: "knowledge",
        href: "/knowledge",
        title: "Thẻ tri thức ADR & OQ",
        description: "Bóc tách Quyết định, Quy định & Câu hỏi mở bằng AI và xác minh chuẩn.",
        meta: "Rút trích & Xác minh",
        badge: "Thẻ tri thức",
        badgeVariant: "info",
        tone: "blue",
        icon: BookOpenCheck,
      },
    ],
  },
  en: {
    eyebrow: "Workspace Overview · Ready-Only",
    title: "Knowledge workspace overview",
    description: (docCount: number, spaceCount: number) =>
      `Monitor index readiness across ${docCount} documents in ${spaceCount} spaces, query Ready sources directly, or launch workspace utilities.`,
    actionCompare: "Compare Diff",
    actionUpload: "Upload file",
    actionChat: "Open AI Chat",
    statReadyTitle: "Ready documents",
    statReadySub: "Indexed for AI Chat & Search",
    statSpacesTitle: "Knowledge spaces",
    statProcessingTitle: "Processing / OCR",
    statProcessingSub: "Excluded from AI answers",
    statAttentionTitle: "Needs review / Failed",
    statAttentionSub: "Expired, failed, or review flagged",
    toolsTitle: "Utilities & core features",
    toolsDesc: "Jump directly into AI workflows, full-text search, version diff, or library tools.",
    toolsOpenAll: "Open AI Utilities →",
    spacesTitle: "Knowledge spaces",
    spacesDesc: "Ready-to-total document count across each department or project space.",
    spacesOpenAll: "Manage library →",
    spaceReadyCount: (ready: number, total: number) => `${ready}/${total} Ready`,
    queueTitle: "Documents & index status",
    queueDesc: "Select any item to inspect metadata, governance flags, and source preview.",
    tabRecent: "Recent",
    tabAttention: (count: number) => `Needs review (${count})`,
    queueEmptyAttention: "No documents currently processing or flagged for review.",
    shortcutsTitle: "Alerts & account",
    notifTitle: "Processing notifications",
    notifDesc: "Track OCR completion, indexing status transitions, and source alerts.",
    notifBadge: "Open inbox",
    profileTitle: "Profile, theme & security",
    profileDesc: "Review active workspace session, locale preferences, and security state.",
    profileBadge: "Settings",
    buildToolCards: ({
      readyCount,
      docCount,
      compareLeft,
      compareRight,
    }: {
      readyCount: number;
      docCount: number;
      compareLeft: string;
      compareRight: string;
    }): FeatureToolCard[] => [
      {
        id: "chat",
        href: "/chat",
        title: "AI Assistant Chat",
        description: "Ask questions scoped by space with grounded inline source citations.",
        meta: "Scopes: HR · Operations · Atlas",
        badge: "AI Chat",
        badgeVariant: "info",
        tone: "blue",
        icon: MessageSquareText,
      },
      {
        id: "search",
        href: "/search",
        title: "Full-Text Search",
        description: "Filter Ready documents by keyword, knowledge space, and file format.",
        meta: `${readyCount} Ready files`,
        badge: "Ready",
        badgeVariant: "success",
        tone: "slate",
        icon: Search,
      },
      {
        id: "utility",
        href: "/utility",
        title: "AI Utilities Studio",
        description: "Run executive summaries, checklists, translations, reports, and email drafts via AI.",
        meta: "5 AI tools + direct paste",
        badge: "AI Utilities",
        badgeVariant: "success",
        tone: "emerald",
        icon: Sparkles,
      },
      {
        id: "compare",
        href:
          compareLeft && compareRight
            ? `/documents/compare?left=${encodeURIComponent(compareLeft)}&right=${encodeURIComponent(compareRight)}`
            : "/documents/compare",
        title: "Version Diff Compare",
        description: "Inspect additions and edits side-by-side across two Ready drafts.",
        meta: compareLeft && compareRight ? "Ready pair available" : "Pick 2 Ready docs",
        badge: "Diff",
        badgeVariant: "info",
        tone: "violet",
        icon: GitCompareArrows,
      },
      {
        id: "documents",
        href: "/documents",
        title: "Document Library & Upload",
        description: "Browse spaces, inspect OCR/indexing queues, and upload local files.",
        meta: `${docCount} files in catalog`,
        badge: "Library",
        badgeVariant: "neutral",
        tone: "amber",
        icon: FolderOpen,
      },
      {
        id: "knowledge",
        href: "/knowledge",
        title: "ADR & Open Questions",
        description: "Extract architecture decisions, rules, and open questions with AI.",
        meta: "AI Extract & Verify",
        badge: "Knowledge",
        badgeVariant: "info",
        tone: "blue",
        icon: BookOpenCheck,
      },
    ],
  },
} as const;

export function DashboardScreen({ spaces, documents }: DashboardScreenProps) {
  const { locale } = usePreferences();
  const copy = DASHBOARD_COPY[locale];

  const [selectedDoc, setSelectedDoc] = useState<DocumentSummaryView | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("recent");

  const readyDocs = documents.filter((doc) => doc.processing.kind === "ready");
  const processingDocs = documents.filter(
    (doc) =>
      doc.processing.kind !== "ready" && doc.processing.kind !== "failed",
  );
  const attentionDocs = documents.filter(
    (doc) =>
      doc.processing.kind !== "ready" ||
      doc.governance.some(
        (g) => g.kind === "expired" || g.kind === "deprecated" || g.kind === "needs-review",
      ),
  );
  const failedOrExpiredCount = documents.filter(
    (doc) =>
      doc.processing.kind === "failed" ||
      doc.governance.some(
        (g) => g.kind === "expired" || g.kind === "deprecated" || g.kind === "needs-review",
      ),
  ).length;

  const compareLeft = readyDocs[0]?.id ?? "";
  const compareRight = readyDocs[1]?.id ?? "";

  const toolCards = copy.buildToolCards({
    readyCount: readyDocs.length,
    docCount: documents.length,
    compareLeft,
    compareRight,
  });

  const visibleQueueDocs =
    queueFilter === "recent" ? documents.slice(0, 5) : attentionDocs.slice(0, 5);

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description(documents.length, spaces.length)}
        actions={
          <>
            <Link
              href={
                compareLeft && compareRight
                  ? `/documents/compare?left=${encodeURIComponent(compareLeft)}&right=${encodeURIComponent(compareRight)}`
                  : "/documents/compare"
              }
              className="glean-btn glean-btn-secondary glean-btn-sm"
            >
              <GitCompareArrows aria-hidden="true" className="size-3.5" />
              <span>{copy.actionCompare}</span>
            </Link>
            <Link
              href="/documents#upload-demo-heading"
              className="glean-btn glean-btn-secondary glean-btn-sm"
            >
              <FolderOpen aria-hidden="true" className="size-3.5" />
              <span>{copy.actionUpload}</span>
            </Link>
            <Link href="/chat" className="glean-btn glean-btn-cobalt glean-btn-sm">
              <MessageSquareText aria-hidden="true" className="size-3.5" />
              <span>{copy.actionChat}</span>
            </Link>
          </>
        }
      />

      {/* Operational Index Status KPIs */}
      <section aria-label={copy.title} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link
          href="/search"
          className="flex items-start gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-4 transition-colors hover:border-[#C8D2FF] hover:bg-[#FAF9FB]"
        >
          <IconTile icon={CheckCircle2} tone="emerald" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#505A6E]">{copy.statReadyTitle}</p>
            <p className="glean-tabular mt-1 text-xl font-bold text-[#0D1321]">
              {readyDocs.length}/{documents.length}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#505A6E]">{copy.statReadySub}</p>
          </div>
        </Link>

        <Link
          href="/documents"
          className="flex items-start gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-4 transition-colors hover:border-[#C8D2FF] hover:bg-[#FAF9FB]"
        >
          <IconTile icon={Layers} tone="blue" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#505A6E]">{copy.statSpacesTitle}</p>
            <p className="glean-tabular mt-1 text-xl font-bold text-[#0D1321]">
              {spaces.length}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#505A6E]">
              {spaces.map((space) => space.name).join(" · ")}
            </p>
          </div>
        </Link>

        <Link
          href="/documents?processing=ocr"
          className="flex items-start gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-4 transition-colors hover:border-[#C8D2FF] hover:bg-[#FAF9FB]"
        >
          <IconTile icon={Clock3} tone="amber" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#505A6E]">{copy.statProcessingTitle}</p>
            <p className="glean-tabular mt-1 text-xl font-bold text-[#0D1321]">
              {processingDocs.length}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#505A6E]">{copy.statProcessingSub}</p>
          </div>
        </Link>

        <Link
          href="/notifications"
          className="flex items-start gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-4 transition-colors hover:border-[#C8D2FF] hover:bg-[#FAF9FB]"
        >
          <IconTile icon={AlertTriangle} tone="rose" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#505A6E]">{copy.statAttentionTitle}</p>
            <p className="glean-tabular mt-1 text-xl font-bold text-[#0D1321]">
              {failedOrExpiredCount}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#505A6E]">{copy.statAttentionSub}</p>
          </div>
        </Link>
      </section>

      {/* Interactive Quick Ask AI & Ready-Only Filter Bar */}
      <DashboardHeroShowcase
        spaces={spaces}
        documents={documents}
        onSelectDocument={setSelectedDoc}
      />

      {/* Functional Utilities & Workspace Modules */}
      <section aria-labelledby="dashboard-tools-heading">
        <SectionHeading
          id="dashboard-tools-heading"
          title={copy.toolsTitle}
          description={copy.toolsDesc}
          action={
            <Link href="/utility" className="glean-btn glean-btn-secondary glean-btn-sm">
              <span>{copy.toolsOpenAll}</span>
            </Link>
          }
        />

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {toolCards.map((card) => (
            <Link
              key={card.id}
              href={card.href}
              className="group flex flex-col justify-between gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-4 transition-colors hover:border-[#1B44FF] hover:bg-[#F7F9FF]"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <IconTile icon={card.icon} tone={card.tone} className="size-10 rounded-xl" />
                  <Badge variant={card.badgeVariant} size="sm">
                    {card.badge}
                  </Badge>
                </div>
                <h3 className="mt-3.5 text-sm font-bold text-[#0D1321] group-hover:text-[#1635C7]">
                  {card.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#505A6E]">{card.description}</p>
              </div>
              <div className="flex items-center justify-between border-t border-[#0D1321]/8 pt-2.5 text-[11px] font-medium text-[#323B4D]">
                <span>{card.meta}</span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-3.5 text-[#505A6E] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1635C7]"
                />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Operational Data Panels: Spaces Readiness + Document Index Queue */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#0D1321]/10 bg-white p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#0D1321]">{copy.spacesTitle}</h2>
                <p className="mt-0.5 text-xs text-[#505A6E]">{copy.spacesDesc}</p>
              </div>
              <Link
                href="/documents"
                className="shrink-0 text-xs font-semibold text-[#1635C7] hover:underline"
              >
                {copy.spacesOpenAll}
              </Link>
            </div>

            <div className="space-y-2.5">
              {spaces.map((space) => {
                const readyInSpace = documents.filter(
                  (doc) => doc.space.id === space.id && doc.processing.kind === "ready",
                ).length;
                return (
                  <Link
                    key={space.id}
                    href={`/documents/spaces/${space.id}`}
                    className="glean-mini-row"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#ECF2FF] text-[#1945C2]">
                        <Layers aria-hidden="true" className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-[#0D1321]">
                          {space.name}
                        </strong>
                        <span className="block truncate text-xs text-[#505A6E]">
                          {space.description}
                        </span>
                      </span>
                    </span>
                    <Badge
                      variant={readyInSpace > 0 ? "success" : "warning"}
                      size="sm"
                      className="glean-tabular shrink-0"
                    >
                      {copy.spaceReadyCount(readyInSpace, space.documentCount)}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-[#0D1321]/10 bg-white p-5">
            <h2 className="mb-3 text-base font-bold text-[#0D1321]">{copy.shortcutsTitle}</h2>
            <div className="space-y-2.5">
              <Link href="/notifications" className="glean-mini-row">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#ECF2FF] text-[#1945C2]">
                    <Bell aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold text-[#0D1321]">
                      {copy.notifTitle}
                    </strong>
                    <span className="block truncate text-xs text-[#505A6E]">
                      {copy.notifDesc}
                    </span>
                  </span>
                </span>
                <Badge variant="info" size="sm" className="shrink-0">
                  {copy.notifBadge}
                </Badge>
              </Link>

              <Link href="/profile" className="glean-mini-row">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F8] text-[#323B4D]">
                    <UserRound aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold text-[#0D1321]">
                      {copy.profileTitle}
                    </strong>
                    <span className="block truncate text-xs text-[#505A6E]">
                      {copy.profileDesc}
                    </span>
                  </span>
                </span>
                <Badge variant="neutral" size="sm" className="shrink-0">
                  {copy.profileBadge}
                </Badge>
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Recent & Attention Document Queue */}
        <div className="rounded-2xl border border-[#0D1321]/10 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#0D1321]">{copy.queueTitle}</h2>
              <p className="mt-0.5 text-xs text-[#505A6E]">{copy.queueDesc}</p>
            </div>

            <div className="inline-flex rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] p-0.5">
              <button
                type="button"
                onClick={() => setQueueFilter("recent")}
                aria-pressed={queueFilter === "recent"}
                className={`min-h-7 rounded-full px-3 text-xs font-medium transition-colors ${
                  queueFilter === "recent"
                    ? "bg-white font-semibold text-[#1635C7] shadow-2xs"
                    : "text-[#505A6E] hover:text-[#0D1321]"
                }`}
              >
                {copy.tabRecent}
              </button>
              <button
                type="button"
                onClick={() => setQueueFilter("attention")}
                aria-pressed={queueFilter === "attention"}
                className={`min-h-7 rounded-full px-3 text-xs font-medium transition-colors ${
                  queueFilter === "attention"
                    ? "bg-white font-semibold text-[#1635C7] shadow-2xs"
                    : "text-[#505A6E] hover:text-[#0D1321]"
                }`}
              >
                {copy.tabAttention(attentionDocs.length)}
              </button>
            </div>
          </div>

          {visibleQueueDocs.length > 0 ? (
            <div className="space-y-2.5">
              {visibleQueueDocs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedDoc(doc)}
                  className="glean-mini-row"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
                        doc.fileType === "pdf"
                          ? "bg-[#FDECEC] text-[#B32018]"
                          : doc.fileType === "docx"
                            ? "bg-[#ECF2FF] text-[#1945C2]"
                            : "bg-[#F3F4F8] text-[#323B4D]"
                      }`}
                    >
                      <FileText aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-[#0D1321]">
                        {doc.name}
                      </strong>
                      <span className="block truncate text-xs text-[#505A6E]">
                        {doc.space.name} · {doc.updatedLabel}
                      </span>
                    </span>
                  </span>
                  <Badge
                    variant={statusVariantMap[doc.processing.kind]}
                    size="sm"
                    className="shrink-0"
                  >
                    {doc.processing.label}
                  </Badge>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-[#0D1321]/15 bg-[#FAF9FB] px-4 py-6 text-center text-xs text-[#505A6E]">
              {copy.queueEmptyAttention}
            </p>
          )}
        </div>
      </section>

      <DashboardSourceDrawer
        document={selectedDoc}
        onClose={() => setSelectedDoc(null)}
      />
    </WorkspacePage>
  );
}
