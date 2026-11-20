import {
  LOGIN_TRANSACTION_COOKIE_NAME,
  isCanonicalProof,
  trustedVercelClientIp,
} from "@/server/auth/google/crypto";
import { createGoogleLoginRuntime } from "@/server/auth/google/runtime";
import { inspectBrowserAuthority } from "@/server/auth/browser-authority";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "@/server/onboarding/google-workspace/crypto";
import { serializeOnboardingCookie } from "@/server/onboarding/google-workspace/http";
import {
  requestIdFromHeaders,
} from "@/server/http/problem";
import { serializeWebSessionCookie } from "@/server/sessions/session-security";
import { replacementCookieHeaders } from "@/server/auth/replacement-cookies";
import {
  logAuthOperation,
  type AuthOperationOutcome,
} from "@/server/auth/operational-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ONBOARDING_COOKIE_AGE_SECONDS = 24 * 60 * 60;

function readUniqueCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) {
    return null;
  }
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    values.push(part.slice(separator + 1).trim());
  }
  return values.length === 1 && values[0].length > 0 ? values[0] : null;
}

function clearLoginCookie(headers: Headers): void {
  headers.append(
    "Set-Cookie",
    `${LOGIN_TRANSACTION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function hasCookie(headers: Headers, name: string): boolean {
  const cookieHeader = headers.get("cookie");
  return cookieHeader !== null && cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}

function onboardingCookieFromCommittedExpiry(
  credential: string,
  expiresAt: Date,
  now: Date,
): string | null {
  if (
    !isCanonicalProof(credential) ||
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime())
  ) {
    return null;
  }
  const maxAge = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isSafeInteger(maxAge) || maxAge < 1) {
    return null;
  }
  return serializeOnboardingCookie(
    credential,
    Math.min(maxAge, MAX_ONBOARDING_COOKIE_AGE_SECONDS),
  );
}

function redirectToLogin(
  appOrigin: string | null,
  error: string,
  requestId: string,
): Response {
  const search = new URLSearchParams({ error, request_id: requestId });
  const location = appOrigin === null
    ? `/login?${search.toString()}`
    : new URL(`/login?${search.toString()}`, appOrigin).href;
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Location: location,
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  clearLoginCookie(headers);
  return new Response(null, { status: 303, headers });
}

function logCallback(requestId: string, outcome: AuthOperationOutcome): void {
  logAuthOperation({
    requestId,
    operation: "GOOGLE_LOGIN_CALLBACK",
    outcome,
  });
}

function appendCookies(response: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

function safeAccessError(accessState: string): string {
  if (accessState === "UNKNOWN_WORKSPACE") return "unknown_workspace";
  if (accessState === "USER_NOT_PROVISIONED") return "access_required";
  if (accessState === "ACCESS_MAPPING_CONFLICT") return "access_mapping_conflict";
  if (accessState === "USER_SUSPENDED") return "user_suspended";
  if (accessState === "USER_REMOVED") return "user_removed";
  if (accessState === "DIRECTORY_SYNC_PENDING") return "directory_sync_pending";
  if (accessState === "DIRECTORY_STALE") return "directory_stale";
  if (accessState === "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE") return "directory_stale_access_request_available";
  if (accessState === "WORKSPACE_SUSPENDED") return "workspace_suspended";
  return "login_failed";
}

export async function GET(request: Request): Promise<Response> {
  const operationRequestId = requestIdFromHeaders(request.headers);
  const setupCookieClear = hasCookie(
    request.headers,
    GOOGLE_WORKSPACE_SETUP_COOKIE_NAME,
  ) ? [clearingCookie(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME)] : [];
  let staleCookieHeaders: readonly string[] = setupCookieClear;
  let preexistingBrowserAuthority = false;
  let preexistingBrowserAuthorityKind: "WEB_SESSION" | "ONBOARDING" | null = null;
  let appOrigin: string | null = null;
  try {
    const runtimeContext = createGoogleLoginRuntime();
    appOrigin = runtimeContext.config.appOrigin;
    const incoming = new URL(request.url);
    if (incoming.searchParams.has("code") && !incoming.searchParams.has("error")) {
      await (
        runtimeContext as { readonly refreshDueDirectorySync?: () => Promise<void> }
      ).refreshDueDirectorySync?.();
    }
    const result = await runtimeContext.service.callback({
      canonicalClientIp: trustedVercelClientIp(request.headers),
      callbackSearch: incoming.search,
      loginCookie: readUniqueCookie(
        request.headers,
        LOGIN_TRANSACTION_COOKIE_NAME,
      ),
      inspectPreexistingBrowserAuthority: async () => {
        const authority = await inspectBrowserAuthority(
          request.headers,
          getRuntimeDatabasePool(runtimeContext.config.databaseUrl),
          { sessionPepper: runtimeContext.config.sessionPepper },
        );
        staleCookieHeaders = [
          ...authority.staleCookieHeaders,
          ...setupCookieClear,
        ];
        preexistingBrowserAuthority = authority.active;
        preexistingBrowserAuthorityKind = authority.activeKind;
        return authority.active;
      },
      requestId: operationRequestId,
    });
    if (preexistingBrowserAuthority) {
      logCallback(operationRequestId, "DENIED");
      return appendCookies(
        redirectToLogin(
          runtimeContext.config.appOrigin,
          preexistingBrowserAuthorityKind === "ONBOARDING"
            ? "access_required"
            : "active_authority",
          operationRequestId,
        ),
        staleCookieHeaders,
      );
    }
    if (result.outcome === "NORMAL") {
      if (result.route !== "/admin" && result.route !== "/home") {
        logCallback(operationRequestId, "DENIED");
        return appendCookies(
          redirectToLogin(
            runtimeContext.config.appOrigin,
            "login_failed",
            operationRequestId,
          ),
          staleCookieHeaders,
        );
      }
      logCallback(operationRequestId, "NORMAL");
      const headers = new Headers({
        "Cache-Control": "no-store, max-age=0",
        Location: new URL(result.route, runtimeContext.config.appOrigin).href,
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": operationRequestId,
      });
      clearLoginCookie(headers);
      for (const cookie of replacementCookieHeaders(
        staleCookieHeaders,
        serializeWebSessionCookie(result.sessionCredential),
      )) {
        headers.append("Set-Cookie", cookie);
      }
      return new Response(null, { status: 303, headers });
    }
    if (result.outcome === "ACCESS_DENIED") {
      logCallback(operationRequestId, "DENIED");
      return appendCookies(
        redirectToLogin(
          runtimeContext.config.appOrigin,
          safeAccessError(result.accessState),
          operationRequestId,
        ),
        staleCookieHeaders,
      );
    }
    if (result.outcome === "ONBOARDING") {
      const onboardingCookie = onboardingCookieFromCommittedExpiry(
        result.onboardingCredential,
        result.expiresAt,
        new Date(),
      );
      if (onboardingCookie === null) {
        logCallback(operationRequestId, "DENIED");
        return appendCookies(
          redirectToLogin(
            runtimeContext.config.appOrigin,
            "login_failed",
            operationRequestId,
          ),
          staleCookieHeaders,
        );
      }
      logCallback(operationRequestId, "ONBOARDING");
      return appendCookies(
        redirectToLogin(
          runtimeContext.config.appOrigin,
          safeAccessError(result.accessState),
          operationRequestId,
        ),
        replacementCookieHeaders(staleCookieHeaders, onboardingCookie),
      );
    }
    const safeError =
      result.outcome === "RATE_LIMITED"
        ? "rate_limited"
        : result.outcome === "PERSONAL_GOOGLE_ACCOUNT"
          ? "personal_account"
          : result.outcome === "PROVIDER_UNAVAILABLE"
            ? "temporarily_unavailable"
            : result.outcome === "PROVIDER_REJECTED"
              ? "provider_rejected"
              : "login_failed";
    logCallback(
      operationRequestId,
      result.outcome === "RATE_LIMITED"
        ? "RATE_LIMITED"
        : result.outcome === "PROVIDER_UNAVAILABLE"
          ? "PROVIDER_UNAVAILABLE"
          : result.outcome === "PROVIDER_REJECTED"
            ? "PROVIDER_REJECTED"
            : "DENIED",
    );
    return appendCookies(
      redirectToLogin(
        runtimeContext.config.appOrigin,
        safeError,
        operationRequestId,
      ),
      staleCookieHeaders,
    );
  } catch (error) {
    const errName = error instanceof Error ? error.name : "UnknownError";
    const errCode =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    const safeRepoMessage =
      errName === "GoogleLoginRepositoryError" && error instanceof Error
        ? error.message
        : null;
    console.error(
      JSON.stringify({
        event: "GOOGLE_LOGIN_CALLBACK_EXCEPTION",
        request_id: operationRequestId,
        error_name: errName,
        error_code: errCode ?? null,
        error_message: safeRepoMessage,
      }),
    );
    logCallback(operationRequestId, "PROVIDER_UNAVAILABLE");
    const response = redirectToLogin(
      appOrigin,
      "temporarily_unavailable",
      operationRequestId,
    );
    return appendCookies(response, staleCookieHeaders);
  }
}
