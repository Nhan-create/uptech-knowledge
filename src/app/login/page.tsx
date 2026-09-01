import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleWorkspaceLogin } from "@/components/auth/GoogleWorkspaceLogin";
import { LOCALE_COOKIE_NAME, parseLocale } from "@/lib/preferences";
import {
  resolveLoginPageAuthority,
  resolveLoginPageError,
} from "@/server/auth/login-page-authority";
import { WEB_SESSION_COOKIE_NAME } from "@/server/sessions/session-security";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return { title: locale === "en" ? "Sign in" : "Đăng nhập" };
}

function safeRequestId(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const parameters = await searchParams;
  const requestedError =
    typeof parameters.error === "string" ? parameters.error : undefined;
  const requestId = safeRequestId(parameters.request_id);
  const cookieStore = await cookies();
  const requestHeaders = new Headers(await headers());
  const authority = await resolveLoginPageAuthority(
    requestHeaders,
    cookieStore.get(WEB_SESSION_COOKIE_NAME) !== undefined,
  );
  if (authority === "HOME") {
    redirect("/home");
  }
  const error = resolveLoginPageError(requestedError, authority);
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return <GoogleWorkspaceLogin error={error} requestId={requestId} locale={locale} />;
}
