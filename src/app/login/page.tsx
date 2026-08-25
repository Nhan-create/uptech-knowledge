import type { Metadata } from "next";
import { GoogleWorkspaceLogin } from "@/components/auth/GoogleWorkspaceLogin";

export const metadata: Metadata = {
  title: "Đăng nhập Google Workspace",
};

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const parameters = await searchParams;
  const error = typeof parameters.error === "string" ? parameters.error : undefined;
  return <GoogleWorkspaceLogin error={error} />;
}
