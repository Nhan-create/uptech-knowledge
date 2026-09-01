import {
  requestIdFromHeaders,
} from "@/server/http/problem";
import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { createGoogleLoginRuntime } from "@/server/auth/google/runtime";
import { logAuthOperation } from "@/server/auth/operational-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectResponse(
  location: URL,
  loginCookie: string,
  requestId: string,
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: location.href,
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `__Host-uptech_login_tx=${loginCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
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
