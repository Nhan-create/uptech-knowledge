import {
  LOGIN_TRANSACTION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
  trustedVercelClientIp,
} from "@/server/auth/google/crypto";
import { createGoogleLoginRuntime } from "@/server/auth/google/runtime";
import { inspectBrowserAuthority } from "@/server/auth/browser-authority";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import {
  createSafeProblem,
  problemResponse,
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

function redirectToLogin(
  appOrigin: string,
  error: string,
  requestId: string,
): Response {
  const location = new URL("/login", appOrigin);
  location.searchParams.set("error", error);
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Location: location.href,
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

export async function GET(request: Request): Promise<Response> {
  const operationRequestId = requestIdFromHeaders(request.headers);
  let staleCookieHeaders: readonly string[] = [];
  let preexistingBrowserAuthority = false;
  try {
    const runtimeContext = createGoogleLoginRuntime();
    const incoming = new URL(request.url);
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
        );
        staleCookieHeaders = authority.staleCookieHeaders;
        preexistingBrowserAuthority = authority.active;
        return authority.active;
      },
      requestId: operationRequestId,
    });
    if (preexistingBrowserAuthority) {
      logCallback(operationRequestId, "DENIED");
      return appendCookies(
        redirectToLogin(
          runtimeContext.config.appOrigin,
          "active_authority",
          operationRequestId,
        ),
        staleCookieHeaders,
      );
    }
    if (result.outcome === "NORMAL") {
      logCallback(operationRequestId, "NORMAL");
      const headers = new Headers({
        "Cache-Control": "no-store, max-age=0",
        Location: new URL("/home", runtimeContext.config.appOrigin).href,
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
    if (result.outcome === "ONBOARDING") {
      logCallback(operationRequestId, "ONBOARDING");
      const response = redirectToLogin(
        runtimeContext.config.appOrigin,
        "access_required",
        operationRequestId,
      );
      for (const cookie of replacementCookieHeaders(
        staleCookieHeaders,
        `${ONBOARDING_COOKIE_NAME}=${result.onboardingCredential}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`,
      )) {
        response.headers.append("Set-Cookie", cookie);
      }
      return response;
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
  } catch {
    logCallback(operationRequestId, "PROVIDER_UNAVAILABLE");
    const response = problemResponse(
      createSafeProblem("PROVIDER_UNAVAILABLE", operationRequestId),
    );
    response.headers.set("Referrer-Policy", "no-referrer");
    return appendCookies(response, staleCookieHeaders);
  }
}
