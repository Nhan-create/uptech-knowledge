import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleWorkspaceLogin } from "@/components/auth/GoogleWorkspaceLogin";
import { LOCALE_COOKIE_NAME, parseLocale } from "@/lib/preferences";
import { resolveLoginPageViewModel } from "@/server/auth/login-page-authority";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return { title: locale === "en" ? "Sign in" : "Đăng nhập" };
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const parameters = await searchParams;
  const cookieStore = await cookies();
  const requestHeaders = new Headers(await headers());
  const model = await resolveLoginPageViewModel(requestHeaders, {
    error: parameters.error,
    request_id: parameters.request_id,
  });
  if (model.kind === "REDIRECT") {
    redirect(model.destination);
  }
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return (
    <GoogleWorkspaceLogin
      state={model.state}
      actions={model.actions}
      csrfToken={model.csrfToken}
      requestId={model.requestId}
      retryAfterSeconds={model.retryAfterSeconds}
      locale={locale}
    />
  );
}
