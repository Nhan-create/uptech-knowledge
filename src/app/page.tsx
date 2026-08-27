import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  FileCheck2,
  Files,
  FolderSearch2,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Logo from "@/components/Logo";
import { HeroBackgroundVideo } from "@/components/landing/HeroBackgroundVideo";
import { LandingMotionController } from "@/components/landing/LandingMotionController";
import { PublicNav } from "@/components/landing/PublicNav";
import { getHomeContent, type HomeContent } from "@/components/landing/home-content";
import { LOCALE_COOKIE_NAME, parseLocale } from "@/lib/preferences";

const trustIcons = [LockKeyhole, FileCheck2, ShieldCheck] as const;
const capabilityIcons = [MessageSquareText, FolderSearch2, Files] as const;

function FacebookIcon() {
  return (
    <svg data-brand="facebook" aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
      <path d="M24 12.073C24 5.446 18.627.073 12 .073S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.926-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.064 24 12.073Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg data-brand="linkedin" aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" />
    </svg>
  );
}

function PartnerMarks({ label }: { readonly label: string }) {
  return (
    <div aria-label={label} className="flex flex-wrap items-center gap-x-7 gap-y-4 text-slate-500">
      <span data-partner="aws" aria-label="AWS" className="font-sans text-3xl font-medium tracking-[-0.08em]">
        aws
      </span>
      <span data-partner="google-cloud" aria-label="Google Cloud" className="inline-flex items-center gap-2">
        <svg aria-hidden="true" viewBox="0 0 48 32" className="h-8 w-12 fill-current">
          <path d="M32.7 9.2A12.2 12.2 0 0 0 10 13.6 9.2 9.2 0 0 0 10.2 32h22.3a11.5 11.5 0 0 0 .2-22.8ZM13.4 26a3.7 3.7 0 1 1 0-7.4h1.4l.5-1.4a6.2 6.2 0 0 1 11.8.9l.4 1.8h4.9a3.1 3.1 0 0 1 0 6.1h-19Z" />
        </svg>
      </span>
      <span data-partner="microsoft" aria-label="Microsoft" className="grid grid-cols-2 gap-1">
        <span className="size-3.5 bg-current" /><span className="size-3.5 bg-current" />
        <span className="size-3.5 bg-current" /><span className="size-3.5 bg-current" />
      </span>
      <span data-partner="salesforce" aria-label="Salesforce" className="relative inline-flex h-9 w-14 items-center justify-center rounded-[50%] bg-slate-500 text-[7px] font-semibold text-slate-950">
        salesforce
      </span>
    </div>
  );
}

function ProductPreview({ copy }: { readonly copy: HomeContent["preview"] }) {
  return (
    <div
      role="region"
      className="product-preview-enter relative mx-auto w-full max-w-7xl"
      aria-label={copy.aria}
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
            {copy.demo}
          </span>
          <span className="w-10 text-right font-mono text-[10px] text-slate-400">01/01</span>
        </div>

        <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="product-preview-source hidden border-r border-slate-800 bg-slate-950/50 p-5 text-left lg:block">
            <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              <BookOpenCheck aria-hidden="true" className="size-4" />
              {copy.sources}
            </div>
            <div className="space-y-2.5">
              <div className="product-preview-source-item rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5">
                <p className="text-sm font-medium text-slate-100">Quy trình mua sắm 2026.pdf</p>
                <p className="mt-1 text-xs text-slate-400">{copy.sourceOneMeta}</p>
              </div>
              <div className="product-preview-source-item rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                <p className="text-sm font-medium text-slate-300">Ma trận thẩm quyền.xlsx</p>
                <p className="mt-1 text-xs text-slate-400">{copy.sourceTwoMeta}</p>
              </div>
            </div>
            <div className="mt-6 border-t border-slate-800 pt-5">
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <LockKeyhole aria-hidden="true" className="size-3.5" />
                {copy.permitted}
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-4 text-left sm:p-7 lg:p-8">
            <div className="product-preview-prompt rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3.5 text-sm text-slate-300 sm:text-base">
              {copy.prompt}
            </div>
            <div className="product-preview-answer mt-6 flex gap-3 sm:gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-400/10 text-violet-300 sm:size-9">
                <Sparkles aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-100">UPTECH KNOWLEDGE</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
                    <Check aria-hidden="true" className="size-3" /> {copy.verified}
                  </span>
                </div>
                <div className="space-y-3 text-sm leading-7 text-slate-300 sm:text-[15px]">
                  <p>
                    {copy.answerOne}
                    <sup className="ml-1 rounded bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">1</sup>
                  </p>
                  <p>
                    {copy.answerTwo}
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
                      {copy.citationOne}
                      <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                  <Link href="/login" className="product-preview-citation group min-h-14 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-left transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-violet-400/60 hover:bg-violet-500/10 hover:shadow-lg hover:shadow-violet-950/20">
                    <span className="flex items-center gap-2 text-xs font-semibold text-violet-300">
                      <span className="flex size-5 items-center justify-center rounded bg-violet-400/15">2</span>
                      Ma trận thẩm quyền.xlsx
                    </span>
                    <span className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                      {copy.citationTwo}
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
  const copy = getHomeContent(locale);
  const footerCopy = copy.footer;

  return (
    <div data-media-surface="dark" className="relative isolate min-h-dvh overflow-x-hidden bg-transparent text-slate-100">
      <HeroBackgroundVideo />
      <a href="#main-content" className="fixed left-4 top-3 z-[60] inline-flex min-h-11 -translate-y-20 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0">
        {footerCopy.skipToContent}
      </a>
      <PublicNav />

      <main id="main-content" lang={locale} className="relative z-10">
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
                {copy.hero.badge}
              </div>
              <h1 className="landing-media-text mt-8 text-balance text-4xl font-bold leading-[1.15] tracking-[-0.04em] text-white sm:text-6xl lg:text-[5.25rem]">
                <span className="landing-headline-mask block">
                  <span className="landing-headline-line landing-headline-line-primary block">{copy.hero.title}</span>
                </span>
              </h1>
              <p className="landing-hero-copy mx-auto mt-8 max-w-2xl text-pretty text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
                {copy.hero.description}
              </p>
              <div className="landing-hero-trust mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/65 sm:text-sm">
                {copy.hero.trust.map((item) => (
                  <span key={item} className="landing-trust-item inline-flex items-center gap-1.5">
                    <Check aria-hidden="true" className="landing-trust-check size-3.5 text-emerald-400" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div id="product" className="landing-product-stage scroll-mt-24 pt-16 sm:pt-20">
              <ProductPreview copy={copy.preview} />
            </div>
          </div>
        </section>

        <section id="trust" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="landing-glass-panel mx-auto max-w-7xl rounded-[2rem] p-5 sm:p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch lg:gap-16">
              <div data-reveal>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">{copy.trustSection.eyebrow}</p>
                <h2 className="mt-4 max-w-lg text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                  {copy.trustSection.title}
                </h2>
                <p className="mt-5 max-w-lg text-base font-medium leading-7 text-slate-300">
                  {copy.trustSection.description}
                </p>
              </div>
              <div data-reveal className="landing-reveal-delay-1 grid auto-rows-fr gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {copy.trust.map((item, index) => {
                  const Icon = trustIcons[index];
                  return (
                    <article key={item[1]} className="landing-glass-card landing-interactive-card group h-full rounded-2xl p-5 sm:p-6 lg:grid lg:grid-cols-[3rem_1fr] lg:gap-5">
                      <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-blue-300 transition-colors group-hover:border-blue-400/50 lg:mb-0">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{item[0]}</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-100">{item[1]}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">{item[2]}</p>
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
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">{copy.capabilitySection.eyebrow}</p>
                <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                  {copy.capabilitySection.title}
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-slate-400 sm:text-base sm:leading-7">
                {copy.capabilitySection.description}
              </p>
            </div>
            <div className="landing-reveal-grid mt-12 grid gap-4 lg:grid-cols-3">
              {copy.capabilities.map((item, index) => {
                const Icon = capabilityIcons[index];
                return (
                  <article key={item[0]} className="landing-glass-card landing-interactive-card group relative flex h-full min-h-72 flex-col overflow-hidden rounded-2xl p-6 hover:border-slate-600 sm:p-7">
                    <div className="flex items-start justify-between">
                      <div className="flex size-12 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <span className="font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-8 text-xl font-semibold text-slate-100">{item[0]}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{item[1]}</p>
                    <p className="mt-auto border-t border-slate-800 pt-4 font-mono text-[11px] leading-5 text-slate-400">{item[2]}</p>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">{copy.workflowSection.eyebrow}</p>
                  <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">{copy.workflowSection.title}</h2>
                  <p className="mt-5 max-w-md text-sm leading-7 text-slate-400 sm:text-base">
                    {copy.workflowSection.description}
                  </p>
                </div>
              </div>
              <ol className="grid auto-rows-fr gap-4 sm:grid-cols-2">
                {copy.workflow.map((item, index) => (
                  <li key={item[0]} className="landing-glass-card landing-workflow-step h-full min-h-52 rounded-2xl p-7 transition-colors hover:bg-slate-900/55 sm:p-8">
                    <span className="font-mono text-xs font-medium text-blue-300">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="mt-10 text-lg font-semibold text-slate-100">{item[0]}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item[1]}</p>
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
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">{copy.cta.eyebrow}</p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">{copy.cta.title}</h2>
              <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
                {copy.cta.description}
              </p>
              <Link href="/login" className="group mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-blue-700 active:translate-y-0">
                {copy.cta.secondary}
                <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer lang={locale} className="relative z-10 border-t border-slate-800/80 bg-slate-950/65 px-4 py-10 backdrop-blur-[2px] sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)] lg:gap-20">
          <div>
            <Link href="/" aria-label={footerCopy.homeLabel} className="inline-flex min-h-12 items-center">
              <Logo className="h-10 w-auto sm:h-11" />
            </Link>

            <address className="mt-7 flex flex-col items-start gap-2 not-italic text-sm text-slate-300 sm:text-base">
              <a href="tel:+84968726135" className="inline-flex min-h-11 items-center gap-3 transition-colors hover:text-white">
                <Phone aria-hidden="true" className="size-4.5 text-slate-400" />
                {footerCopy.phone}
              </a>
              <a href="mailto:contact@uptech.vn" className="inline-flex min-h-11 items-center gap-3 transition-colors hover:text-white">
                <Mail aria-hidden="true" className="size-4.5 text-slate-400" />
                {footerCopy.email}
              </a>
            </address>

            <p className="mt-6 max-w-lg text-sm leading-7 text-slate-400 sm:text-base">
              {footerCopy.companyDescription}
            </p>
            <div className="mt-7">
              <PartnerMarks label={footerCopy.partnersLabel} />
            </div>

            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1">
              <Link
                href="/dieu-khoan-su-dung"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-sm font-medium text-slate-300 underline decoration-slate-600 underline-offset-4 transition-colors hover:text-slate-100 hover:decoration-slate-300"
              >
                {footerCopy.terms}
              </Link>
              <Link
                href="/chinh-sach-bao-mat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-sm font-medium text-slate-300 underline decoration-slate-600 underline-offset-4 transition-colors hover:text-slate-100 hover:decoration-slate-300"
              >
                {footerCopy.privacy}
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-9">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.08em] text-slate-100">
                {footerCopy.socialLabel}
              </p>
              <div className="mt-4 flex gap-3">
                <a
                  href="https://www.linkedin.com/company/uptechvn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={footerCopy.linkedinLabel}
                  className="inline-flex size-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 text-slate-300 transition-[border-color,background-color,color,transform] hover:-translate-y-0.5 hover:border-sky-500/70 hover:bg-sky-500/10 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 motion-reduce:transform-none"
                >
                  <LinkedInIcon />
                </a>
                <a
                  href="https://www.facebook.com/uptech.vn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={footerCopy.facebookLabel}
                  className="inline-flex size-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 text-slate-300 transition-[border-color,background-color,color,transform] hover:-translate-y-0.5 hover:border-blue-500/70 hover:bg-blue-500/10 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none"
                >
                  <FacebookIcon />
                </a>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-slate-100 sm:text-base">
                {footerCopy.newsletterTitle}
              </h2>
              <form action="mailto:contact@uptech.vn" method="post" encType="text/plain" className="mt-4 flex min-h-14 max-w-xl border border-slate-700 bg-slate-950/55 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <label htmlFor="footer-newsletter-email" className="sr-only">{footerCopy.newsletterPlaceholder}</label>
                <input
                  id="footer-newsletter-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={footerCopy.newsletterPlaceholder}
                  className="min-w-0 flex-1 bg-transparent px-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 sm:text-base"
                />
                <button type="submit" aria-label={footerCopy.newsletterSubmit} className="inline-flex size-14 shrink-0 cursor-pointer items-center justify-center text-slate-400 transition-colors hover:bg-blue-500/10 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                  <ArrowUpRight aria-hidden="true" className="size-5" />
                </button>
              </form>
              <p className="mt-3 text-sm leading-6 text-slate-400">{footerCopy.newsletterDescription}</p>
            </div>

            <nav
              aria-label={footerCopy.navigationLabel}
              className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400"
            >
              <Link href="/san-pham" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.product}</Link>
              <Link href="/nguyen-tac" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.principles}</Link>
              <Link href="/quy-trinh" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.workflow}</Link>
              <Link href="/login" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-100">{footerCopy.signIn}</Link>
            </nav>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-slate-800 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{footerCopy.prototype}</p>
          <p>{footerCopy.trustLine}</p>
        </div>
      </footer>
    </div>
  );
}
