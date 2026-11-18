import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { ProfileWorkbench } from "@/components/workspace/ProfileWorkbench";
import {
  LOCALE_COOKIE_NAME,
  parseLocale,
  parseTheme,
  THEME_COOKIE_NAME,
} from "@/lib/preferences";
import { readCurrentUserProfile } from "@/server/auth/user-profile";

export const metadata: Metadata = {
  title: "Hồ sơ & bảo mật",
};

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const locale = parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const userProfile = await readCurrentUserProfile(requestHeaders);

  return (
    <ProfileWorkbench
      initialProfile={userProfile}
      initialLocale={locale}
      initialTheme={theme}
    />
  );
}
