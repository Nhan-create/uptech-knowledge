import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileText,
  FolderOpen,
  GitCompareArrows,
  Layers,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge, Card } from "@/components/ui";
import { DocumentFilePicker } from "@/components/workspace/DocumentFilePicker";
import {
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import {
  CreateSpaceButton,
  DocumentRowQuickActions,
} from "@/features/documents/DocumentLibraryActions";
import {
  DocumentIdentity,
  ProcessingStatus,
} from "@/features/documents/DocumentPresentation";
import type {
  DocumentListInput,
  DocumentListOutcome,
  ProcessingKind,
  SpaceSummaryView,
} from "@/features/knowledge/model";

const processingFilters: readonly { value: ProcessingKind; label: string }[] = [
  { value: "ready", label: "Sẵn sàng" },
  { value: "uploading", label: "Đang tải lên" },
  { value: "extracting", label: "Đang đọc nội dung" },
  { value: "ocr", label: "Đang OCR" },
  { value: "indexing", label: "Đang lập chỉ mục" },
  { value: "failed", label: "Thất bại" },
];

type Props = {
  input: DocumentListInput;
  outcome: DocumentListOutcome;
  spaces: readonly SpaceSummaryView[];
  totalDocumentCount: number;
  readyDocumentCount: number;
  totalChunkCount: number;
  legacyLinkUnavailable: boolean;
};

export function DocumentLibraryScreen({
  input,
  outcome,
  spaces,
  totalDocumentCount,
  readyDocumentCount,
  totalChunkCount,
  legacyLinkUnavailable,
}: Props) {
  const documents = outcome.kind === "ready" ? outcome.documents : [];
  const hasActiveFilter = Boolean(
    input.query.trim() || input.spaceId || input.processing || input.fileType,
  );

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Thư viện tri thức · Dữ liệu thật"
        title="Tài liệu & không gian tri thức"
        description="Tải lên tài liệu nội bộ (PDF, DOCX, Markdown, TXT, CSV, JSON) để hệ thống bóc tách nội dung, lập chỉ mục cho Tìm kiếm, Trợ lý AI và đối chiếu phiên bản."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/documents/compare"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:text-[#1635C7]"
            >
              <GitCompareArrows aria-hidden="true" className="size-4" />
              So sánh 2 tài liệu
            </Link>
            <Link
              href="/chat"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0B1220] px-4 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#172136]"
            >
              <Sparkles aria-hidden="true" className="size-4" />
              Mở Trợ lý AI
            </Link>
          </div>
        }
      />

      {/* Compact Real Metrics Strip */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          icon={FileText}
          label="Tổng tài liệu thật"
          value={String(totalDocumentCount)}
          tone="blue"
        />
        <MetricTile
          icon={CheckCircle2}
          label="Sẵn sàng cho AI"
          value={String(readyDocumentCount)}
          tone="emerald"
        />
        <MetricTile
          icon={Database}
          label="Đoạn đã lập chỉ mục"
          value={String(totalChunkCount)}
          tone="violet"
        />
        <MetricTile
          icon={Layers}
          label="Không gian tri thức"
          value={String(spaces.length)}
          tone="slate"
        />
      </div>

      {legacyLinkUnavailable ? (
        <aside className="mt-4 rounded-xl border border-[#F6D59B] bg-[#FFF9EF] px-4 py-3 text-sm leading-6 text-[#924D05]">
          Liên kết tài liệu trước đó không còn tồn tại trong kho tri thức hoặc đã bị xóa.
        </aside>
      ) : null}

      {/* Real Drag-and-Drop & Multi-File Uploader */}
      <div className="mt-6">
        <DocumentFilePicker spaces={spaces} defaultSpaceId={input.spaceId} />
      </div>

      {/* Knowledge Spaces Grid */}
      <section aria-labelledby="spaces-heading" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading
            id="spaces-heading"
            title="Không gian tri thức"
            description="Phân loại tài liệu theo phòng ban hoặc dự án để kiểm soát phạm vi hỏi đáp AI."
          />
          <CreateSpaceButton />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {spaces.map((space) => {
            const isSelected = input.spaceId === space.id;
            return (
              <Card
                key={space.id}
                className={
                  isSelected
                    ? "border-[#1B44FF] bg-[#F7F9FF] p-5 ring-2 ring-[#1B44FF]/15"
                    : "p-5 transition-colors hover:border-[#C8D2FF]"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]">
                    <FolderOpen aria-hidden="true" className="size-5" />
                  </span>
                  <Badge variant={space.documentCount > 0 ? "info" : "neutral"} size="sm">
                    {space.documentCount} tài liệu
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-bold text-[#0D1321]">{space.name}</h3>
                <p className="mt-1 min-h-10 text-sm leading-5 text-[#505A6E]">
                  {space.description}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/documents/spaces/${space.id}`}
                    className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-[#1635C7] hover:underline"
                  >
                    Mở không gian <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                  <Link
                    href={isSelected ? "/documents" : `/documents?space=${space.id}`}
                    className="inline-flex min-h-9 items-center text-xs font-medium text-[#505A6E] hover:text-[#0D1321]"
                  >
                    {isSelected ? "Bỏ lọc" : "Lọc thư viện"}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Filter & Document List */}
      <section aria-labelledby="library-heading" className="mt-8">
        <SectionHeading
          id="library-heading"
          title="Danh sách tài liệu"
          description="Mọi tài liệu bạn tải lên đều có thể xem toàn văn, tải xuống, so sánh phiên bản và truy vấn qua Trợ lý AI."
        />

        <form
          action="/documents"
          method="get"
          className="mt-3 mb-4 grid gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-3.5 shadow-[0_8px_20px_-10px_rgba(11,18,32,0.08)] sm:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_12rem_11rem_10rem_auto]"
        >
          <label className="relative min-w-0">
            <span className="sr-only">Tìm kiếm theo tên tài liệu</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#505A6E]"
            />
            <input
              name="document-query"
              type="search"
              defaultValue={input.query}
              placeholder="Lọc theo tên tệp, mô tả hoặc không gian…"
              className="h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] pl-10 pr-3 text-sm text-[#0D1321] outline-none placeholder:text-[#505A6E] focus:border-[#1B44FF] focus:bg-white focus:ring-2 focus:ring-[#1B44FF]/20"
            />
          </label>
          <FilterSelect name="space" label="Không gian" value={input.spaceId ?? ""}>
            <option value="">Mọi không gian</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect name="status" label="Trạng thái" value={input.processing ?? ""}>
            <option value="">Mọi trạng thái</option>
            {processingFilters.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect name="type" label="Loại tệp" value={input.fileType ?? ""}>
            <option value="">Mọi loại tệp</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="md">Markdown / Text</option>
          </FilterSelect>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-full bg-[#0B1220] px-5 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#172136]"
            >
              Áp dụng
            </button>
            {hasActiveFilter ? (
              <Link
                href="/documents"
                className="inline-flex h-10 items-center justify-center rounded-full border border-[#0D1321]/14 bg-white px-3.5 text-xs font-semibold text-[#505A6E] hover:text-[#0D1321]"
              >
                Xóa lọc
              </Link>
            ) : null}
          </div>
        </form>

        {outcome.kind === "invalid" ? (
          <LibraryState title="Bộ lọc không hợp lệ">
            Trường không hợp lệ: {outcome.fields.join(", ")}.{" "}
            <Link href="/documents" className="font-semibold text-[#1635C7] hover:underline">
              Đặt lại bộ lọc
            </Link>
            .
          </LibraryState>
        ) : outcome.kind === "empty" ? (
          hasActiveFilter ? (
            <LibraryState title="Không tìm thấy tài liệu phù hợp bộ lọc">
              Thử từ khóa khác hoặc{" "}
              <Link href="/documents" className="font-semibold text-[#1635C7] hover:underline">
                xóa toàn bộ bộ lọc
              </Link>
              .
            </LibraryState>
          ) : (
            <LibraryState title="Kho tri thức đang trống — chưa có tài liệu nào">
              Hãy kéo thả hoặc chọn tệp PDF, DOCX, Markdown, TXT, CSV hoặc JSON ở khung tải
              lên phía trên để bắt đầu lập chỉ mục dữ liệu thật của bạn.
            </LibraryState>
          )
        ) : (
          <ul className="space-y-3" aria-label="Danh sách tài liệu trong thư viện">
            {documents.map((document) => (
              <li key={document.id}>
                <Card className="p-4 transition-colors hover:border-[#C8D2FF] sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <DocumentIdentity document={document} />
                    <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                      <ProcessingStatus document={document} />
                      <DocumentRowQuickActions document={document} />
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-[#0D1321]/8 pt-3 text-xs text-[#505A6E] sm:grid-cols-3">
                    <div>
                      <dt>Không gian</dt>
                      <dd className="mt-1 font-medium text-[#0D1321]">
                        <Link
                          href={`/documents/spaces/${document.space.id}`}
                          className="hover:text-[#1635C7] hover:underline"
                        >
                          {document.space.name}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt>Người tải lên</dt>
                      <dd className="mt-1 font-medium text-[#0D1321]">
                        {document.ownerLabel}
                      </dd>
                    </div>
                    <div>
                      <dt>Cập nhật</dt>
                      <dd className="glean-tabular mt-1 font-medium text-[#0D1321]">
                        {document.updatedLabel}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspacePage>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone,
}: Readonly<{
  icon: typeof FileText;
  label: string;
  value: string;
  tone: "blue" | "emerald" | "violet" | "slate";
}>) {
  const toneClass = {
    blue: "border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]",
    emerald: "border-[#BBEAD2] bg-[#E7F7EF] text-[#076944]",
    violet: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
    slate: "border-[#0D1321]/10 bg-[#F3F4F8] text-[#323B4D]",
  }[tone];

  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[#505A6E]">{label}</p>
        <p className="glean-tabular mt-0.5 text-xl font-bold text-[#0D1321]">{value}</p>
      </div>
    </Card>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm text-[#0D1321] outline-none focus:border-[#1B44FF] focus:ring-2 focus:ring-[#1B44FF]/20"
      >
        {children}
      </select>
    </label>
  );
}

function LibraryState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#0D1321]/18 bg-white p-8 text-center">
      <h3 className="text-base font-bold text-[#0D1321]">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
        {children}
      </p>
    </div>
  );
}
