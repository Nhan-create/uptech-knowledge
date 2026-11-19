import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  Download,
  FileClock,
  FileText,
  FileUp,
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
  IconTile,
  PageIntro,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";
import { normalizeFold } from "@/features/dashboard/hero-matching";
import type {
  DocumentSummaryView,
  SearchInput,
  SearchOutcome,
  SpaceSummaryView,
} from "@/features/knowledge/model";
import { SearchAiSummaryCard } from "@/features/search/SearchAiSummaryCard";

type SearchScreenProps = {
  input: SearchInput;
  outcome: SearchOutcome;
  spaces: readonly SpaceSummaryView[];
  readyDocuments: readonly DocumentSummaryView[];
};

function renderHighlightedSnippet(snippet: string, query: string) {
  const tokens = Array.from(
    new Set(
      normalizeFold(query)
        .split(/\s+/u)
        .filter((t) => t.length >= 2),
    ),
  );
  if (tokens.length === 0) return snippet;

  // Safe diacritic-preserving token match highlight on word spans
  const parts = snippet.split(/(\s+)/);
  return parts.map((part, idx) => {
    const folded = normalizeFold(part);
    const matched = tokens.some((token) => folded.includes(token));
    if (matched && part.trim().length > 0) {
      return (
        <mark
          key={idx}
          className="rounded bg-[#EEF1FF] px-1 py-0.5 font-semibold text-[#1635C7]"
        >
          {part}
        </mark>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function SearchScreen({
  input,
  outcome,
  spaces,
  readyDocuments,
}: SearchScreenProps) {
  const hasFilterOrQuery = Boolean(input.query || input.spaceId || input.fileType);

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Tìm kiếm tri thức · Hybrid + Ngữ nghĩa AI"
        title="Tìm trong kho tri thức"
        description="Tìm kiếm theo từ khóa tiếng Việt có/không dấu kết hợp vector ngữ nghĩa trên toàn bộ tài liệu Sẵn sàng mà bạn đã tải lên."
      />

      <form
        action="/search"
        method="get"
        className="mt-6 rounded-2xl border border-[#0D1321]/10 bg-white p-4 shadow-[0_12px_28px_-14px_rgba(11,18,32,0.12)] sm:p-5"
      >
        <label
          htmlFor="knowledge-query"
          className="mb-2 block text-xs font-bold uppercase tracking-[0.1em] text-[#505A6E]"
        >
          Câu hỏi hoặc từ khóa cần tra cứu
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#505A6E]"
            />
            <input
              id="knowledge-query"
              name="q"
              type="search"
              defaultValue={input.query}
              placeholder="Nhập từ khóa, số ngày, quy trình hoặc câu hỏi…"
              className="h-12 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] pl-11 pr-4 text-sm text-[#0D1321] outline-none transition-colors placeholder:text-[#505A6E] focus:border-[#1B44FF] focus:bg-white focus:ring-2 focus:ring-[#1B44FF]/20"
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#1B44FF] px-6 text-sm font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7]"
            >
              <Search aria-hidden="true" className="size-4" />
              Tìm kiếm
            </button>
            {hasFilterOrQuery ? (
              <Link
                href="/search"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#505A6E] hover:text-[#0D1321]"
              >
                Đặt lại
              </Link>
            ) : null}
          </div>
        </div>

        <fieldset className="mt-4 border-t border-[#0D1321]/8 pt-4">
          <legend className="flex items-center gap-2 pr-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#505A6E]">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            Thu hẹp phạm vi tìm kiếm
          </legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-[#323B4D]">
              Không gian tri thức
              <select
                name="space"
                defaultValue={input.spaceId ?? "all"}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white focus:ring-2 focus:ring-[#1B44FF]/20"
              >
                <option value="all">Tất cả không gian</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} ({space.documentCount})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#323B4D]">
              Định dạng tệp
              <select
                name="type"
                defaultValue={input.fileType ?? "all"}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white focus:ring-2 focus:ring-[#1B44FF]/20"
              >
                <option value="all">Mọi loại tệp</option>
                <option value="pdf">PDF</option>
                <option value="docx">DOCX</option>
                <option value="md">Markdown / Text</option>
              </select>
            </label>
          </div>
        </fieldset>
      </form>

      <SearchOutcomeView
        input={input}
        outcome={outcome}
        readyDocuments={readyDocuments}
      />
    </WorkspacePage>
  );
}

function SearchOutcomeView({
  input,
  outcome,
  readyDocuments,
}: {
  input: SearchInput;
  outcome: SearchOutcome;
  readyDocuments: readonly DocumentSummaryView[];
}) {
  if (outcome.kind === "initial") {
    return <InitialState readyDocuments={readyDocuments} />;
  }
  if (outcome.kind === "invalid") {
    return (
      <StatePanel icon={Filter} title="Bộ lọc không hợp lệ">
        Đường dẫn tìm kiếm chứa tham số không tồn tại trong workspace hiện tại.
        <StateLink href="/search">Đặt lại tìm kiếm</StateLink>
      </StatePanel>
    );
  }
  if (outcome.kind === "empty") {
    return (
      <StatePanel icon={SearchX} title="Không tìm thấy kết quả phù hợp">
        Không có tài liệu Sẵn sàng nào khớp với “{outcome.query}”.{" "}
        {readyDocuments.length === 0
          ? "Kho tri thức hiện chưa có tài liệu nào được tải lên."
          : "Bạn có thể thử từ khóa ngắn hơn hoặc mở rộng phạm vi không gian."}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/search"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#0D1321] hover:bg-[#F3F4F8]"
          >
            Đặt lại tìm kiếm
          </Link>
          <Link
            href="/documents#library-upload-zone"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold [color:#FFFFFF] hover:bg-[#1635C7]"
          >
            <FileUp aria-hidden="true" className="size-3.5" />
            Tải tài liệu lên Thư viện
          </Link>
        </div>
      </StatePanel>
    );
  }
  if (outcome.kind === "indexing") {
    return (
      <section
        aria-labelledby="indexing-heading"
        className="mt-6 rounded-2xl border border-[#F6D59B] bg-[#FFF9EF] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <IconTile icon={FileClock} tone="amber" />
          <div>
            <h2 id="indexing-heading" className="text-lg font-bold text-[#0D1321]">
              Có tài liệu đang xử lý khớp truy vấn
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#323B4D]">
              Hệ thống chưa trích xuất snippet cho “{outcome.query}” đến khi tệp đạt trạng thái Sẵn sàng.
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {outcome.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-2 rounded-xl border border-[#0D1321]/10 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-semibold text-[#0D1321]">{document.name}</span>
              <Badge variant="warning" size="sm">
                {document.processing.label}
                {typeof document.processing.progress === "number"
                  ? ` · ${document.processing.progress}%`
                  : ""}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <SearchAiSummaryCard
        query={outcome.query}
        spaceId={input.spaceId}
        fileType={input.fileType}
      />

      <section aria-labelledby="results-heading" className="mt-6">
        <div className="flex flex-col gap-2 border-b border-[#0D1321]/8 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#1635C7]">
              <Filter aria-hidden="true" className="size-3.5" />
              Kết quả xếp hạng thực tế · Ready-Only
            </p>
            <h2 id="results-heading" className="mt-1 text-xl font-bold text-[#0D1321]">
              {outcome.results.length} tài liệu khớp cho “{outcome.query}”
            </h2>
          </div>
          <Badge variant="success" size="sm">
            Hybrid Từ khóa + Ngữ nghĩa
          </Badge>
        </div>

        <ol className="mt-4 space-y-4">
          {outcome.results.map((result, index) => (
            <li key={result.document.id}>
              <Card className="p-4 transition-colors hover:border-[#C8D2FF] sm:p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <IconTile icon={FileText} tone={index === 0 ? "blue" : "slate"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info" size="sm">
                        {result.document.fileType.toUpperCase()}
                      </Badge>
                      {result.heading ? (
                        <span className="text-xs font-semibold text-[#0D1321]">
                          {result.heading}
                        </span>
                      ) : null}
                      <span className="text-xs text-[#505A6E]">· {result.locator}</span>
                    </div>

                    <h3 className="mt-2 break-words text-base font-bold text-[#0D1321]">
                      <Link
                        href={
                          result.chunkId
                            ? `/documents/${result.document.id}?chunk=${encodeURIComponent(result.chunkId)}#chunk-${encodeURIComponent(result.chunkId)}`
                            : `/documents/${result.document.id}`
                        }
                        className="hover:text-[#1635C7] hover:underline"
                      >
                        {result.document.name}
                      </Link>
                    </h3>

                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#323B4D]">
                      {renderHighlightedSnippet(result.snippet, outcome.query)}
                    </p>

                    <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#505A6E]">
                      <div className="flex items-center gap-1.5">
                        <FolderOpen aria-hidden="true" className="size-3.5" />
                        <dt className="sr-only">Không gian</dt>
                        <dd>{result.document.space.name}</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <UserRound aria-hidden="true" className="size-3.5" />
                        <dt className="sr-only">Người tải lên</dt>
                        <dd>{result.document.ownerLabel}</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CalendarDays aria-hidden="true" className="size-3.5" />
                        <dt className="sr-only">Cập nhật</dt>
                        <dd>{result.document.updatedLabel}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={
                          result.chunkId
                            ? `/documents/${result.document.id}?chunk=${encodeURIComponent(result.chunkId)}#chunk-${encodeURIComponent(result.chunkId)}`
                            : `/documents/${result.document.id}`
                        }
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:bg-[#EEF1FF] hover:text-[#1635C7]"
                      >
                        <BookOpen aria-hidden="true" className="size-3.5" />
                        Mở đúng đoạn trích dẫn
                      </Link>
                      <a
                        href={`/api/v1/workspace/documents/${encodeURIComponent(result.document.id)}/download`}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#323B4D] hover:bg-[#F3F4F8]"
                      >
                        <Download aria-hidden="true" className="size-3.5" />
                        Tải xuống
                      </a>
                      <Link
                        href={`/chat?prompt=${encodeURIComponent(`Tóm tắt nội dung liên quan tới "${outcome.query}" trong ${result.document.name}`)}`}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-[#EEF1FF] px-4 text-xs font-semibold text-[#1635C7] transition-colors hover:bg-[#DCE3FF]"
                      >
                        <MessageSquareText aria-hidden="true" className="size-3.5" />
                        Hỏi Trợ lý AI
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function InitialState({
  readyDocuments,
}: {
  readyDocuments: readonly DocumentSummaryView[];
}) {
  if (readyDocuments.length === 0) {
    return (
      <section
        aria-labelledby="search-initial-heading"
        className="mt-6 rounded-2xl border border-dashed border-[#0D1321]/18 bg-white px-5 py-10 text-center sm:px-8"
      >
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]">
          <FileUp aria-hidden="true" className="size-6" />
        </span>
        <h2
          id="search-initial-heading"
          className="mt-4 text-lg font-bold text-[#0D1321]"
        >
          Chưa có tài liệu nào để tìm kiếm
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
          Kho tri thức hiện đang trống. Hãy tải tài liệu PDF, DOCX, Markdown hoặc TXT
          lên tab Thư viện để hệ thống lập chỉ mục và bật tìm kiếm tức thời.
        </p>
        <div className="mt-5">
          <Link
            href="/documents#library-upload-zone"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#1B44FF] px-5 text-sm font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7]"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Tải tài liệu đầu tiên
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="search-initial-heading"
      className="mt-6 rounded-2xl border border-[#0D1321]/10 bg-white px-5 py-8 text-center sm:px-8"
    >
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]">
        <Lightbulb aria-hidden="true" className="size-6" />
      </span>
      <h2
        id="search-initial-heading"
        className="mt-4 text-lg font-bold text-[#0D1321]"
      >
        Sẵn sàng tìm trên {readyDocuments.length} tài liệu thật
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
        Nhập từ khóa vào ô tìm kiếm hoặc chọn nhanh một tài liệu Sẵn sàng dưới đây để
        tra cứu và tóm tắt bằng AI.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        {readyDocuments.slice(0, 4).map((doc) => {
          const cleanTopic = doc.name.replace(/\.[^/.]+$/, "");
          return (
            <Link
              key={doc.id}
              href={`/search?q=${encodeURIComponent(cleanTopic)}`}
              className="inline-flex min-h-11 flex-col items-start rounded-xl border border-[#0D1321]/10 bg-[#FAF9FB] px-4 py-2 text-left text-sm font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:bg-[#EEF1FF]"
            >
              <span>{doc.name}</span>
              <span className="text-[11px] font-normal text-[#505A6E]">
                {doc.space.name} · {doc.updatedLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function StatePanel({
  icon,
  title,
  children,
}: {
  icon: typeof SearchX;
  title: string;
  children: React.ReactNode;
}) {
  const Icon = icon;
  return (
    <section className="mt-6 rounded-2xl border border-[#0D1321]/10 bg-white px-5 py-10 text-center sm:px-8">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-[#0D1321]/10 bg-[#F3F4F8] text-[#505A6E]">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-bold text-[#0D1321]">{title}</h2>
      <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
        {children}
      </div>
    </section>
  );
}

function StateLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <Link
        href={href}
        className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#1B44FF] px-5 text-xs font-semibold [color:#FFFFFF] hover:bg-[#1635C7]"
      >
        {children}
      </Link>
    </div>
  );
}
