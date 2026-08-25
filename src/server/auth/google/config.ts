import { domainToASCII } from "node:url";

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const GOOGLE_LOGIN_SCOPE = "openid email profile";
export const GOOGLE_LOGIN_PURPOSE = "WEB_LOGIN";
export const GOOGLE_LOGIN_CONFIGURATION_KEY = "GOOGLE_WEB_LOGIN_V1";
export const GOOGLE_LOGIN_CALLBACK_PATH = "/api/v1/auth/google/callback";

export class GoogleLoginConfigurationError extends Error {
  override readonly name = "GoogleLoginConfigurationError";
}

export interface GoogleLoginRuntimeConfig {
  readonly appOrigin: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly workspaceDomainHint: string | null;
  readonly environmentId: string;
  readonly databaseUrl: string;
  readonly rateHmacKey: Uint8Array;
  readonly pkceEncryptionKey: Uint8Array;
  readonly pkceKeyVersion: string;
  readonly sessionPepper: Uint8Array;
}

export interface WebSessionRuntimeConfig {
  readonly appOrigin: string;
  readonly databaseUrl: string;
  readonly sessionPepper: Uint8Array;
}

type Environment = Readonly<Record<string, string | undefined>>;

function requireValue(
  environment: Environment,
  ...names: readonly string[]
): string {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }

  throw new GoogleLoginConfigurationError(
    `Required deployment configuration is missing: ${names.join(" or ")}`,
  );
}

function optionalValue(
  environment: Environment,
  ...names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function requireOrigin(value: string, production: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GoogleLoginConfigurationError("Application origin is invalid");
  }

  const isLocalDevelopment =
    !production &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new GoogleLoginConfigurationError("Application origin is invalid");
  }
  if (production && parsed.protocol !== "https:") {
    throw new GoogleLoginConfigurationError(
      "Production application origin must use HTTPS",
    );
  }
  if (!production && parsed.protocol !== "https:" && !isLocalDevelopment) {
    throw new GoogleLoginConfigurationError("Application origin is invalid");
  }

  return parsed.origin;
}

function requireRedirectUri(
  value: string,
  appOrigin: string,
  production: boolean,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GoogleLoginConfigurationError("Google redirect URI is invalid");
  }

  const expected = `${appOrigin}${GOOGLE_LOGIN_CALLBACK_PATH}`;
  if (
    parsed.href !== expected ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new GoogleLoginConfigurationError(
      "Google redirect URI does not match the approved callback",
    );
  }
  if (production && parsed.protocol !== "https:") {
    throw new GoogleLoginConfigurationError(
      "Production Google redirect URI must use HTTPS",
    );
  }
  return parsed.href;
}

function requireBase64UrlKey(label: string, value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new GoogleLoginConfigurationError(
      `${label} must be a canonical 256-bit base64url secret`,
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new GoogleLoginConfigurationError(
      `${label} must be a canonical 256-bit base64url secret`,
    );
  }
  return Uint8Array.from(decoded);
}

function requireEnvironmentId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) {
    throw new GoogleLoginConfigurationError("Environment identifier is invalid");
  }
  return value;
}

function requireKeyVersion(value: string): string {
  if (!/^[\x21-\x7e]{1,128}$/u.test(value)) {
    throw new GoogleLoginConfigurationError("PKCE key version is invalid");
  }
  return value;
}

function normalizeDomainHint(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const ascii = domainToASCII(value.toLowerCase());
  if (
    ascii.length < 1 ||
    ascii.length > 253 ||
    ascii.startsWith(".") ||
    ascii.endsWith(".") ||
    ascii.split(".").some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new GoogleLoginConfigurationError(
      "Google Workspace domain hint is invalid",
    );
  }
  return ascii;
}

export function loadGoogleLoginRuntimeConfig(
  environment: Environment = process.env,
): GoogleLoginRuntimeConfig {
  const production = environment.NODE_ENV === "production";
  const sessionConfig = loadWebSessionRuntimeConfig(environment);
  const appOrigin = sessionConfig.appOrigin;
  const redirectUri = requireRedirectUri(
    requireValue(environment, "GOOGLE_REDIRECT_URI"),
    appOrigin,
    production,
  );

  return Object.freeze({
    appOrigin,
    redirectUri,
    clientId: requireValue(
      environment,
      "GOOGLE_CLIENT_ID",
      "UPTECH_GOOGLE_LOGIN_WEB_CLIENT_ID",
    ),
    clientSecret: requireValue(environment, "GOOGLE_CLIENT_SECRET"),
    workspaceDomainHint: normalizeDomainHint(
      optionalValue(environment, "GOOGLE_WORKSPACE_DOMAIN"),
    ),
    environmentId: requireEnvironmentId(
      requireValue(environment, "UPTECH_ENVIRONMENT_ID", "VERCEL_ENV"),
    ),
    databaseUrl: sessionConfig.databaseUrl,
    rateHmacKey: requireBase64UrlKey(
      "Rate-limit HMAC key",
      requireValue(environment, "UPTECH_ENVIRONMENT_RATE_KEY"),
    ),
    pkceEncryptionKey: requireBase64UrlKey(
      "PKCE encryption key",
      requireValue(environment, "UPTECH_GOOGLE_LOGIN_PKCE_KEY"),
    ),
    pkceKeyVersion: requireKeyVersion(
      requireValue(environment, "UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION"),
    ),
    sessionPepper: sessionConfig.sessionPepper,
  });
}

export function loadWebSessionRuntimeConfig(
  environment: Environment = process.env,
): WebSessionRuntimeConfig {
  const production = environment.NODE_ENV === "production";
  return Object.freeze({
    appOrigin: requireOrigin(
      requireValue(environment, "PRODUCTION_BASE_URL", "UPTECH_APP_ORIGIN"),
      production,
    ),
    databaseUrl: requireValue(environment, "DATABASE_URL"),
    sessionPepper: requireBase64UrlKey(
      "Session pepper",
      requireValue(environment, "UPTECH_SESSION_PEPPER"),
    ),
  });
}
