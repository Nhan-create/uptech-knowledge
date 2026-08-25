import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Check,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import Logo from "@/components/Logo";
import { GoogleLoginSubmitButton } from "@/components/auth/GoogleLoginSubmitButton";

const prerequisites = [
  "Danh tính được xác minh trực tiếp bởi Google",
  "Workspace được phân giải từ hosted domain đã kiểm chứng",
  "Phiên UPTECH riêng biệt, không dùng Google token làm phiên",
] as const;

const safeErrors: Readonly<Record<string, string>> = Object.freeze({
  access_required:
    "Tài khoản đã được xác minh nhưng chưa có quyền vào workspace. Hãy liên hệ quản trị viên.",
  rate_limited: "Có quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau ít phút.",
  temporarily_unavailable:
    "Dịch vụ xác minh danh tính tạm thời chưa sẵn sàng. Vui lòng thử lại.",
  provider_rejected: "Yêu cầu đăng nhập Google đã bị hủy hoặc từ chối.",
  login_failed:
    "Không thể hoàn tất đăng nhập bằng tài khoản này. Quyền truy cập chưa được cấp.",
  active_authority:
    "Trình duyệt đang có một phiên hoặc yêu cầu cấp quyền khác. Hãy đăng xuất trước khi đổi tài khoản.",
});

export function GoogleWorkspaceLogin({ error }: { readonly error?: string }) {
  const safeError = error === undefined ? undefined : safeErrors[error];
  return (
    <main
      id="main-content"
      className="relative min-h-dvh overflow-hidden bg-[var(--bg-primary)] text-slate-100"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.07) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "linear-gradient(120deg, black 0%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-1/3 size-96 rounded-full bg-blue-600/15 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 bottom-0 size-96 rounded-full bg-violet-600/10 blur-[120px]"
      />

      <div className="relative mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
          <div className="flex items-center justify-between">
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
          </div>

          <div className="my-auto hidden max-w-lg py-16 lg:block">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Permission-first by design
            </div>
            <p className="mt-7 text-balance text-5xl font-semibold leading-[1.08] tracking-[-0.045em] text-slate-100">
              Tri thức đúng nguồn, dành cho đúng người.
            </p>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-400">
              Truy cập chỉ được mở sau khi danh tính Google Workspace,
              workspace và quyền tài liệu có thể được xác minh phía máy chủ.
            </p>
            <div className="mt-10 space-y-4">
              {[
                "Không dùng email suffix làm tenant boundary",
                "Không tin role hoặc workspace do trình duyệt gửi lên",
                "Không đưa nội dung chưa được phép vào AI context",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 text-sm text-slate-300"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <p className="hidden text-xs text-slate-400 lg:block">
            © 2026 UPTECH · Secure access containment
          </p>
        </div>

        <section
          aria-labelledby="login-title"
          className="flex items-center justify-center px-4 pb-8 sm:px-8 lg:border-l lg:border-slate-800/80 lg:px-12 lg:py-10"
        >
          <div className="animate-fade-in-up w-full max-w-[32rem] rounded-2xl border border-slate-700/80 bg-[var(--bg-surface)] p-5 shadow-[var(--panel-shadow)] backdrop-blur motion-reduce:animate-none sm:rounded-3xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                  <span className="size-1.5 rounded-full bg-amber-300" />
                  Đăng nhập bảo mật
                </div>
                <h1
                  id="login-title"
                  className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-slate-100 sm:text-3xl"
                >
                  Đăng nhập UPTECH KNOWLEDGE
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Tiếp tục bằng tài khoản Google Workspace của tổ chức. Hệ
                  thống chỉ mở phiên sau khi xác minh danh tính, domain và quyền
                  thành viên ở phía máy chủ.
                </p>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                <LockKeyhole aria-hidden="true" className="size-5" />
              </div>
            </div>

            <div
              role="status"
              aria-live="polite"
              className="mt-7 rounded-xl border border-slate-700 bg-slate-950/55 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Building2 aria-hidden="true" className="size-4 text-blue-300" />
                Luồng xác minh production
              </div>
              <ul className="mt-4 space-y-3">
                {prerequisites.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm leading-6 text-slate-300"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-500"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {safeError !== undefined ? (
              <p
                role="alert"
                className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100"
              >
                {safeError}
              </p>
            ) : null}
            <form action="/api/v1/auth/google/transactions" method="post">
              <GoogleLoginSubmitButton />
            </form>
            <p
              id="login-description"
              className="mt-3 text-center text-xs leading-5 text-slate-400"
            >
              Chỉ yêu cầu các scope openid, email và profile. Không có mật khẩu,
              OTP hoặc demo bypass.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
