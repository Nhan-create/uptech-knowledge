import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { readCurrentUserProfile } from "@/server/auth/user-profile";
import { resolveWebRouteAuthority } from "@/server/auth/web-route-authority";
import { isWorkspacePreviewModeEnabled } from "@/server/knowledge/access-context";

const gleanSans = Manrope({
  variable: "--font-glean-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

const gleanMono = IBM_Plex_Mono({
  variable: "--font-glean-mono",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
});

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const requestHeaders = await headers();
  if (!isWorkspacePreviewModeEnabled()) {
    const authority = await resolveWebRouteAuthority(requestHeaders, "HOME");
    if (authority === "LOGIN") {
      redirect("/login?error=session_expired");
    }
  }
  const userProfile = await readCurrentUserProfile(requestHeaders);

  return (
    <div
      className={`${gleanSans.variable} ${gleanMono.variable} uptech-glean-workspace`}
    >
      <AppShell userProfile={userProfile}>{children}</AppShell>
    </div>
  );
}
