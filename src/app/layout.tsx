import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { cache } from "react";

import { PreferencesProvider } from "@/components/preferences/PreferencesProvider";
import { SettingsMenu } from "@/components/preferences/SettingsMenu";
import {
  LOCALE_COOKIE_NAME,
  parseLocale,
  parseTheme,
  THEME_COOKIE_NAME,
} from "@/lib/preferences";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const getRequestPreferences = cache(async () => {
  const cookieStore = await cookies();

  return {
    locale: parseLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value),
    theme: parseTheme(cookieStore.get(THEME_COOKIE_NAME)?.value),
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getRequestPreferences();

  return {
    title: {
      default:
        locale === "vi"
          ? "UPTECH KNOWLEDGE — Trợ lý tri thức AI cho doanh nghiệp"
          : "UPTECH KNOWLEDGE — Enterprise AI knowledge assistant",
      template: "%s | UPTECH KNOWLEDGE",
    },
    description:
      locale === "vi"
        ? "Tìm kiếm, hỏi đáp và kiểm chứng tri thức doanh nghiệp bằng AI trong đúng phạm vi quyền truy cập."
        : "Search, ask, and verify enterprise knowledge with AI within the correct access scope.",
    applicationName: "UPTECH KNOWLEDGE",
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getRequestPreferences();

  return {
    colorScheme: theme,
    themeColor: theme === "light" ? "#f7f9fc" : "#070a12",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, theme } = await getRequestPreferences();

  return (
    <html
      lang={locale}
      data-theme={theme}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <PreferencesProvider initialLocale={locale} initialTheme={theme}>
          {children}
          <SettingsMenu />
        </PreferencesProvider>
      </body>
    </html>
  );
}
