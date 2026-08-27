import Link from "next/link";
import Image from "next/image";

import Logo from "@/components/Logo";
import { GoogleLoginSubmitButton } from "@/components/auth/GoogleLoginSubmitButton";
import { SecurityPrivacyDisclosure } from "@/components/auth/SecurityPrivacyDisclosure";
import type { Locale } from "@/lib/preferences";

type LoginState = Readonly<{
  title: string;
  description: string;
  actionLabel: string;
  isError: boolean;
  showAlternateAccountAction?: boolean;
}>;

type LoginCopy = Readonly<{
  normal: LoginState;
  states: Readonly<Record<string, LoginState>>;
  home: string;
  homeLabel: string;
  account: string;
  alternateAccount: string;
}>;

const vietnameseStates: Readonly<Record<string, LoginState>> = Object.freeze({
  personal_gmail: {
    title: "Tài khoản không hợp lệ",
    description: "Vui lòng nhập tài khoản Workspace, không phải tài khoản Google.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  personal_account: {
    title: "Tài khoản không hợp lệ",
    description: "Vui lòng nhập tài khoản Workspace, không phải tài khoản Google.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  unknown_workspace: {
    title: "Không tìm thấy workspace",
    description:
      "Tài khoản Google của bạn đã được xác minh, nhưng tổ chức này chưa được cấu hình trên UPTECH KNOWLEDGE.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  workspace_not_found: {
    title: "Không tìm thấy workspace",
    description:
      "Tài khoản Google của bạn đã được xác minh, nhưng tổ chức này chưa được cấu hình trên UPTECH KNOWLEDGE.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  access_required: {
    title: "Bạn chưa được cấp quyền truy cập",
    description:
      "Vui lòng liên hệ quản trị viên workspace để được cấp quyền sử dụng UPTECH KNOWLEDGE.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  not_provisioned: {
    title: "Bạn chưa được cấp quyền truy cập",
    description:
      "Vui lòng liên hệ quản trị viên workspace để được cấp quyền sử dụng UPTECH KNOWLEDGE.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  suspended: {
    title: "Quyền truy cập đã bị tạm ngưng",
    description:
      "Tài khoản này hiện không còn quyền truy cập UPTECH KNOWLEDGE. Vui lòng liên hệ quản trị viên của tổ chức.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  session_expired: {
    title: "Phiên đăng nhập đã hết hạn",
    description: "Vui lòng đăng nhập lại để tiếp tục.",
    actionLabel: "Tiếp tục với Google Workspace",
    isError: false,
  },
  rate_limited: {
    title: "Vui lòng thử lại sau",
    description:
      "Có quá nhiều yêu cầu đăng nhập. Vui lòng đợi ít phút rồi thử lại.",
    actionLabel: "Thử lại",
    isError: true,
  },
  temporarily_unavailable: {
    title: "Tạm thời không thể đăng nhập",
    description:
      "Dịch vụ xác minh tài khoản đang tạm thời gián đoạn. Vui lòng thử lại.",
    actionLabel: "Thử lại",
    isError: true,
    showAlternateAccountAction: true,
  },
  provider_rejected: {
    title: "Đăng nhập chưa hoàn tất",
    description:
      "Yêu cầu đăng nhập đã bị hủy hoặc từ chối. Bạn có thể thử lại khi sẵn sàng.",
    actionLabel: "Thử lại",
    isError: true,
    showAlternateAccountAction: true,
  },
  active_authority: {
    title: "Đã có phiên đăng nhập khác",
    description:
      "Trình duyệt đang có một phiên đăng nhập hoặc yêu cầu cấp quyền khác. Vui lòng đăng xuất trước khi đổi tài khoản.",
    actionLabel: "Thử lại",
    isError: true,
  },
  login_failed: {
    title: "Không thể đăng nhập",
    description:
      "Đã xảy ra lỗi trong quá trình xác minh tài khoản. Vui lòng thử lại.",
    actionLabel: "Thử lại",
    isError: true,
    showAlternateAccountAction: true,
  },
});

const englishStates: Readonly<Record<string, LoginState>> = Object.freeze({
  personal_gmail: {
    title: "Invalid account",
    description: "Please use a Workspace account, not a personal Google account.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  personal_account: {
    title: "Invalid account",
    description: "Please use a Workspace account, not a personal Google account.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  unknown_workspace: {
    title: "Workspace not found",
    description:
      "Your Google account was verified, but this organization has not been configured in UPTECH KNOWLEDGE.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  workspace_not_found: {
    title: "Workspace not found",
    description:
      "Your Google account was verified, but this organization has not been configured in UPTECH KNOWLEDGE.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  access_required: {
    title: "Access has not been granted",
    description: "Contact your workspace administrator to request access to UPTECH KNOWLEDGE.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  not_provisioned: {
    title: "Access has not been granted",
    description: "Contact your workspace administrator to request access to UPTECH KNOWLEDGE.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  suspended: {
    title: "Access suspended",
    description:
      "This account no longer has access to UPTECH KNOWLEDGE. Contact your organization administrator.",
    actionLabel: "Sign in with another account",
    isError: true,
  },
  session_expired: {
    title: "Session expired",
    description: "Sign in again to continue.",
    actionLabel: "Continue with Google Workspace",
    isError: false,
  },
  rate_limited: {
    title: "Please try again later",
    description: "Too many sign-in requests were received. Wait a few minutes and try again.",
    actionLabel: "Try again",
    isError: true,
  },
  temporarily_unavailable: {
    title: "Sign-in is temporarily unavailable",
    description: "The account verification service is temporarily unavailable. Please try again.",
    actionLabel: "Try again",
    isError: true,
    showAlternateAccountAction: true,
  },
  provider_rejected: {
    title: "Sign-in was not completed",
    description: "The sign-in request was cancelled or declined. Try again when you are ready.",
    actionLabel: "Try again",
    isError: true,
    showAlternateAccountAction: true,
  },
  active_authority: {
    title: "Another sign-in session is active",
    description:
      "This browser already has another sign-in or authorization request. Sign out before switching accounts.",
    actionLabel: "Try again",
    isError: true,
  },
  login_failed: {
    title: "Unable to sign in",
    description: "An error occurred while verifying your account. Please try again.",
    actionLabel: "Try again",
    isError: true,
    showAlternateAccountAction: true,
  },
});

const loginCopy: Record<Locale, LoginCopy> = {
  vi: {
    normal: {
      title: "Đăng nhập vào workspace",
      description: "Sử dụng tài khoản Workspace của bạn.",
      actionLabel: "Tiếp tục với Google Workspace",
      isError: false,
    },
    states: vietnameseStates,
    home: "Trang chủ",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    account: "Tài khoản",
    alternateAccount: "Đăng nhập bằng tài khoản khác",
  },
  en: {
    normal: {
      title: "Sign in to your workspace",
      description: "Use your Workspace account.",
      actionLabel: "Continue with Google Workspace",
      isError: false,
    },
    states: englishStates,
    home: "Home",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    account: "Account",
    alternateAccount: "Sign in with another account",
  },
};

function resolveLoginState(copy: LoginCopy, error?: string): LoginState {
  if (error === undefined) return copy.normal;
  return copy.states[error] ?? copy.states.login_failed;
}

export function GoogleWorkspaceLogin({
  error,
  account,
  locale,
}: {
  readonly error?: string;
  readonly account?: string;
  readonly locale: Locale;
}) {
  const copy = loginCopy[locale];
  const state = resolveLoginState(copy, error);

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
          aria-label={copy.homeLabel}
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
          {copy.home}
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
            role={state.isError ? "alert" : undefined}
            className="mt-5 text-center"
          >
            <p translate="no" className="notranslate text-xs font-semibold uppercase tracking-[0.17em] text-blue-300">
              UPTECH KNOWLEDGE
            </p>
            <h1
              id="login-title"
              className="mt-3 text-balance text-2xl font-semibold tracking-[-0.03em] text-slate-100 sm:text-[1.75rem]"
            >
              {state.title}
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-6 text-slate-400">
              {state.description}
            </p>
          </div>

          {account !== undefined ? (
            <div className="mt-5 rounded-xl border border-slate-700/80 bg-slate-950/45 px-4 py-3 text-sm">
              <p className="text-xs text-slate-400">{copy.account}</p>
              <p className="mt-1 break-all font-medium text-slate-200">
                {account}
              </p>
            </div>
          ) : null}

          <div aria-live="polite">
            <form action="/api/v1/auth/google/transactions" method="post">
              <GoogleLoginSubmitButton label={state.actionLabel} />
            </form>
          </div>

          <div className="mt-5 flex flex-col items-center gap-3 border-t border-slate-800 pt-5">
            <SecurityPrivacyDisclosure locale={locale} />
            {state.showAlternateAccountAction ? (
              <Link
                href="/login"
                className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                {copy.alternateAccount}
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
