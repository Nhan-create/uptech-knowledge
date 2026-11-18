import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminScaffold } from "@/components/admin/AdminScaffold";
import { readCurrentUserProfile } from "@/server/auth/user-profile";
import { resolveWebRouteAuthority } from "@/server/auth/web-route-authority";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  const authority = await resolveWebRouteAuthority(requestHeaders, "ADMIN");
  if (authority === "HOME") redirect("/home");
  if (authority === "LOGIN") redirect("/login?error=session_expired");
  if (authority !== "ALLOW") {
    throw new Error("Unexpected admin route authority");
  }
  const userProfile = await readCurrentUserProfile(requestHeaders);

  return (
    <AppShell userProfile={userProfile}>
      <AdminScaffold>{children}</AdminScaffold>
    </AppShell>
  );
}
