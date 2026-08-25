import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  FileCheck2,
  Files,
  FolderSearch2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Logo from "@/components/Logo";
import { DemoRequestDialog } from "@/components/landing/DemoRequestDialog";
import { HeroBackgroundVideo } from "@/components/landing/HeroBackgroundVideo";
import { LandingMotionController } from "@/components/landing/LandingMotionController";
import { PublicNav } from "@/components/landing/PublicNav";
import { LOCALE_COOKIE_NAME, parseLocale } from "@/lib/preferences";

const trustPrinciples = [
  {
    icon: LockKeyhole,
    eyebrow: "Theo đúng quyền",
    title: "Nguồn được phép mới đi vào câu trả lời.",
    description:
      "Phạm vi workspace và quyền tài liệu được giữ xuyên suốt quá trình tìm kiếm, hỏi đáp và mở nguồn.",
  },
  {
    icon: FileCheck2,
    eyebrow: "Có thể kiểm chứng",
    title: "Mỗi kết luận luôn đi cùng ngữ cảnh nguồn.",
    description:
      "Tên tài liệu, vị trí và đoạn liên quan giúp người đọc kiểm tra thông tin thay vì chỉ tin vào AI.",
  },
  {
    icon: ShieldCheck,
    eyebrow: "Không suy đoán",
    title: "Thiếu bằng chứng, hệ thống nói rõ.",
    description:
      "Câu trả lời phân biệt dữ kiện có nguồn với phần chưa đủ cơ sở để đội ngũ ra quyết định an toàn hơn.",
  },
];

const capabilities = [
  {
    number: "01",
    icon: MessageSquareText,
    title: "Hỏi toàn bộ kho tri thức",
    description:
      "Đặt câu hỏi bằng ngôn ngữ tự nhiên và nhận câu trả lời tổng hợp từ những tài liệu bạn được phép xem.",
    detail: "AI chat · Trích dẫn · Cảnh báo thiếu dữ liệu",
  },
  {
    number: "02",
    icon: FolderSearch2,
    title: "Tìm đúng, không chỉ tìm giống",
    description:
      "Kết hợp từ khoá và ngữ nghĩa để tìm chính sách, hợp đồng hay quy trình dù cách diễn đạt không hoàn toàn trùng khớp.",
    detail: "Toàn văn · Ngữ nghĩa · Bộ lọc theo nguồn",
  },
  {
    number: "03",
    icon: Files,
    title: "Biến tài liệu thành tri thức dùng được",
    description:
      "Tổ chức nguồn theo phòng ban, dự án hoặc khách hàng; tóm tắt, so sánh và tạo đầu ra nháp từ đúng tài liệu.",
    detail: "Không gian tri thức · Phiên bản · AI utilities",
  },
];

const workflow = [
  { step: "01", title: "Tập trung nguồn", description: "Đưa tài liệu và nguồn được phê duyệt về đúng workspace." },
  { step: "02", title: "Giữ nguyên quyền", description: "Gắn phạm vi truy cập trước khi nội dung được xử lý và lập chỉ mục." },
  { step: "03", title: "Tìm hoặc hỏi", description: "Truy xuất bằng từ khoá, ý nghĩa hoặc một câu hỏi tự nhiên." },
  { step: "04", title: "Mở nguồn kiểm chứng", description: "Đi từ câu trả lời đến đúng tài liệu và vị trí liên quan." },
];

const publicFooterCopy = {
  vi: {
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    skipToContent: "Đi đến nội dung chính",
    description:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
    navigationLabel: "Điều hướng chân trang",
    product: "Sản phẩm",
    principles: "Nguyên tắc",
    workflow: "Quy trình",
    signIn: "Đăng nhập",
    prototype: "© 2026 UPTECH. Bản mẫu trải nghiệm sản phẩm.",
    trustLine: "Grounded · Verifiable · Permission-aware",
  },
  en: {
    homeLabel: "UPTECH KNOWLEDGE - Home",
    skipToContent: "Skip to main content",
    description:
      "An AI knowledge assistant that helps organizations search, ask, and verify information from the right permitted sources.",
    navigationLabel: "Footer navigation",
    product: "Product",
    principles: "Principles",
    workflow: "Workflow",
    signIn: "Sign in",
    prototype: "© 2026 UPTECH. Product experience prototype.",
    trustLine: "Grounded · Verifiable · Permission-aware",
  },
} as const;

function ProductPreview() {
  return (
    <div
      role="region"
      className="product-preview-enter relative mx-auto w-full max-w-7xl"
      aria-label="Bản mô phỏng câu trả lời có trích dẫn"
    >
      <div aria-hidden="true" className="product-preview-glow absolute -inset-1 rounded-[2rem] bg-white/5 blur-2xl" />
      <div className="landing-glass-panel product-preview-shell relative overflow-hidden rounded-[2rem]">
        <div className="flex h-12 items-center justify-between border-b border-slate-800 px-4 sm:px-5">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="size-2 rounded-full bg-slate-600" />
            <span className="size-2 rounded-full bg-slate-700" />
            <span className="size-2 rounded-full bg-slate-800" />
          </div>
          <span className="rounded-full border border-blue-400/20 bg-blue-400/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300 sm:text-xs">
            Bản mô phỏng
          </span>
          <span className="w-10 text-right font-mono text-[10px] text-slate-400">01/01</span>
        </div>

        <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="product-preview-source hidden border-r border-slate-800 bg-slate-950/50 p-5 text-left lg:block">
            <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              <BookOpenCheck aria-hidden="true" className="size-4" />
              Nguồn đang dùng
            </div>
            <div className="space-y-2.5">
              <div className="product-preview-source-item rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5">
                <p className="text-sm font-medium text-slate-100">Quy trình mua sắm 2026.pdf</p>
                <p className="mt-1 text-xs text-slate-400">Phòng Vận hành · 12 trang</p>
              </div>
              <div className="product-preview-source-item rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                <p className="text-sm font-medium text-slate-300">Ma trận thẩm quyền.xlsx</p>
                <p className="mt-1 text-xs text-slate-400">Phòng Tài chính · 4 sheet</p>
              </div>
            </div>
            <div className="mt-6 border-t border-slate-800 pt-5">
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <LockKeyhole aria-hidden="true" className="size-3.5" />
                2 nguồn trong phạm vi quyền
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-4 text-left sm:p-7 lg:p-8">
            <div className="product-preview-prompt rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3.5 text-sm text-slate-300 sm:text-base">
              Quy trình phê duyệt hợp đồng có giá trị trên 500 triệu đồng là gì?
            </div>
            <div className="product-preview-answer mt-6 flex gap-3 sm:gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-400/10 text-violet-300 sm:size-9">
                <Sparkles aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-100">UPTECH KNOWLEDGE</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
                    <Check aria-hidden="true" className="size-3" /> Có nguồn kiểm chứng
                  </span>
                </div>
                <div className="space-y-3 text-sm leading-7 text-slate-300 sm:text-[15px]">
                  <p>
                    Với hợp đồng trên 500 triệu đồng, hồ sơ cần được rà soát ngân sách và pháp lý trước khi trình cấp có thẩm quyền phê duyệt.
                    <sup className="ml-1 rounded bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">1</sup>
                  </p>
                  <p>
                    Hồ sơ trình duyệt gồm đề xuất mua sắm, báo giá hợp lệ, biên bản lựa chọn và dự thảo hợp đồng.
                    <sup className="ml-1 rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">2</sup>
                  </p>
                </div>

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  <Link href="/login" className="product-preview-citation group min-h-14 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-blue-400/60 hover:bg-blue-500/10 hover:shadow-lg hover:shadow-blue-950/20">
                    <span className="flex items-center gap-2 text-xs font-semibold text-blue-300">
                      <span className="flex size-5 items-center justify-center rounded bg-blue-400/15">1</span>
                      Quy trình mua sắm 2026.pdf
                    </span>
                    <span className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                      Trang 8 · Mục 3.2
                      <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                  <Link href="/login" className="product-preview-citation group min-h-14 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-violet-400/60 hover:bg-violet-500/10 hover:shadow-lg hover:shadow-violet-950/20">
                    <span className="flex items-center gap-2 text-xs font-semibold text-violet-300">
                      <span className="flex size-5 items-center justify-center rounded bg-violet-400/15">2</span>
                      Ma trận thẩm quyền.xlsx
                    </span>
                    <span className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                      Sheet Phê duyệt · Dòng 18
                      <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const footerCopy = publicFooterCopy[locale];

  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden bg-transparent text-slate-100">
      <HeroBackgroundVideo />
      <a href="#main-content" className="fixed left-4 top-3 z-[60] inline-flex min-h-11 -translate-y-20 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0">
        {footerCopy.skipToContent}
      </a>
      <PublicNav />

      <main id="main-content" lang="vi" className="relative z-10">
        <section
          data-landing-hero
          className="relative isolate overflow-hidden px-4 pb-20 pt-28 sm:px-6 sm:pb-28 sm:pt-36 lg:px-8 lg:pt-40"
        >
          <div
            aria-hidden="true"
            className="landing-ambient-grid pointer-events-none absolute -inset-16 -z-20 opacity-20"
            style={{
              backgroundImage: "linear-gradient(rgba(148,163,184,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.08) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "linear-gradient(to bottom, black 0%, transparent 78%)",
            }}
          />
          <div aria-hidden="true" className="landing-ambient-glow pointer-events-none absolute left-1/2 top-52 -z-10 h-80 w-[42rem] max-w-[90vw] rounded-full bg-blue-600/15 blur-[120px]" />
          <LandingMotionController />
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-4xl text-center">
              <div className="landing-hero-badge inline-flex items-center gap-3 rounded-full border px-5 py-2.5 text-sm font-semibold tracking-wide sm:text-base">
                <span className="landing-badge-dot size-2 rounded-full" />
                Trợ lý tri thức AI dành cho doanh nghiệp
              </div>
              <h1 className="landing-media-text mt-8 text-balance text-4xl font-bold leading-[1.15] tracking-[-0.04em] text-white sm:text-6xl lg:text-[5.25rem]">
                <span className="landing-headline-mask block">
                  <span className="landing-headline-line landing-headline-line-primary block">Bộ não tri thức dành cho doanh nghiệp</span>
                </span>
              </h1>
              <p className="landing-hero-copy mx-auto mt-8 max-w-2xl text-pretty text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
                Tìm kiếm tức thì, giải đáp chính xác và liên kết trực tiếp tới tài liệu gốc và bảo mật tuyệt đối theo quyền hạn của từng nhân sự.
              </p>
              <div className="landing-hero-actions mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <DemoRequestDialog />
                <a href="#product" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 sm:w-auto">
                  Xem sản phẩm hoạt động
                </a>
              </div>
              <div className="landing-hero-trust mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/65 sm:text-sm">
                {["Nguồn có thể mở", "Theo phạm vi quyền", "Nêu rõ khi thiếu dữ liệu"].map((item) => (
                  <span key={item} className="landing-trust-item inline-flex items-center gap-1.5">
                    <Check aria-hidden="true" className="landing-trust-check size-3.5 text-emerald-400" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div id="product" className="landing-product-stage scroll-mt-24 pt-16 sm:pt-20">
              <ProductPreview />
            </div>
          </div>
        </section>

        <section id="trust" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="landing-glass-panel mx-auto max-w-7xl rounded-[2rem] p-5 sm:p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch lg:gap-16">
              <div data-reveal>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Trust by design</p>
                <h2 className="mt-4 max-w-lg text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                  AI hữu ích bắt đầu từ niềm tin vào nguồn.
                </h2>
                <p className="mt-5 max-w-lg text-base font-medium leading-7 text-slate-300">
                  Không chỉ tạo một câu trả lời nghe hợp lý. UPTECH KNOWLEDGE được định hướng để người dùng hiểu câu trả lời đến từ đâu, dùng dữ liệu nào và còn thiếu điều gì.
                </p>
              </div>
              <div data-reveal className="landing-reveal-delay-1 grid auto-rows-fr gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {trustPrinciples.map((item) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.title} className="landing-glass-card landing-interactive-card group h-full rounded-2xl p-5 sm:p-6 lg:grid lg:grid-cols-[3rem_1fr] lg:gap-5">
                      <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-blue-300 transition-colors group-hover:border-blue-400/50 lg:mb-0">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{item.eyebrow}</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-100">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="landing-glass-panel mx-auto max-w-7xl rounded-[2rem] p-5 sm:p-8 lg:p-10">
            <div data-reveal className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Một nơi cho tri thức</p>
                <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                  Từ tài liệu rời rạc đến câu trả lời có thể hành động.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-slate-400 sm:text-base sm:leading-7">
                Một trải nghiệm thống nhất cho nhân viên tìm kiếm, đặt câu hỏi và tiếp tục làm việc với nguồn gốc của thông tin.
              </p>
            </div>
            <div className="landing-reveal-grid mt-12 grid gap-4 lg:grid-cols-3">
              {capabilities.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.number} className="landing-glass-card landing-interactive-card group relative flex h-full min-h-72 flex-col overflow-hidden rounded-2xl p-6 hover:border-slate-600 sm:p-7">
                    <div className="flex items-start justify-between">
                      <div className="flex size-12 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <span className="font-mono text-xs text-slate-400">{item.number}</span>
                    </div>
                    <h3 className="mt-8 text-xl font-semibold text-slate-100">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{item.description}</p>
                    <p className="mt-auto border-t border-slate-800 pt-4 font-mono text-[11px] leading-5 text-slate-400">{item.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-20 px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
          <div data-reveal className="landing-glass-panel mx-auto max-w-7xl rounded-[2rem] p-4">
            <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="landing-glass-card relative rounded-3xl p-7 sm:p-10 lg:p-12">
                <div aria-hidden="true" className="absolute -left-20 -top-20 size-64 rounded-full bg-violet-500/10 blur-3xl" />
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Luồng tri thức khép kín</p>
                  <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">Nhanh để sử dụng. Rõ để kiểm tra.</h2>
                  <p className="mt-5 max-w-md text-sm leading-7 text-slate-400 sm:text-base">
                    Mỗi bước đều giữ lại ngữ cảnh nguồn và quyền truy cập, từ lúc tài liệu đi vào đến khi người dùng mở citation.
                  </p>
                  <Link href="/login" className="group mt-8 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-300 transition-colors hover:text-blue-200">
                    Thử luồng giao diện
                    <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
              <ol className="grid auto-rows-fr gap-4 sm:grid-cols-2">
                {workflow.map((item) => (
                  <li key={item.step} className="landing-glass-card landing-workflow-step h-full min-h-52 rounded-2xl p-7 transition-colors hover:bg-slate-900/55 sm:p-8">
                    <span className="font-mono text-xs font-medium text-blue-300">{item.step}</span>
                    <h3 className="mt-10 text-lg font-semibold text-slate-100">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 sm:pb-24 lg:px-8">
          <div data-reveal className="landing-glass-panel relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-10 sm:py-16">
            <div aria-hidden="true" className="absolute left-1/2 top-0 h-28 w-2/3 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="relative mx-auto max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">UPTECH KNOWLEDGE</p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">Để kiến thức quan trọng không còn nằm yên trong tài liệu.</h2>
              <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
                Khám phá prototype giao diện và hình dung cách đội ngũ của bạn có thể tìm, hỏi và kiểm chứng thông tin trong một nơi.
              </p>
              <Link href="/login" className="group mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-blue-700 active:translate-y-0">
                Mở bản demo giao diện
                <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer lang={locale} className="relative z-10 border-t border-slate-800/80 bg-slate-950/65 px-4 py-10 backdrop-blur-[2px] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" aria-label={footerCopy.homeLabel} className="inline-flex min-h-11 items-center gap-3.5">
              <Logo className="h-7 w-auto sm:h-8" />
              <span className="border-l border-slate-700 pl-3.5 text-xs font-bold tracking-[0.2em] text-slate-200">KNOWLEDGE</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">{footerCopy.description}</p>
          </div>
          <nav
            aria-label={footerCopy.navigationLabel}
            className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400"
          >
            <a href="#product" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.product}</a>
            <a href="#trust" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.principles}</a>
            <a href="#workflow" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.workflow}</a>
            <Link href="/login" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.signIn}</Link>
          </nav>
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-slate-800 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{footerCopy.prototype}</p>
          <p>{footerCopy.trustLine}</p>
        </div>
      </footer>
    </div>
  );
}
