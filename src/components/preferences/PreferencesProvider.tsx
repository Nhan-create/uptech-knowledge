"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  type Locale,
  parseLocale,
  parseTheme,
  type Theme,
  writeLocaleCookie,
  writeThemeCookie,
} from "@/lib/preferences";

const THEME_COLORS: Record<Theme, string> = {
  light: "#f7f9fc",
  dark: "#070a12",
};

export type PreferencesContextValue = Readonly<{
  locale: Locale;
  theme: Theme;
  isLocalePending: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
}>;

export type PreferencesProviderProps = Readonly<{
  children: ReactNode;
  initialLocale: Locale;
  initialTheme: Theme;
}>;

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const themeColor = THEME_COLORS[theme];
  const themeColorMeta = document.head.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (themeColorMeta.length > 0) {
    themeColorMeta.forEach((meta) => {
      meta.content = themeColor;
    });
    return;
  }

  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = themeColor;
  document.head.append(meta);
}

export function PreferencesProvider({
  children,
  initialLocale,
  initialTheme,
}: PreferencesProviderProps) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(() =>
    parseLocale(initialLocale),
  );
  const [theme, setThemeState] = useState<Theme>(() =>
    parseTheme(initialTheme),
  );
  const [isLocalePending, startLocaleTransition] = useTransition();

  useEffect(() => {
    applyLocale(locale);
    applyTheme(theme);
  }, [locale, theme]);

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      const validatedLocale = writeLocaleCookie(nextLocale);
      applyLocale(validatedLocale);

      if (validatedLocale === locale) return;

      setLocaleState(validatedLocale);
      startLocaleTransition(() => {
        router.refresh();
      });
    },
    [locale, router],
  );

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      const validatedTheme = writeThemeCookie(nextTheme);
      applyTheme(validatedTheme);

      if (validatedTheme === theme) return;
      setThemeState(validatedTheme);
      router.refresh();
    },
    [router, theme],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      locale,
      theme,
      isLocalePending,
      setLocale,
      setTheme,
    }),
    [isLocalePending, locale, setLocale, setTheme, theme],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error(
      "usePreferences must be used within a PreferencesProvider.",
    );
  }

  return context;
}
