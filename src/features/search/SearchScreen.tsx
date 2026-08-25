import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  FileClock,
  FileText,
  Filter,
  FolderOpen,
  Lightbulb,
  MessageSquareText,
  Search,
  SearchX,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import {
  DemoNotice,
  IconTile,
  PageIntro,
  PrototypeHint,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import {
  FIXTURE_PROVENANCE,
  type SearchInput,
  type SearchOutcome,
  type SpaceSummaryView,
} from "@/features/knowledge/model";

type SearchScreenProps = {
  input: SearchInput;
  outcome: SearchOutcome;
  spaces: readonly SpaceSummaryView[];
};

export function SearchScreen({ input, outcome, spaces }: SearchScreenProps) {
  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Enterprise Search · Fixture"
        title="Tìm trong kho tri thức"
        description="Bộ lọc chạy thật trên catalog fixture dùng chung. Chỉ tài liệu fixture ở trạng thái Sẵn sàng mới xuất hiện trong kết quả."
      />
      <DemoNotice className="mt-6" />

      <form
        action="/search"
        method="get"
        className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/75 p-4 shadow-xl shadow-black/10 sm:p-5"
      >
        <label htmlFor="knowledge-query" className="mb-2 block text-sm font-semibold text-slate-200">
          Câu hỏi hoặc từ khóa
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <input
              id="knowledge-query"
              name="q"
              type="search"
              defaultValue={input.query}
              placeholder="Ví dụ: quy định làm việc từ xa"
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 pl-11 pr-4 text-base text-slate-100 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button type="submit" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            <Search aria-hidden="true" className="size-4" />
            Tìm trong fixture
          </button>
        </div>

        <fieldset className="mt-4 border-t border-slate-800 pt-4">
          <legend className="flex items-center gap-2 pr-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            Bộ lọc catalog
          </legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-400">
              Không gian tri thức
              <select name="space" defaultValue={input.spaceId ?? "all"} className="mt-1.5 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30">
                <option value="all">Tất cả không gian</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>{space.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-400">
              Loại tệp
              <select name="type" defaultValue={input.fileType ?? "all"} className="mt-1.5 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30">
                <option value="all">Mọi loại tệp</option>
                <option value="pdf">PDF</option>
                <option value="docx">DOCX</option>
                <option value="md">Markdown</option>
              </select>
            </label>
          </div>
        </fieldset>

        <PrototypeHint>
          {FIXTURE_PROVENANCE.label}. Tìm kiếm hiện là đối sánh từ khóa cục bộ; chưa có semantic ranking, ACL hay analytics.
        </PrototypeHint>
      </form>

      <SearchOutcomeView outcome={outcome} />
    </WorkspacePage>
  );
}

function SearchOutcomeView({ outcome }: { outcome: SearchOutcome }) {
  if (outcome.kind === "initial") return <InitialState />;
  if (outcome.kind === "invalid") {
    return (
      <StatePanel icon={Filter} title="Bộ lọc không hợp lệ">
        Liên kết chứa giá trị bộ lọc không thuộc catalog fixture. Hãy đặt lại để tránh hiển thị một phạm vi không được xác nhận.
        <StateLink href="/search">Đặt lại tìm kiếm</StateLink>
      </StatePanel>
    );
  }
  if (outcome.kind === "empty") {
    return (
      <StatePanel icon={SearchX} title="Không có kết quả fixture">
        Không có tài liệu Sẵn sàng phù hợp với “{outcome.query}”. Kết quả này không tiết lộ tài liệu ngoài fixture hay ngoài quyền truy cập.
        <StateLink href="/search">Đặt lại tìm kiếm</StateLink>
      </StatePanel>
    );
  }
  if (outcome.kind === "indexing") {
    return (
      <section aria-labelledby="indexing-heading" className="mt-8 rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <IconTile icon={FileClock} tone="amber" />
          <div>
            <h2 id="indexing-heading" className="text-lg font-semibold text-white">Có nội dung fixture khớp nhưng chưa sẵn sàng</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">Không trả snippet hoặc locator cho “{outcome.query}” cho đến khi trạng thái fixture là Sẵn sàng.</p>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {outcome.documents.map((document) => (
            <li key={document.id} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-slate-200">{document.name}</span>
              <Badge variant="warning" size="sm">{document.processing.label}{typeof document.processing.progress === "number" ? ` · ${document.processing.progress}%` : ""}</Badge>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="results-heading" className="mt-8">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-400"><Filter aria-hidden="true" className="size-3.5" />Kết quả fixture · ready-only</p>
          <h2 id="results-heading" className="mt-1 text-xl font-semibold text-white">{outcome.results.length} kết quả cho “{outcome.query}”</h2>
        </div>
        <Badge variant="neutral">Không phải xếp hạng backend</Badge>
      </div>
      <ol className="mt-4 space-y-4">
        {outcome.results.map((result, index) => (
          <li key={result.document.id}>
            <Card className="p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <IconTile icon={FileText} tone={index === 0 ? "blue" : "slate"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="info" size="sm">{result.document.fileType.toUpperCase()}</Badge><span className="text-xs text-slate-400">{result.locator}</span></div>
                  <h3 className="mt-2 break-words text-base font-semibold text-white">{result.document.name}</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{result.snippet}</p>
                  <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5"><FolderOpen aria-hidden="true" className="size-3.5" /><dt className="sr-only">Không gian</dt><dd>{result.document.space.name}</dd></div>
                    <div className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5" /><dt className="sr-only">Chủ sở hữu fixture</dt><dd>{result.document.ownerLabel}</dd></div>
                    <div className="flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-3.5" /><dt className="sr-only">Cập nhật fixture</dt><dd>{result.document.updatedLabel}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/documents/${result.document.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-blue-700 hover:bg-blue-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><BookOpen aria-hidden="true" className="size-3.5" />Mở nguồn fixture</Link>
                    <button type="button" disabled title="Chat handoff chưa có hợp đồng backend" className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-slate-500"><MessageSquareText aria-hidden="true" className="size-3.5" />Hỏi AI · chưa kết nối</button>
                  </div>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InitialState() {
  const suggestions = [
    ["quy định làm việc từ xa", "Kết quả Sẵn sàng"],
    ["quy trình bàn giao dự án", "Trạng thái đang xử lý"],
    ["tài liệu không tồn tại", "Trạng thái trống"],
  ] as const;

  return (
    <section aria-labelledby="search-initial-heading" className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/35 px-5 py-10 text-center sm:px-8">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-blue-800/60 bg-blue-950/50 text-blue-300"><Lightbulb aria-hidden="true" className="size-6" /></span>
      <h2 id="search-initial-heading" className="mt-4 text-lg font-semibold text-white">Thử từng trạng thái bằng truy vấn fixture</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Mỗi gợi ý chạy qua cùng adapter và cùng quy tắc ready-only, không chuyển trạng thái bằng từ khóa đặc biệt.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {suggestions.map(([query, label]) => (
          <Link key={query} href={`/search?q=${encodeURIComponent(query)}`} className="inline-flex min-h-11 flex-col items-start rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-left text-sm text-slate-200 hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span>{query}</span><span className="text-[11px] text-slate-500">{label}</span></Link>
        ))}
      </div>
    </section>
  );
}

function StatePanel({ icon, title, children }: { icon: typeof SearchX; title: string; children: React.ReactNode }) {
  const Icon = icon;
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/55 px-5 py-10 text-center sm:px-8">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-400"><Icon aria-hidden="true" className="size-6" /></span>
      <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
      <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{children}</div>
    </section>
  );
}

function StateLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <div className="mt-5"><Link href={href} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{children}</Link></div>;
}
