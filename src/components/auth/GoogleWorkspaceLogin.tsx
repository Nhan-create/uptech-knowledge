import Link from "next/link";
import { AlertCircle, ArrowLeft, LockKeyhole } from "lucide-react";

import Logo from "@/components/Logo";
import { GoogleLoginSubmitButton } from "@/components/auth/GoogleLoginSubmitButton";
import { SecurityPrivacyDisclosure } from "@/components/auth/SecurityPrivacyDisclosure";

type LoginState = Readonly<{
  title: string;
  description: string;
  actionLabel: string;
  isError: boolean;
  showAlternateAccountAction?: boolean;
}>;

const normalState: LoginState = Object.freeze({
  title: "Đăng nhập vào workspace",
  description: "Sử dụng tài khoản Google Workspace do tổ chức của bạn cấp.",
  actionLabel: "Tiếp tục với Google Workspace",
  isError: false,
});

const loginStates: Readonly<Record<string, LoginState>> = Object.freeze({
  personal_gmail: {
    title: "Không thể sử dụng tài khoản này",
    description:
      "UPTECH KNOWLEDGE chỉ cho phép tài khoản Google Workspace được tổ chức của bạn cấp.",
    actionLabel: "Đăng nhập bằng tài khoản khác",
    isError: true,
  },
  personal_account: {
    title: "Không thể sử dụng tài khoản này",
    description:
      "UPTECH KNOWLEDGE chỉ cho phép tài khoản Google Workspace được tổ chức của bạn cấp.",
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

function resolveLoginState(error?: string): LoginState {
  if (error === undefined) return normalState;
  return loginStates[error] ?? loginStates.login_failed;
}

export function GoogleWorkspaceLogin({
  error,
  account,
}: {
  readonly error?: string;
  readonly account?: string;
}) {
  const state = resolveLoginState(error);

  return (
    <main
      id="main-content"
      className="relative min-h-dvh overflow-hidden bg-[var(--bg-primary)] text-slate-100"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.055) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(circle at 50% 42%, black 0%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 size-[34rem] -translate-x-1/2 rounded-full bg-blue-600/14 blur-[140px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 bottom-0 size-96 rounded-full bg-violet-600/10 blur-[120px]"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <Link
          href="/"
          aria-label="UPTECH KNOWLEDGE - Trang chủ"
          className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Logo className="h-7 w-auto" />
          <span className="hidden border-l border-slate-700 pl-3 text-[11px] font-semibold tracking-[0.18em] text-slate-300 sm:inline">
            KNOWLEDGE
          </span>
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Trang chủ
        </Link>
      </header>

      <section
        aria-labelledby="login-title"
        className="relative z-10 flex min-h-[calc(100dvh-5.25rem)] items-center justify-center px-4 pb-20 pt-6 sm:px-8 sm:pb-24"
      >
        <div
          className="animate-fade-in-up min-w-0 rounded-2xl border border-slate-700/80 bg-[var(--bg-surface)] p-6 shadow-[var(--panel-shadow)] backdrop-blur motion-reduce:animate-none sm:rounded-3xl sm:p-8"
          style={{ width: "min(28rem, calc(100vw - 2rem))" }}
        >
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-300 shadow-[0_0_28px_rgba(37,99,235,0.12)]">
            {state.isError ? (
              <AlertCircle aria-hidden="true" className="size-5" />
            ) : (
              <LockKeyhole aria-hidden="true" className="size-5" />
            )}
          </div>

          <div
            role={state.isError ? "alert" : undefined}
            className="mt-5 text-center"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.17em] text-blue-300">
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
              <p className="text-xs text-slate-400">Tài khoản</p>
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

          <p
            id="login-description"
            className="mt-4 text-center text-xs leading-5 text-slate-400"
          >
            UPTECH không nhận hoặc lưu mật khẩu Google của bạn.
          </p>

          <div className="mt-5 flex flex-col items-center gap-3 border-t border-slate-800 pt-5">
            <SecurityPrivacyDisclosure />
            {state.showAlternateAccountAction ? (
              <Link
                href="/login"
                className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                Đăng nhập bằng tài khoản khác
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
