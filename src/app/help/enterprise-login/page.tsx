import type { Metadata } from "next";
import { cookies } from "next/headers";
import Logo from "@/components/Logo";
import { LOCALE_COOKIE_NAME, parseLocale, type Locale } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Enterprise login help | UPTECH KNOWLEDGE",
  description: "Supported Google Workspace accounts and safe organization setup guidance.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

type EnterpriseHelpCopy = Readonly<{
  eyebrow: string;
  title: string;
  introduction: string;
  steps: readonly string[];
  backLabel: string;
}>;

const ENTERPRISE_HELP_COPY = Object.freeze({
  vi: Object.freeze({
    eyebrow: "Trợ giúp đăng nhập",
    title: "Đăng nhập doanh nghiệp bằng Google Workspace",
    introduction: "UPTECH chặn tài khoản Gmail cá nhân vì quyền truy cập doanh nghiệp yêu cầu tài khoản Google Workspace do công ty quản lý.",
    steps: Object.freeze([
      "Chỉ Google Workspace Super Admin của chính công ty đó mới có thể thiết lập tổ chức lần đầu.",
      "Nhân viên hoặc quản trị viên được ủy quyền chưa đủ quyền thiết lập trong phiên bản V1.",
      "Nếu tổ chức đã tồn tại, nhân viên cần Membership UPTECH đang hoạt động và ánh xạ Group, OU hoặc Department do OWNER/ADMIN của công ty cấp.",
      "Quyền Google Super Admin chỉ là bằng chứng để khởi tạo tổ chức; quyền đó không biến người dùng thành quản trị viên nền tảng hoặc hệ thống UPTECH.",
    ]),
    backLabel: "Quay lại đăng nhập",
  }),
  en: Object.freeze({
    eyebrow: "Sign-in help",
    title: "Enterprise access with Google Workspace",
    introduction: "UPTECH blocks personal Gmail accounts because enterprise access requires a company-managed Google Workspace account.",
    steps: Object.freeze([
      "Only that company's Google Workspace Super Admin can perform first-time organization setup.",
      "An employee or delegated administrator does not have enough privilege for V1 setup.",
      "If the organization already exists, an employee needs an active UPTECH Membership and a Group, OU, or Department mapping granted by that company's UPTECH OWNER/ADMIN.",
      "Google Super Admin status is evidence only for organization bootstrap; it does not make the person an UPTECH platform or system administrator.",
    ]),
    backLabel: "Back to sign in",
  }),
} satisfies Readonly<Record<Locale, EnterpriseHelpCopy>>);

export default async function EnterpriseLoginHelpPage() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const copy = ENTERPRISE_HELP_COPY[locale];

  return (
    <main className="min-h-dvh bg-[var(--bg-primary)] px-4 py-10 text-[var(--text-primary)] sm:px-6 sm:py-16">
      <article
        aria-labelledby="enterprise-login-help-title"
        className="mx-auto w-full max-w-2xl rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--panel-shadow)] sm:p-10"
      >
        <div className="flex items-center gap-3" aria-label="UPTECH KNOWLEDGE">
          <Logo className="h-8 w-auto" />
          <span className="text-sm font-bold tracking-[0.16em]">KNOWLEDGE</span>
        </div>

        <header className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent-primary)]">{copy.eyebrow}</p>
          <h1 id="enterprise-login-help-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-5 text-base leading-7 text-[var(--text-secondary)]">{copy.introduction}</p>
        </header>

        <ol className="mt-8 space-y-5" aria-label={locale === "vi" ? "Các điều kiện truy cập" : "Access requirements"}>
          {copy.steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[2.25rem_1fr] gap-3 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[var(--bg-elevated)] font-mono text-sm font-bold text-[var(--accent-primary)]">
                {index + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>

        <a
          href="/login"
          className="mt-10 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] sm:w-auto"
        >
          {copy.backLabel}
        </a>
      </article>
    </main>
  );
}
