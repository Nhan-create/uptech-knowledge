import Link from "next/link";
import { ArrowRight, BookOpen, FolderOpen, GitCompareArrows, Search } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { DocumentFilePicker } from "@/components/workspace/DocumentFilePicker";
import {
  DemoNotice,
  PageIntro,
  SectionHeading,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import { DocumentIdentity, ProcessingStatus } from "@/features/documents/DocumentPresentation";
import type {
  DocumentListInput,
  DocumentListOutcome,
  ProcessingKind,
  SpaceSummaryView,
} from "@/features/knowledge/model";

const processingFilters: readonly { value: ProcessingKind; label: string }[] = [
  { value: "uploading", label: "Đang tải lên" },
  { value: "validating", label: "Đang kiểm tra" },
  { value: "extracting", label: "Đang đọc nội dung" },
  { value: "ocr", label: "Đang OCR" },
  { value: "indexing", label: "Đang lập chỉ mục" },
  { value: "ready", label: "Sẵn sàng" },
  { value: "failed", label: "Thất bại" },
];

type Props = {
  input: DocumentListInput;
  outcome: DocumentListOutcome;
  spaces: readonly SpaceSummaryView[];
  legacyLinkUnavailable: boolean;
};

export function DocumentLibraryScreen({ input, outcome, spaces, legacyLinkUnavailable }: Props) {
  const documents = outcome.kind === "ready" ? outcome.documents : [];

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Document Library · Fixture"
        title="Tài liệu & không gian tri thức"
        description="Catalog fixture dùng chung cho thư viện, tìm kiếm, chi tiết và so sánh. Bộ lọc chạy trên dữ liệu này; chưa có API, ACL hay lưu trữ."
        actions={
          <Link href="/documents/compare" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <GitCompareArrows aria-hidden="true" className="size-4" />So sánh fixture
          </Link>
        }
      />
      <DemoNotice className="mt-6" />

      {legacyLinkUnavailable ? (
        <aside className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/25 px-4 py-3 text-sm leading-6 text-amber-100">
          Liên kết cũ không ánh xạ được tới fixture. Màn hình không xác nhận tài liệu có tồn tại hoặc người dùng có quyền truy cập.
        </aside>
      ) : null}

      <div className="mt-6"><DocumentFilePicker /></div>

      <section aria-labelledby="spaces-heading" className="mt-8">
        <SectionHeading id="spaces-heading" title="Không gian tri thức" description="Số lượng được suy ra từ cùng catalog fixture, không phải thống kê backend." />
        <div className="grid gap-4 md:grid-cols-3">
          {spaces.map((space) => (
            <Card key={space.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-xl border border-blue-800/60 bg-blue-950/60 text-blue-300"><FolderOpen aria-hidden="true" className="size-5" /></span>
                <Badge variant="neutral" size="sm">{space.documentCount} fixture</Badge>
              </div>
              <h3 className="mt-4 font-semibold text-white">{space.name}</h3>
              <p className="mt-1 min-h-10 text-sm leading-5 text-slate-400">{space.description}</p>
              <Link href={`/documents/spaces/${space.id}`} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-blue-300 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                Mở không gian <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="library-heading" className="mt-8">
        <SectionHeading id="library-heading" title="Thư viện fixture" description="Các trạng thái xử lý và nhãn quản trị là dữ liệu trình diễn; mutation backend chưa tồn tại." />
        <form action="/documents" method="get" className="mb-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/55 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_12rem_12rem_12rem_auto]">
          <label className="relative min-w-0">
            <span className="sr-only">Lọc theo tên tài liệu fixture</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="document-query" type="search" defaultValue={input.query} placeholder="Lọc theo tên hoặc nội dung fixture…" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30" />
          </label>
          <FilterSelect name="space" label="Không gian" value={input.spaceId ?? ""}>
            <option value="">Mọi không gian</option>
            {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </FilterSelect>
          <FilterSelect name="status" label="Trạng thái" value={input.processing ?? ""}>
            <option value="">Mọi trạng thái</option>
            {processingFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </FilterSelect>
          <FilterSelect name="type" label="Loại tệp" value={input.fileType ?? ""}>
            <option value="">Mọi loại tệp</option><option value="pdf">PDF</option><option value="docx">DOCX</option><option value="md">Markdown</option>
          </FilterSelect>
          <button type="submit" className="min-h-11 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Áp dụng</button>
        </form>

        {outcome.kind === "invalid" ? (
          <LibraryState title="Bộ lọc không hợp lệ">Trường không hợp lệ: {outcome.fields.join(", ")}. <Link href="/documents" className="font-semibold text-blue-300">Đặt lại</Link>.</LibraryState>
        ) : outcome.kind === "empty" ? (
          <LibraryState title="Không có tài liệu fixture phù hợp">Hãy đổi bộ lọc hoặc <Link href="/documents" className="font-semibold text-blue-300">xóa toàn bộ bộ lọc</Link>.</LibraryState>
        ) : (
          <ul className="space-y-3" aria-label="Danh sách tài liệu fixture">
            {documents.map((document) => (
              <li key={document.id}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <DocumentIdentity document={document} />
                    <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                      <ProcessingStatus document={document} />
                      <Link href={`/documents/${document.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 hover:border-blue-700 hover:bg-blue-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><BookOpen aria-hidden="true" className="size-3.5" />Mở chi tiết</Link>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-slate-800 pt-3 text-xs text-slate-400 sm:grid-cols-3">
                    <div><dt>Không gian</dt><dd className="mt-1 text-slate-200">{document.space.name}</dd></div>
                    <div><dt>Chủ sở hữu fixture</dt><dd className="mt-1 text-slate-200">{document.ownerLabel}</dd></div>
                    <div><dt>Cập nhật fixture</dt><dd className="mt-1 tabular-nums text-slate-200">{document.updatedLabel}</dd></div>
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

function FilterSelect({ name, label, value, children }: { name: string; label: string; value: string; children: React.ReactNode }) {
  return (
    <label><span className="sr-only">{label}</span><select name={name} defaultValue={value} className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30">{children}</select></label>
  );
}

function LibraryState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/35 p-8 text-center"><h3 className="font-semibold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{children}</p></div>;
}
