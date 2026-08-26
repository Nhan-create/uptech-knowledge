import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import Logo from "@/components/Logo";
import { HeroBackgroundVideo } from "@/components/landing/HeroBackgroundVideo";
import { ProductInterfacePreview } from "@/components/landing/ProductInterfacePreview";
import { PublicNav } from "@/components/landing/PublicNav";
import {
  getPublicInfoContent,
  type PublicInfoContent,
  type PublicInfoSection,
} from "@/components/landing/public-info-content";
import { LOCALE_COOKIE_NAME, parseLocale, type Locale } from "@/lib/preferences";

function PublicInfoView({
  content,
  locale,
}: {
  readonly content: PublicInfoContent;
  readonly locale: Locale;
}) {
  return (
    <div
      data-testid="public-info-page"
      data-section-label={content.sectionLabel}
      className="relative isolate min-h-dvh overflow-x-hidden bg-transparent text-slate-100"
    >
      <HeroBackgroundVideo />
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[60] inline-flex min-h-11 -translate-y-20 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        {locale === "en" ? "Skip to main content" : "Đi đến nội dung chính"}
      </a>
      <PublicNav />

      <main id="main-content" lang={locale} className="relative z-10">
        <section className="px-4 pb-16 pt-32 sm:px-6 sm:pb-24 sm:pt-40 lg:px-8 lg:pt-44">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
            <div>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-blue-200 transition-colors hover:text-white"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {content.secondaryCta}
              </Link>
              <p className="mt-7 text-xs font-bold uppercase tracking-[0.22em] text-blue-200">
                {content.eyebrow}
              </p>
              <h1 className="landing-media-text mt-5 max-w-4xl text-balance text-4xl font-bold leading-[1.08] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
                {content.title}
              </h1>
              <p className="landing-media-text mt-7 max-w-2xl text-pretty text-base font-medium leading-8 text-white/85 sm:text-lg">
                {content.summary}
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/35 transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-blue-950/45"
                >
                  {content.primaryCta}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
                <Link
                  href="/"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 bg-slate-950/55 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:border-white/50 hover:bg-slate-950/70"
                >
                  {content.secondaryCta}
                </Link>
              </div>
            </div>

            <article
              data-testid="product-value"
              className="landing-glass-panel relative overflow-hidden rounded-[2rem] p-6 sm:p-8 lg:p-10"
            >
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 size-52 rounded-full bg-blue-500/20 blur-3xl"
              />
              <div className="relative">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
                  {content.marker}
                </p>
                <h2 className="mt-4 text-balance text-2xl font-semibold tracking-[-0.03em] text-slate-100 sm:text-3xl">
                  {content.valueTitle}
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                  {content.valueDescription}
                </p>
                <div className="mt-8 space-y-3">
                  {content.values.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.title}
                        className="landing-glass-card grid grid-cols-[2.75rem_1fr] gap-4 rounded-2xl p-4 sm:p-5"
                      >
                        <span className="flex size-11 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-400/10 text-blue-300">
                          <Icon aria-hidden="true" className="size-5" />
                        </span>
                        <div>
                          <h3 className="font-semibold text-slate-100">{item.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-400">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          </div>
        </section>

        <ProductInterfacePreview section={content.section} locale={locale} />

        <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="landing-glass-panel mx-auto max-w-7xl rounded-[2rem] p-5 sm:p-8 lg:p-10">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
                {content.featureEyebrow}
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                {content.featureTitle}
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-300">
                {content.featureDescription}
              </p>
            </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {content.features.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="landing-glass-card landing-interactive-card group flex min-h-64 flex-col rounded-2xl p-6 sm:p-7"
                  >
                    <span className="flex size-12 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-300">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="mt-8 text-xl font-semibold text-slate-100">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-400">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="landing-glass-panel rounded-[2rem] p-7 sm:p-10">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                {content.proofLabel}
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100">
                {content.proofTitle}
              </h2>
              <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
                {content.proofDescription}
              </p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-3">
              {content.proofPoints.map((point, index) => (
                <li
                  key={point}
                  className="landing-glass-card flex min-h-52 flex-col rounded-2xl p-6"
                >
                  <span className="font-mono text-xs font-semibold text-blue-300">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Check aria-hidden="true" className="mt-auto size-5 text-emerald-300" />
                  <p className="mt-4 text-sm font-semibold leading-6 text-slate-100">
                    {point}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="px-4 pb-20 pt-10 sm:px-6 sm:pb-28 lg:px-8">
          <div className="landing-glass-panel relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-10 sm:py-16">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-32 w-2/3 -translate-x-1/2 rounded-full bg-blue-500/15 blur-3xl"
            />
            <div className="relative mx-auto max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
                UPTECH KNOWLEDGE
              </p>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] text-slate-100 sm:text-4xl">
                {content.ctaTitle}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                {content.ctaDescription}
              </p>
              <Link
                href="/login"
                className="group mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-blue-700"
              >
                {content.primaryCta}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/70 px-4 py-10 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/"
              aria-label={content.homeLabel}
              className="inline-flex min-h-11 items-center gap-3.5"
            >
              <Logo className="h-8 w-auto" />
              <span className="border-l border-slate-700 pl-3.5 text-xs font-bold tracking-[0.2em] text-slate-200">
                KNOWLEDGE
              </span>
            </Link>
            <p className="mt-4 max-w-lg text-sm leading-6 text-slate-400">
              {content.footerDescription}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              {content.secondaryCta}
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              {content.primaryCta}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export async function PublicInfoPage({
  section,
}: {
  readonly section: PublicInfoSection;
}) {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const content = getPublicInfoContent(section, locale);

  return <PublicInfoView content={content} locale={locale} />;
}
