import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  FileText,
  FolderOpen,
  GitCompareArrows,
  Minus,
  Plus,
  ShieldQuestion,
  UserRound,
} from "lucide-react";

import { Badge, Card } from "@/components/ui";
import { DocumentFilePicker } from "@/components/workspace/DocumentFilePicker";
import {
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import {
  DocumentDetailActions,
  DocumentRowQuickActions,
} from "@/features/documents/DocumentLibraryActions";
import {
  DocumentIdentity,
  GovernanceBadges,
  ProcessingStatus,
} from "@/features/documents/DocumentPresentation";
import type {
  CompareInput,
  CompareOutcome,
  DocumentLookupOutcome,
  DocumentSummaryView,
  SpaceLookupOutcome,
  SpaceSummaryView,
} from "@/features/knowledge/model";

export function DocumentDetailScreen({
  outcome,
  spaces = [],
}: {
  outcome: DocumentLookupOutcome;
  spaces?: readonly SpaceSummaryView[];
}) {
  if (outcome.kind === "unavailable") {
    return (
      <UnavailableRoute
        title="Không thể mở tài liệu"
        reason={outcome.reason}
      />
    );
  }

  const { document } = outcome;
  const sections =
    document.sections && document.sections.length > 0
      ? document.sections
      : document.preview.kind === "fixture-excerpt"
        ? [
            {
              id: "preview-0",
              heading: document.preview.heading,
              locator: document.preview.locator,
              content: document.preview.excerpt,
            },
          ]
        : [];

  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro
        eyebrow={`Chi tiết tài liệu · ${document.space.name}`}
        title={document.name}
        description={`${document.detail} · Toàn bộ các đoạn nội dung đã bóc tách dưới đây được dùng làm nguồn truy vấn cho Tìm kiếm & Trợ lý AI.`}
        actions={
          <Badge variant={document.processing.kind === "ready" ? "success" : "warning"}>
            {document.processing.label}
          </Badge>
        }
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section
            aria-labelledby="preview-heading"
            className="rounded-2xl border border-[#0D1321]/10 bg-white p-5 shadow-[0_8px_20px_-8px_rgba(11,18,32,0.08)] sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1635C7]">
                Nội dung đã bóc tách & lập chỉ mục ({sections.length} đoạn)
              </p>
              <Badge variant="neutral">{document.versionLabel}</Badge>
            </div>

            {sections.length > 0 ? (
              <div id="preview-heading" className="mt-4 space-y-4">
                {sections.map((section) => (
                  <article
                    key={section.id}
                    className="rounded-2xl border border-[#0D1321]/8 bg-[#FAF9FB] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-bold text-[#0D1321]">
                        {section.heading}
                      </h2>
                      <Badge variant="info" size="sm">
                        {section.locator}
                      </Badge>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap text-sm leading-7 text-[#323B4D]">
                      {section.content}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-[#F6D59B] bg-[#FFF9EF] p-5">
                <h2
                  id="preview-heading"
                  className="flex items-center gap-2 font-semibold text-[#924D05]"
                >
                  <CircleAlert aria-hidden="true" className="size-4" />
                  Chưa có văn bản bóc tách
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#323B4D]">
                  {document.preview.kind === "unavailable"
                    ? document.preview.reason
                    : "Tài liệu không chứa đoạn văn bản khả dụng."}
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="versions-heading">
            <SectionHeading
              id="versions-heading"
              title="Lịch sử phiên bản"
              description="Các mốc phiên bản được ghi nhận khi tải lên hoặc cập nhật."
            />
            {document.versions.length ? (
              <ul className="mt-3 space-y-2">
                {document.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#0D1321]/10 bg-white px-4 py-3 text-sm"
                  >
                    <span className="font-semibold text-[#0D1321]">{version.label}</span>
                    <span className="glean-tabular text-[#505A6E]">
                      {version.updatedLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-[#0D1321]/16 bg-white p-5 text-sm text-[#505A6E]">
                Chưa có bản ghi lịch sử phiên bản bổ sung.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-bold text-[#0D1321]">Thông tin & thuộc tính</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <Meta icon={FolderOpen} label="Không gian">
                <Link
                  href={`/documents/spaces/${document.space.id}`}
                  className="inline-flex min-h-8 items-center font-semibold text-[#1635C7] hover:underline"
                >
                  {document.space.name}
                </Link>
              </Meta>
              <Meta icon={UserRound} label="Người tải lên">
                {document.ownerLabel}
              </Meta>
              <Meta icon={CalendarDays} label="Cập nhật gần nhất">
                {document.updatedLabel}
              </Meta>
            </dl>
            <div className="mt-5 space-y-2 border-t border-[#0D1321]/8 pt-4">
              <ProcessingStatus document={document} />
              <GovernanceBadges document={document} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-[#0D1321]">Thao tác tài liệu</h2>
            <p className="mt-1 text-xs leading-5 text-[#505A6E]">
              Tải xuống tệp gốc, hỏi AI, cập nhật kiểm duyệt hoặc di chuyển không gian.
            </p>
            <DocumentDetailActions document={document} spaces={spaces} />
            <Link
              href={`/documents/compare?left=${encodeURIComponent(document.id)}`}
              className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[#1635C7] hover:underline"
            >
              <GitCompareArrows aria-hidden="true" className="size-4" />
              Chọn tài liệu khác để so sánh
            </Link>
          </Card>
        </aside>
      </div>
    </WorkspacePage>
  );
}

export function SpaceScreen({ outcome }: { outcome: SpaceLookupOutcome }) {
  if (outcome.kind === "unavailable") {
    return (
      <UnavailableRoute
        title="Không thể mở không gian tri thức"
        reason={outcome.reason}
      />
    );
  }

  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro
        eyebrow="Không gian tri thức"
        title={outcome.space.name}
        description={outcome.space.description}
        actions={
          <Badge variant="info">{outcome.space.documentCount} tài liệu</Badge>
        }
      />

      <div className="mt-6">
        <DocumentFilePicker
          spaces={[outcome.space]}
          defaultSpaceId={outcome.space.id}
        />
      </div>

      <section aria-labelledby="space-documents-heading" className="mt-8">
        <SectionHeading
          id="space-documents-heading"
          title="Tài liệu trong không gian này"
          description="Các tài liệu được dùng trực tiếp khi lọc hoặc hỏi AI theo không gian."
        />
        {outcome.documents.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {outcome.documents.map((document) => (
              <li key={document.id}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <DocumentIdentity document={document} />
                    <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                      <ProcessingStatus document={document} />
                      <DocumentRowQuickActions document={document} />
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-[#0D1321]/18 bg-white p-8 text-center">
            <h3 className="text-base font-bold text-[#0D1321]">
              Không gian này chưa có tài liệu nào
            </h3>
            <p className="mt-2 text-sm text-[#505A6E]">
              Kéo thả hoặc chọn tệp ở khung tải lên phía trên để đưa tài liệu vào không gian{" "}
              <strong>{outcome.space.name}</strong>.
            </p>
          </div>
        )}
      </section>
    </WorkspacePage>
  );
}

export function CompareScreen({
  input,
  outcome,
  readyDocuments,
}: {
  input: CompareInput;
  outcome: CompareOutcome;
  readyDocuments: readonly DocumentSummaryView[];
}) {
  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro
        eyebrow="Đối chiếu phiên bản · Trợ lý AI"
        title="So sánh hai tài liệu"
        description="Chọn hai tài liệu Sẵn sàng để hệ thống AI phân tích và liệt kê các điểm bổ sung, sửa đổi hoặc lược bỏ giữa hai văn bản."
      />

      <form
        action="/documents/compare"
        method="get"
        className="mt-6 grid gap-4 rounded-2xl border border-[#0D1321]/10 bg-white p-4 shadow-[0_8px_20px_-8px_rgba(11,18,32,0.08)] sm:p-5 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-end"
      >
        <CompareSelect
          name="left"
          label="Tài liệu gốc (bên trái)"
          value={input.leftId ?? ""}
          documents={readyDocuments}
        />
        <GitCompareArrows
          aria-hidden="true"
          className="hidden size-5 text-[#505A6E] lg:mb-3 lg:block"
        />
        <CompareSelect
          name="right"
          label="Tài liệu đối chiếu (bên phải)"
          value={input.rightId ?? ""}
          documents={readyDocuments}
        />
        <button
          type="submit"
          disabled={readyDocuments.length < 2}
          className="min-h-11 rounded-full bg-[#1B44FF] px-5 text-sm font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Phân tích khác biệt
        </button>
      </form>

      <div className="mt-6">
        <CompareOutcomeView outcome={outcome} readyCount={readyDocuments.length} />
      </div>
    </WorkspacePage>
  );
}

function CompareOutcomeView({
  outcome,
  readyCount,
}: {
  outcome: CompareOutcome;
  readyCount: number;
}) {
  if (readyCount < 2 && outcome.kind === "selection") {
    return (
      <CompareState title="Cần ít nhất 2 tài liệu Sẵn sàng để so sánh">
        Hãy{" "}
        <Link href="/documents" className="font-semibold text-[#1635C7] hover:underline">
          tải lên thêm tài liệu
        </Link>{" "}
        vào thư viện trước khi chạy đối chiếu hai phiên bản.
      </CompareState>
    );
  }
  if (outcome.kind === "selection") {
    return (
      <CompareState title="Chọn hai tài liệu Sẵn sàng">
        Chọn hai tài liệu ở biểu mẫu phía trên rồi bấm &ldquo;Phân tích khác biệt&rdquo;.
      </CompareState>
    );
  }
  if (outcome.kind === "invalid") {
    return <CompareState title="Lựa chọn chưa hợp lệ">{outcome.reason}</CompareState>;
  }
  if (outcome.kind === "unavailable") {
    return <CompareState title="Không thể so sánh">{outcome.reason}</CompareState>;
  }

  const differenceIcon = { added: Plus, changed: Check, removed: Minus } as const;
  const differenceLabel = {
    added: "Bổ sung ở tài liệu phải",
    changed: "Thay đổi nội dung",
    removed: "Chỉ có ở tài liệu trái",
  } as const;

  return (
    <section aria-labelledby="diff-heading">
      <SectionHeading
        id="diff-heading"
        title="Kết quả phân tích khác biệt"
        description={`${outcome.left.name} ↔ ${outcome.right.name}`}
      />
      <ol className="mt-3 space-y-3">
        {outcome.differences.map((difference) => {
          const Icon = differenceIcon[difference.kind];
          return (
            <li
              key={`${difference.kind}-${difference.heading}`}
              className="rounded-2xl border border-[#0D1321]/10 bg-white p-4 sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1635C7]">
                    {differenceLabel[difference.kind]}
                  </p>
                  <h3 className="mt-1 font-bold text-[#0D1321]">{difference.heading}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#505A6E]">
                    {difference.description}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CompareSelect({
  name,
  label,
  value,
  documents,
}: {
  name: string;
  label: string;
  value: string;
  documents: readonly DocumentSummaryView[];
}) {
  return (
    <label className="text-xs font-semibold text-[#323B4D]">
      {label}
      <select
        name={name}
        required
        defaultValue={value}
        className="mt-2 h-11 w-full rounded-xl border border-[#0D1321]/16 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:ring-2 focus:ring-[#1B44FF]/25"
      >
        <option value="" disabled>
          {documents.length === 0 ? "Chưa có tài liệu nào" : "Chọn tài liệu Sẵn sàng"}
        </option>
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-[#0D1321]/18 bg-white px-6 py-10 text-center">
      <GitCompareArrows aria-hidden="true" className="mx-auto size-8 text-[#1945C2]" />
      <h2 className="mt-3 font-bold text-[#0D1321]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
        {children}
      </p>
    </section>
  );
}

function UnavailableRoute({ title, reason }: { title: string; reason: string }) {
  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <section className="mt-4 rounded-2xl border border-[#0D1321]/10 bg-white px-5 py-12 text-center sm:px-8">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-[#F6D59B] bg-[#FFF3DE] text-[#924D05]">
          <ShieldQuestion aria-hidden="true" className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-[#0D1321]">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
          {reason}
        </p>
      </section>
    </WorkspacePage>
  );
}

function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#0D1321]/10 bg-white px-3.5 text-xs font-semibold text-[#323B4D] transition-colors hover:bg-[#F3F4F8] hover:text-[#0D1321]"
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      {children}
    </Link>
  );
}

function Meta({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof FileText;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#1945C2]" />
      <div>
        <dt className="text-xs text-[#505A6E]">{label}</dt>
        <dd className="mt-1 font-medium text-[#0D1321]">{children}</dd>
      </div>
    </div>
  );
}
