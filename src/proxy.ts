import { type NextRequest, NextResponse } from "next/server";

import { classifyUnconfiguredRoute } from "@/security/route-containment.mjs";

export function proxy(request: NextRequest) {
  const routeDecision = classifyUnconfiguredRoute(
    request.nextUrl.pathname,
    request.method,
  );
  const requestId = crypto.randomUUID();

  if (
    routeDecision === "allow-public" ||
    routeDecision === "allow-auth-ingress" ||
    routeDecision === "allow-protected"
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-uptech-request-id", requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("X-Request-ID", requestId);
    return response;
  }

  return NextResponse.json(
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Secure workspace access is not configured.",
        requestId,
      },
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    },
  );
}
