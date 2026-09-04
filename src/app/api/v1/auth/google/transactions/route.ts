import {
  requestIdFromHeaders,
} from "@/server/http/problem";
import {
  LOGIN_TRANSACTION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
  isCanonicalProof,
  trustedVercelClientIp,
} from "@/server/auth/google/crypto";
import { inspectBrowserAuthority } from "@/server/auth/browser-authority";
import { createGoogleLoginRuntime } from "@/server/auth/google/runtime";
import { logAuthOperation } from "@/server/auth/operational-log";
import { resolveWebRouteAuthorityDetailed } from "@/server/auth/web-route-authority";
import { clearedWebSessionCookie } from "@/server/auth/web-session";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "@/server/onboarding/google-workspace/crypto";
import { exactCsrfCredential } from "@/server/onboarding/google-workspace/http";
import { WEB_SESSION_COOKIE_NAME } from "@/server/sessions/session-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_INTENT_BODY_BYTES = 256;

type LoginIntent =
  | { readonly kind: "LOGIN"; readonly csrfToken: string | null }
  | { readonly kind: "SWITCH_ACCOUNT"; readonly csrfToken: string | null };

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function hasCookieName(headers: Headers, name: string): boolean {
  const cookieHeader = headers.get("cookie");
  return cookieHeader !== null && cookieHeader.split(";").some((part) => {
    const trimmed = part.trim();
    return trimmed === name || trimmed.startsWith(`${name}=`);
  });
}

function exactlyOneCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return null;
  const values = cookieHeader.split(";").flatMap((part) => {
    const trimmed = part.trim();
    return trimmed.startsWith(`${name}=`) ? [trimmed.slice(name.length + 1)] : [];
  });
  return values.length === 1 && values[0] !== "" ? values[0]! : null;
}

async function boundedIntentBody(request: Request): Promise<Uint8Array | null> {
  const advertisedLength = request.headers.get("content-length");
  if (advertisedLength !== null && (!/^[0-9]+$/u.test(advertisedLength) ||
      Number(advertisedLength) > MAX_INTENT_BODY_BYTES)) {
    await request.body?.cancel();
    return null;
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_INTENT_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function loginIntent(request: Request): Promise<LoginIntent | null> {
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (url.search !== "" || url.hash !== "" || request.headers.has("authorization")) return null;

  const bytes = await boundedIntentBody(request);
  if (bytes === null) return null;
  if (bytes.byteLength === 0) {
    const contentType = request.headers.get("content-type");
    return contentType === null || contentType === FORM_CONTENT_TYPE
      ? { kind: "LOGIN", csrfToken: null }
      : null;
  }
  if (bytes.byteLength > MAX_INTENT_BODY_BYTES ||
      request.headers.get("content-type") !== FORM_CONTENT_TYPE) return null;

  let body: string;
  try { body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return null; }
  if (body.includes("\0")) return null;

  const values = new URLSearchParams(body);
  const intent = values.getAll("intent");
  if (intent.length !== 1) return null;
  if (intent[0] === "LOGIN") {
    const csrfToken = values.getAll("csrf_token");
    if (values.size !== 1 + csrfToken.length || csrfToken.length > 1) return null;
    if (csrfToken.length === 0) {
      return body === "intent=LOGIN" ? { kind: "LOGIN", csrfToken: null } : null;
    }
    const csrf = csrfToken[0]!;
    return isCanonicalProof(csrf) && body === `intent=LOGIN&csrf_token=${csrf}`
      ? { kind: "LOGIN", csrfToken: csrf }
      : null;
  }
  if (intent[0] !== "SWITCH_ACCOUNT") return null;
  const csrfToken = values.getAll("csrf_token");
  if (values.size !== 1 + csrfToken.length || csrfToken.length > 1) return null;
  if (csrfToken.length === 0) {
    return body === "intent=SWITCH_ACCOUNT" ? { kind: "SWITCH_ACCOUNT", csrfToken: null } : null;
  }
  const csrf = csrfToken[0]!;
  return isCanonicalProof(csrf) && body === `intent=SWITCH_ACCOUNT&csrf_token=${csrf}`
    ? { kind: "SWITCH_ACCOUNT", csrfToken: csrf }
    : null;
}

function isExactSameOriginAction(request: Request, appOrigin: string): boolean {
  try {
    return request.url === new URL("/api/v1/auth/google/transactions", appOrigin).href &&
      request.headers.get("origin") === appOrigin &&
      request.headers.get("sec-fetch-site") === "same-origin";
  } catch {
    return false;
  }
}

function fixedRedirect(appOrigin: string, path: "/admin" | "/home", requestId: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: new URL(path, appOrigin).href,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

function staleWebReplay(appOrigin: string, requestId: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Location: new URL("/api/v1/auth/google/transactions", appOrigin).href,
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  headers.append("Set-Cookie", clearedWebSessionCookie());
  return new Response(null, { status: 307, headers });
}

function redirectResponse(
  location: URL,
  loginCookie: string,
  requestId: string,
  staleCookieHeaders: readonly string[],
  clearOnboarding: boolean,
  clearSetup: boolean,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Location: location.href,
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  for (const cookie of staleCookieHeaders) headers.append("Set-Cookie", cookie);
  if (clearOnboarding) headers.append("Set-Cookie", clearingCookie(ONBOARDING_COOKIE_NAME));
  if (clearSetup) headers.append("Set-Cookie", clearingCookie(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME));
  headers.append(
    "Set-Cookie",
    `${LOGIN_TRANSACTION_COOKIE_NAME}=${loginCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  return new Response(null, {
    status: 303,
    headers,
  });
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
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: location,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const operationRequestId = requestIdFromHeaders(request.headers);
  let appOrigin: string | null = null;
  try {
    const runtimeContext = createGoogleLoginRuntime();
    appOrigin = runtimeContext.config.appOrigin;
    const hasBrowserAuthority = hasCookieName(request.headers, WEB_SESSION_COOKIE_NAME) ||
      hasCookieName(request.headers, ONBOARDING_COOKIE_NAME);
    const authority = hasBrowserAuthority
      ? await inspectBrowserAuthority(
        request.headers,
        runtimeContext.pool,
        { sessionPepper: runtimeContext.config.sessionPepper },
      )
      : { active: false, activeKind: null, onboardingAuthority: null, staleCookieHeaders: [] };

    const intent = await loginIntent(request);
    if (intent === null) {
      logAuthOperation({
        requestId: operationRequestId,
        operation: "GOOGLE_LOGIN_TRANSACTION",
        outcome: "DENIED",
      });
      return redirectToLogin(appOrigin, "login_failed", operationRequestId);
    }

    if (authority.activeKind === "WEB_SESSION") {
      const webAuthority = await resolveWebRouteAuthorityDetailed(request.headers, "HOME");
      if (webAuthority.kind === "ROUTE") {
        const path = webAuthority.decision === "ADMIN" ? "/admin" : "/home";
        return fixedRedirect(appOrigin, path, operationRequestId);
      }
      if (webAuthority.kind === "UNAVAILABLE") {
        return redirectToLogin(appOrigin, "temporarily_unavailable", operationRequestId);
      }
      if (!isExactSameOriginAction(request, appOrigin)) {
        logAuthOperation({ requestId: operationRequestId, operation: "GOOGLE_LOGIN_TRANSACTION", outcome: "DENIED" });
        return redirectToLogin(appOrigin, "login_failed", operationRequestId);
      }
      return staleWebReplay(appOrigin, operationRequestId);
    }
    if (authority.activeKind === "ONBOARDING") {
      const onboardingCredential = exactlyOneCookie(request.headers, ONBOARDING_COOKIE_NAME);
      if (!isExactSameOriginAction(request, appOrigin) ||
          onboardingCredential === null || !isCanonicalProof(onboardingCredential) ||
          !exactCsrfCredential(intent.csrfToken, onboardingCredential, runtimeContext.config.sessionPepper)) {
        logAuthOperation({ requestId: operationRequestId, operation: "GOOGLE_LOGIN_TRANSACTION", outcome: "DENIED" });
        return redirectToLogin(appOrigin, "login_failed", operationRequestId);
      }
    }

    const result = await runtimeContext.service.initiate({
      canonicalClientIp: trustedVercelClientIp(request.headers),
      requestId: operationRequestId,
    });
    if (result.outcome === "REDIRECT") {
      logAuthOperation({
        requestId: operationRequestId,
        operation: "GOOGLE_LOGIN_TRANSACTION",
        outcome: "REDIRECT",
      });
      return redirectResponse(
        result.authorizationUrl,
        result.loginCookie,
        operationRequestId,
        authority.staleCookieHeaders,
        authority.activeKind === "ONBOARDING",
        hasCookieName(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME),
      );
    }
    if (result.outcome === "RATE_LIMITED") {
      logAuthOperation({
        requestId: operationRequestId,
        operation: "GOOGLE_LOGIN_TRANSACTION",
        outcome: "RATE_LIMITED",
      });
      return redirectToLogin(appOrigin, "rate_limited", operationRequestId);
    }
    logAuthOperation({
      requestId: operationRequestId,
      operation: "GOOGLE_LOGIN_TRANSACTION",
      outcome: "DENIED",
    });
    return redirectToLogin(appOrigin, "login_failed", operationRequestId);
  } catch {
    logAuthOperation({
      requestId: operationRequestId,
      operation: "GOOGLE_LOGIN_TRANSACTION",
      outcome: "PROVIDER_UNAVAILABLE",
    });
    return redirectToLogin(appOrigin, "temporarily_unavailable", operationRequestId);
  }
}
