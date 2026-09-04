import type { Metadata } from "next";
import { cookies } from "next/headers";
import Logo from "@/components/Logo";
import { LOCALE_COOKIE_NAME, parseLocale, type Locale } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Google Workspace domain verification | UPTECH KNOWLEDGE",
  description: "Safe Google Workspace domain verification guidance for Super Administrators.",
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

type DomainHelpCopy = Readonly<{
  eyebrow: string;
  title: string;
  introduction: string;
  assurance: string;
  steps: readonly string[];
  adminActionLabel: string;
  backLabel: string;
}>;

const DOMAIN_HELP_COPY = Object.freeze({
  vi: Object.freeze({
    eyebrow: "Cần xác minh với Google",
    title: "Xác minh domain Google Workspace",
    introduction: "Quá trình thiết lập bị chặn vì Google chưa xác nhận domain Google Workspace là đã được xác minh.",
    assurance: "UPTECH không tin domain do người dùng nhập và không suy luận quyền sở hữu tổ chức từ địa chỉ email.",
    steps: Object.freeze([
      "Đăng nhập bằng tài khoản Google Workspace Super Admin của công ty.",
      "Trong Google Admin, mở Tài khoản → Miền → Quản lý miền.",
      "Hoàn tất bước xác minh Google yêu cầu, thường bằng một bản ghi DNS TXT.",
      "Chờ trạng thái đã xác minh và đang hoạt động, rồi quay lại UPTECH bằng chính tài khoản đó.",
      "Nếu bạn không có quyền cần thiết, hãy gửi hướng dẫn này cho Super Admin; không có cách bỏ qua bước xác minh.",
    ]),
    adminActionLabel: "Mở Quản lý miền trong Google Admin",
    backLabel: "Quay lại đăng nhập",
  }),
  en: Object.freeze({
    eyebrow: "Google verification required",
    title: "Verify your Google Workspace domain",
    introduction: "Setup is blocked because Google has not confirmed the Google Workspace domain as verified.",
    assurance: "UPTECH never trusts a typed domain or infers organization ownership from an email address.",
    steps: Object.freeze([
      "Sign in with the company's Google Workspace Super Admin account.",
      "In Google Admin, open Account → Domains → Manage domains.",
      "Complete Google's verification step, commonly by adding a DNS TXT record.",
      "Wait until the domain is verified and active, then return to UPTECH with the same account.",
      "If you lack the required privilege, send these instructions to your Super Admin; there is no verification bypass.",
    ]),
    adminActionLabel: "Open Manage domains in Google Admin",
    backLabel: "Back to sign in",
  }),
} satisfies Readonly<Record<Locale, DomainHelpCopy>>);

export default async function DomainVerificationHelpPage() {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const copy = DOMAIN_HELP_COPY[locale];

  return (
    <main className="min-h-dvh bg-[var(--bg-primary)] px-4 py-10 text-[var(--text-primary)] sm:px-6 sm:py-16">
      <article
        aria-labelledby="domain-verification-help-title"
        className="mx-auto w-full max-w-2xl rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--panel-shadow)] sm:p-10"
      >
        <div className="flex items-center gap-3" aria-label="UPTECH KNOWLEDGE">
          <Logo className="h-8 w-auto" />
          <span className="text-sm font-bold tracking-[0.16em]">KNOWLEDGE</span>
        </div>

        <header className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--status-warning)]">{copy.eyebrow}</p>
          <h1 id="domain-verification-help-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-5 text-base leading-7 text-[var(--text-secondary)]">{copy.introduction}</p>
          <p className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
            {copy.assurance}
          </p>
        </header>

        <ol className="mt-8 space-y-5" aria-label={locale === "vi" ? "Các bước xác minh" : "Verification steps"}>
          {copy.steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[2.25rem_1fr] gap-3 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[var(--bg-elevated)] font-mono text-sm font-bold text-[var(--accent-primary)]">
                {index + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <a
            href="https://admin.google.com/ac/domains/manage"
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]"
          >
            {copy.adminActionLabel}
          </a>
          <a
            href="/login"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-3 text-center text-sm font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]"
          >
            {copy.backLabel}
          </a>
        </div>
      </article>
    </main>
  );
}
