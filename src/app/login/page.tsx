import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GoogleWorkspaceLogin } from "@/components/auth/GoogleWorkspaceLogin";
import { LOCALE_COOKIE_NAME, parseLocale } from "@/lib/preferences";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return { title: locale === "en" ? "Sign in" : "Đăng nhập" };
}

function safeAccount(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string" || value.length > 254) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const parameters = await searchParams;
  const error = typeof parameters.error === "string" ? parameters.error : undefined;
  const account = safeAccount(parameters.account);
  const cookieStore = await cookies();
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  return <GoogleWorkspaceLogin error={error} account={account} locale={locale} />;
}
