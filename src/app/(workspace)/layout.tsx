import type { ReactNode } from "react";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { readCurrentUserProfile } from "@/server/auth/user-profile";

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
  const userProfile = await readCurrentUserProfile(await headers());

  return (
    <div
      className={`${gleanSans.variable} ${gleanMono.variable} uptech-glean-workspace`}
    >
      <AppShell userProfile={userProfile}>{children}</AppShell>
    </div>
  );
}
