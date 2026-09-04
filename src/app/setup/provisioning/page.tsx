import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginRecoveryActions } from "@/components/auth/LoginRecoveryActions";
import { LOCALE_COOKIE_NAME, parseLocale, type Locale } from "@/lib/preferences";
import type { ProvisioningPublicState } from "@/server/auth/recovery-actions";
import { resolveProvisioningPageModel } from "@/server/onboarding/google-workspace/provisioning-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thiết lập tổ chức | UPTECH KNOWLEDGE",
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

type ProvisioningDisplayState = ProvisioningPublicState | "UNAVAILABLE";
type ProvisioningCopy = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>;

const PROVISIONING_COPY = Object.freeze({
  vi: Object.freeze({
    DIRECTORY_BOOTSTRAP_SYNC_PENDING: Object.freeze({
      eyebrow: "Thiết lập an toàn",
      title: "Tổ chức đã được thiết lập",
      description: "Danh bạ Google Workspace đang được đồng bộ.",
    }),
    DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: Object.freeze({
      eyebrow: "Cần thử lại",
      title: "Đồng bộ chưa hoàn tất",
      description: "Lần đồng bộ danh bạ chưa hoàn tất và có thể thử lại an toàn.",
    }),
    DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: Object.freeze({
      eyebrow: "Cần hỗ trợ",
      title: "UPTECH cần kiểm tra đồng bộ",
      description: "Đồng bộ danh bạ đã hết số lần thử an toàn và cần UPTECH kiểm tra.",
    }),
    READY: Object.freeze({
      eyebrow: "Sẵn sàng",
      title: "Tổ chức đã được thiết lập",
      description: "Danh bạ đã được đồng bộ. Hãy hoàn tất thiết lập để quay lại đăng nhập an toàn.",
    }),
    UNAVAILABLE: Object.freeze({
      eyebrow: "Chưa thể xác minh",
      title: "Trạng thái thiết lập chưa khả dụng",
      description: "UPTECH chưa thể xác minh trạng thái thiết lập lúc này. Chưa có quyền truy cập nào được cấp. Hãy liên hệ UPTECH và cung cấp mã yêu cầu.",
    }),
  }),
  en: Object.freeze({
    DIRECTORY_BOOTSTRAP_SYNC_PENDING: Object.freeze({
      eyebrow: "Secure setup",
      title: "Organization setup is complete",
      description: "Google Workspace Directory is synchronizing.",
    }),
    DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE: Object.freeze({
      eyebrow: "Retry available",
      title: "Synchronization is not complete",
      description: "Directory synchronization did not finish and can be safely retried.",
    }),
    DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED: Object.freeze({
      eyebrow: "Support required",
      title: "UPTECH needs to inspect synchronization",
      description: "Safe synchronization retries are exhausted and UPTECH needs to inspect the setup.",
    }),
    READY: Object.freeze({
      eyebrow: "Ready",
      title: "Organization setup is complete",
      description: "Directory is synchronized. Finish setup to return to secure sign-in.",
    }),
    UNAVAILABLE: Object.freeze({
      eyebrow: "Unable to verify",
      title: "Setup status is unavailable",
      description: "UPTECH cannot verify setup status right now. No access has been granted. Contact UPTECH with the request ID.",
    }),
  }),
} satisfies Readonly<Record<Locale, Readonly<Record<ProvisioningDisplayState, ProvisioningCopy>>>>);

export default async function ProvisioningPage() {
  const model = await resolveProvisioningPageModel(new Headers(await headers()));
  if (model.kind === "REDIRECT") {
    redirect(model.destination);
  }

  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const displayState: ProvisioningDisplayState = model.kind === "RENDER" ? model.state : "UNAVAILABLE";
  const copy = PROVISIONING_COPY[locale][displayState];
  const isProblem = model.kind === "UNAVAILABLE" || model.state.includes("FAILED");

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg-primary)] px-4 py-10 text-[var(--text-primary)] sm:px-6">
      <section
        aria-labelledby="provisioning-title"
        className="w-full max-w-lg rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--panel-shadow)] sm:p-10"
      >
        <div className="mb-8 flex items-center gap-3" aria-label="UPTECH KNOWLEDGE">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-blue-600 text-lg font-black text-white shadow-sm">U</span>
          <span className="text-sm font-bold tracking-[0.18em] text-[var(--text-primary)]">UPTECH KNOWLEDGE</span>
        </div>

        <div
          role={isProblem ? "alert" : "status"}
          aria-live={isProblem ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-500">{copy.eyebrow}</p>
          <h1 id="provisioning-title" className="mt-3 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)] sm:text-base">{copy.description}</p>
        </div>

        <LoginRecoveryActions
          actions={model.actions}
          csrfToken={model.kind === "RENDER" ? model.csrfToken : null}
          requestId={model.requestId}
          state={model.kind === "RENDER" && model.state !== "READY" ? model.state : null}
          retryAfterSeconds={null}
          locale={locale}
        />

        <p data-testid="provisioning-request-id" className="mt-6 break-all border-t border-[var(--border-subtle)] pt-5 text-xs text-[var(--text-muted)]">
          {locale === "vi" ? "Mã yêu cầu" : "Request ID"}: <span className="font-mono">{model.requestId}</span>
        </p>
      </section>
    </main>
  );
}
