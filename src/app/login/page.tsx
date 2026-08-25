import type { Metadata } from "next";
import { GoogleWorkspaceLogin } from "@/components/auth/GoogleWorkspaceLogin";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

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
  return <GoogleWorkspaceLogin error={error} account={account} />;
}
