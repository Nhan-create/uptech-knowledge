import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminScaffold } from "@/components/admin/AdminScaffold";
import { resolveAdminContextFromHeaders } from "@/server/admin/auth";
import { getAdminShellMetadata } from "@/server/admin/repository";
import { readCurrentUserProfile } from "@/server/auth/user-profile";
import { resolveWebRouteAuthority } from "@/server/auth/web-route-authority";
import { isWorkspacePreviewModeEnabled } from "@/server/knowledge/access-context";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  if (!isWorkspacePreviewModeEnabled()) {
    const authority = await resolveWebRouteAuthority(requestHeaders, "ADMIN");
    if (authority === "HOME") redirect("/home");
    if (authority === "LOGIN") redirect("/login?error=session_expired");
    if (authority !== "ALLOW") {
      throw new Error("Unexpected admin route authority");
    }
  }

  const [userProfile, adminContext] = await Promise.all([
    readCurrentUserProfile(requestHeaders),
    resolveAdminContextFromHeaders(new Headers(requestHeaders)),
  ]);
  const shellMetadata = adminContext
    ? await getAdminShellMetadata(adminContext)
    : null;

  return (
    <AppShell userProfile={userProfile}>
      <AdminScaffold shellMetadata={shellMetadata}>{children}</AdminScaffold>
    </AppShell>
  );
}
