import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
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
import {
  DemoNotice,
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
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
} from "@/features/knowledge/model";

export function DocumentDetailScreen({ outcome }: { outcome: DocumentLookupOutcome }) {
  if (outcome.kind === "unavailable") {
    return <UnavailableRoute title="Không thể mở tài liệu fixture" reason={outcome.reason} />;
  }

  const { document } = outcome;
  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro
        eyebrow="Document detail · Fixture"
        title={document.name}
        description="Route dùng ID opaque và đọc từ adapter fixture. Nội dung, trạng thái và nhãn dưới đây chưa được backend hay ACL xác nhận."
        actions={<Badge variant={document.processing.kind === "ready" ? "success" : "warning"}>{document.processing.label}</Badge>}
      />
      <DemoNotice className="mt-6" />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <section aria-labelledby="preview-heading" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-400">Preview fixture · không phải nội dung nguồn</p>
            {document.preview.kind === "fixture-excerpt" ? (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 id="preview-heading" className="text-xl font-semibold text-white">{document.preview.heading}</h2>
                  <Badge variant="neutral">{document.preview.locator}</Badge>
                </div>
                <blockquote className="mt-5 border-l-2 border-blue-500 pl-4 text-base leading-8 text-slate-200">{document.preview.excerpt}</blockquote>
              </>
            ) : (
              <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/25 p-5">
                <h2 id="preview-heading" className="flex items-center gap-2 font-semibold text-amber-100"><CircleAlert aria-hidden="true" className="size-4" />Preview không khả dụng</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">{document.preview.reason}</p>
              </div>
            )}
          </section>

          <section aria-labelledby="versions-heading" className="mt-6">
            <SectionHeading id="versions-heading" title="Phiên bản fixture" description="Không có tải xuống, khôi phục hoặc publish vì hợp đồng version chưa được nối." />
            {document.versions.length ? (
              <ul className="space-y-2">
                {document.versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/55 px-4 py-3 text-sm"><span className="font-medium text-slate-200">{version.label}</span><span className="tabular-nums text-slate-400">{version.updatedLabel}</span></li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">Không có version fixture cho trạng thái này.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold text-white">Thông tin fixture</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <Meta icon={FolderOpen} label="Không gian"><Link href={`/documents/spaces/${document.space.id}`} className="inline-flex min-h-11 items-center text-blue-300 hover:text-blue-200">{document.space.name}</Link></Meta>
              <Meta icon={UserRound} label="Chủ sở hữu fixture">{document.ownerLabel}</Meta>
              <Meta icon={CalendarDays} label="Cập nhật fixture">{document.updatedLabel}</Meta>
            </dl>
            <div className="mt-5 border-t border-slate-800 pt-4"><ProcessingStatus document={document} /><GovernanceBadges document={document} /></div>
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold text-white">Thao tác cần backend</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">Download, verify và publish cần API, quyền và audit trail nên được giữ vô hiệu hóa.</p>
            <div className="mt-4 grid gap-2">
              <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-lg bg-slate-800 px-3 text-sm font-semibold text-slate-500">Tải xuống · chưa kết nối</button>
              <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-lg border border-slate-800 px-3 text-sm font-semibold text-slate-600">Xác minh · chưa kết nối</button>
            </div>
            <Link href={`/documents/compare?left=${document.id}`} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200"><GitCompareArrows aria-hidden="true" className="size-4" />Chọn tài liệu để so sánh</Link>
          </Card>
        </aside>
      </div>
    </WorkspacePage>
  );
}

export function SpaceScreen({ outcome }: { outcome: SpaceLookupOutcome }) {
  if (outcome.kind === "unavailable") {
    return <UnavailableRoute title="Không thể mở không gian fixture" reason={outcome.reason} />;
  }

  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro eyebrow="Knowledge space · Fixture" title={outcome.space.name} description={`${outcome.space.description} Số lượng và thành viên không phải dữ liệu backend.`} actions={<Badge variant="neutral">{outcome.space.documentCount} fixture</Badge>} />
      <DemoNotice className="mt-6" />
      <section aria-labelledby="space-documents-heading" className="mt-8">
        <SectionHeading id="space-documents-heading" title="Tài liệu trong không gian" description="Danh sách lấy từ cùng catalog typed; không khẳng định phạm vi ACL thực." />
        <ul className="space-y-3">
          {outcome.documents.map((document) => (
            <li key={document.id}>
              <Card className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <DocumentIdentity document={document} />
                  <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end"><ProcessingStatus document={document} /><Link href={`/documents/${document.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"><BookOpen aria-hidden="true" className="size-3.5" />Mở chi tiết</Link></div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </WorkspacePage>
  );
}

export function CompareScreen({ input, outcome, readyDocuments }: { input: CompareInput; outcome: CompareOutcome; readyDocuments: readonly DocumentSummaryView[] }) {
  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <PageIntro eyebrow="Document compare · Fixture" title="So sánh hai tài liệu" description="Form dùng ID opaque và chỉ cho chọn tài liệu fixture Sẵn sàng. Diff chỉ tồn tại cho cặp fixture được khai báo; chưa có compare service." />
      <DemoNotice className="mt-6" />

      <form action="/documents/compare" method="get" className="mt-6 grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 sm:p-5 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-end">
        <CompareSelect name="left" label="Tài liệu bên trái" value={input.leftId ?? ""} documents={readyDocuments} />
        <GitCompareArrows aria-hidden="true" className="hidden size-5 text-slate-500 lg:block" />
        <CompareSelect name="right" label="Tài liệu bên phải" value={input.rightId ?? ""} documents={readyDocuments} />
        <button type="submit" className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">So sánh fixture</button>
      </form>

      <CompareOutcomeView outcome={outcome} />
    </WorkspacePage>
  );
}

function CompareOutcomeView({ outcome }: { outcome: CompareOutcome }) {
  if (outcome.kind === "selection") return <CompareState title="Chọn hai tài liệu Sẵn sàng">Adapter chưa chạy compare cho đến khi đủ hai ID.</CompareState>;
  if (outcome.kind === "invalid") return <CompareState title="Lựa chọn không hợp lệ">{outcome.reason}</CompareState>;
  if (outcome.kind === "unavailable") return <CompareState title="Diff không khả dụng">{outcome.reason}</CompareState>;

  const differenceIcon = { added: Plus, changed: Check, removed: Minus } as const;
  const differenceLabel = { added: "Bổ sung", changed: "Thay đổi", removed: "Không có ở tài liệu phải" } as const;
  return (
    <section aria-labelledby="diff-heading" className="mt-8">
      <SectionHeading id="diff-heading" title="Diff fixture có sẵn" description={`${outcome.left.name} ↔ ${outcome.right.name}. Kết quả này không được sinh bởi backend.`} />
      <ol className="space-y-3">
        {outcome.differences.map((difference) => {
          const Icon = differenceIcon[difference.kind];
          return (
            <li key={`${difference.kind}-${difference.heading}`} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-start gap-3"><span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300"><Icon aria-hidden="true" className="size-4" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-300">{differenceLabel[difference.kind]}</p><h3 className="mt-1 font-semibold text-white">{difference.heading}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{difference.description}</p></div></div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CompareSelect({ name, label, value, documents }: { name: string; label: string; value: string; documents: readonly DocumentSummaryView[] }) {
  return <label className="text-xs font-semibold text-slate-300">{label}<select name={name} required defaultValue={value} className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-normal text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"><option value="" disabled>Chọn tài liệu fixture</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>;
}

function CompareState({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/35 p-8 text-center"><GitCompareArrows aria-hidden="true" className="mx-auto size-8 text-slate-500" /><h2 className="mt-3 font-semibold text-white">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{children}</p></section>;
}

function UnavailableRoute({ title, reason }: { title: string; reason: string }) {
  return (
    <WorkspacePage>
      <BackLink href="/documents">Quay lại thư viện</BackLink>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-12 text-center sm:px-8">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-amber-900/60 bg-amber-950/30 text-amber-300"><ShieldQuestion aria-hidden="true" className="size-6" /></span>
        <h1 className="mt-4 text-xl font-semibold text-white">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{reason}</p>
      </section>
    </WorkspacePage>
  );
}

function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ArrowLeft aria-hidden="true" className="size-4" />{children}</Link>;
}

function Meta({ icon: Icon, label, children }: { icon: typeof FileText; label: string; children: React.ReactNode }) {
  return <div className="flex items-start gap-3"><Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-500" /><div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{children}</dd></div></div>;
}
