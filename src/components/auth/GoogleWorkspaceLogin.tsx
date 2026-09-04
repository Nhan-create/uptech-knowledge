import Link from "next/link";
import Image from "next/image";

import Logo from "@/components/Logo";
import { LoginRecoveryActions } from "@/components/auth/LoginRecoveryActions";
import { SecurityPrivacyDisclosure } from "@/components/auth/SecurityPrivacyDisclosure";
import {
  LOGIN_RECOVERY_COPY_BY_LOCALE,
  resolveLoginRecoveryCopy,
} from "@/components/auth/login-recovery-copy";
import type { Locale } from "@/lib/preferences";
import type { RecoveryActionDescriptor, RecoveryState } from "@/server/auth/recovery-actions";

export function GoogleWorkspaceLogin({
  state,
  actions,
  csrfToken,
  requestId,
  retryAfterSeconds,
  locale,
}: {
  readonly state: RecoveryState | null;
  readonly actions: readonly RecoveryActionDescriptor[];
  readonly csrfToken: string | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly locale: Locale;
}) {
  const shellCopy = LOGIN_RECOVERY_COPY_BY_LOCALE[locale].shell;
  const resolvedCopy = resolveLoginRecoveryCopy(locale, state);
  const copy = resolvedCopy ?? resolveLoginRecoveryCopy(locale, "INTERNAL_ERROR")!;
  const executableActions = resolvedCopy === null ? [] : actions;

  return (
    <main
      id="main-content"
      className="relative isolate min-h-dvh overflow-hidden bg-[var(--bg-primary)] text-slate-100"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20">
        <video
          data-testid="login-background-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/media/login-background-poster.jpg"
          disablePictureInPicture
          className="size-full object-cover brightness-[1.25] saturate-[0.88] motion-reduce:hidden"
        >
          <source src="/media/login-background.mp4" type="video/mp4" />
        </video>
        <div
          data-testid="login-background-poster"
          className="hidden size-full bg-cover bg-center brightness-[1.25] saturate-[0.88] motion-reduce:block"
          style={{
            backgroundImage: "url('/media/login-background-poster.jpg')",
          }}
        />
      </div>
      <div
        data-testid="login-video-brightness"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-white/25"
      />

      <header
        data-media-surface="dark"
        className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-4 sm:px-7 sm:pt-6 lg:px-10"
      >
        <div className="flex items-center justify-between gap-3">
        <Link
          data-testid="login-header-brand"
          translate="no"
          href="/"
          aria-label={shellCopy.homeAriaLabel}
          className="notranslate inline-flex min-h-12 items-center gap-3 text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Logo className="h-7 w-auto" />
          <span className="hidden border-l border-slate-700 pl-3 text-[11px] font-bold tracking-[0.18em] text-slate-100 sm:inline">
            KNOWLEDGE
          </span>
        </Link>
        <Link
          data-testid="login-header-home"
          href="/"
          className="inline-flex min-h-12 items-center rounded-2xl border border-white/20 bg-slate-950/65 px-4 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(2,6,23,0.28)] backdrop-blur-xl transition-colors hover:bg-slate-950/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {shellCopy.home}
        </Link>
        </div>
      </header>

      <section
        aria-labelledby="login-title"
        className="relative z-10 flex min-h-[calc(100dvh-5.25rem)] items-center justify-center px-4 pb-20 pt-6 sm:px-8 sm:pb-24"
      >
        <div
          data-testid="login-card"
          className="animate-fade-in-up min-w-0 rounded-2xl border border-slate-700/80 bg-[var(--bg-surface)] p-6 shadow-[var(--panel-shadow)] motion-reduce:animate-none sm:rounded-3xl sm:p-8"
          style={{ width: "min(28rem, calc(100vw - 2rem))" }}
        >
          <div
            data-testid="login-uptech-logo"
            className="relative mx-auto h-[4.25rem] w-36 sm:w-40"
          >
            <Image
              src="/logo.png"
              alt="Uptech"
              width={212}
              height={91}
              className="login-brand-logo-base absolute inset-0 size-full object-contain"
              priority
              unoptimized
            />
            <Image
              src="/logo.png"
              alt=""
              aria-hidden="true"
              width={212}
              height={91}
              className="login-brand-logo-accent absolute inset-0 size-full object-contain"
              unoptimized
            />
          </div>

          <div
            role={copy.isError ? "alert" : undefined}
            className="mt-5 text-center"
          >
            <p translate="no" className="notranslate text-xs font-semibold uppercase tracking-[0.17em] text-blue-300">
              UPTECH KNOWLEDGE
            </p>
            <h1
              id="login-title"
              className="mt-3 text-balance text-2xl font-semibold tracking-[-0.03em] text-slate-100 sm:text-[1.75rem]"
            >
              {copy.title}
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-6 text-slate-400">
              {copy.description}
            </p>
          </div>

          {requestId !== null ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              {shellCopy.requestIdLabel}: <span className="font-mono text-slate-400">{requestId}</span>
            </p>
          ) : null}

          <LoginRecoveryActions
            state={state}
            actions={executableActions}
            csrfToken={csrfToken}
            requestId={requestId}
            retryAfterSeconds={retryAfterSeconds}
            locale={locale}
          />

          <div className="mt-5 flex flex-col items-center gap-3 border-t border-slate-800 pt-5">
            <SecurityPrivacyDisclosure locale={locale} />
          </div>
        </div>
      </section>
    </main>
  );
}
