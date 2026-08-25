export type Locale = "vi" | "en";
export type Theme = "light" | "dark";

export const DEFAULT_LOCALE: Locale = "vi";
export const DEFAULT_THEME: Theme = "dark";

export const LOCALE_COOKIE_NAME = "uptech-locale";
export const THEME_COOKIE_NAME = "uptech-theme";

const PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseLocale(value: string | null | undefined): Locale {
  return value === "vi" || value === "en" ? value : DEFAULT_LOCALE;
}

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

function writePreferenceCookie(name: string, value: string) {
  if (typeof document === "undefined") return;

  const secureAttribute =
    window.location.protocol === "https:" ? "; Secure" : "";

  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secureAttribute}`;
  } catch {
    // Keep the validated preference usable in memory when persistence is
    // blocked by the browser or an embedding sandbox.
  }
}

export function writeLocaleCookie(value: string | null | undefined): Locale {
  const locale = parseLocale(value);
  writePreferenceCookie(LOCALE_COOKIE_NAME, locale);
  return locale;
}

export function writeThemeCookie(value: string | null | undefined): Theme {
  const theme = parseTheme(value);
  writePreferenceCookie(THEME_COOKIE_NAME, theme);
  return theme;
}
