import {
  createSafeProblem,
  problemResponse,
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

export async function POST(request: Request): Promise<Response> {
  const operationRequestId = requestIdFromHeaders(request.headers);
  try {
    const runtimeContext = createGoogleLoginRuntime();
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
      return problemResponse(
        createSafeProblem("RATE_LIMITED", operationRequestId),
      );
    }
    logAuthOperation({
      requestId: operationRequestId,
      operation: "GOOGLE_LOGIN_TRANSACTION",
      outcome: "DENIED",
    });
    return problemResponse(createSafeProblem("FORBIDDEN", operationRequestId));
  } catch {
    logAuthOperation({
      requestId: operationRequestId,
      operation: "GOOGLE_LOGIN_TRANSACTION",
      outcome: "PROVIDER_UNAVAILABLE",
    });
    return problemResponse(
      createSafeProblem("PROVIDER_UNAVAILABLE", operationRequestId),
    );
  }
}
