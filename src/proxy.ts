import { type NextRequest, NextResponse } from "next/server.js";

import { classifyUnconfiguredRoute } from "@/security/route-containment.mjs";

const WORKSPACE_PREVIEW_EXACT_PATHS = new Set([
  "/dashboard",
  "/chat",
  "/knowledge",
  "/utility",
  "/search",
  "/notifications",
  "/profile",
  "/documents",
  "/documents/compare",
]);

const WORKSPACE_PREVIEW_DYNAMIC_PATTERNS = [
  /^\/documents\/[a-zA-Z0-9_-]{3,80}$/u,
  /^\/documents\/spaces\/[a-zA-Z0-9_-]{3,80}$/u,
];

const WORKSPACE_API_EXACT_PATHS = new Set([
  "/api/v1/workspace/chat",
  "/api/v1/workspace/chat/sessions",
  "/api/v1/workspace/documents",
  "/api/v1/workspace/spaces",
  "/api/v1/workspace/compare",
  "/api/v1/workspace/search",
  "/api/v1/workspace/knowledge",
  "/api/v1/workspace/utility",
  "/api/v1/workspace/notifications",
]);

const WORKSPACE_API_DOCUMENT_PATTERN =
  /^\/api\/v1\/workspace\/(?:documents|knowledge)\/[a-zA-Z0-9_-]{3,80}(?:\/download)?$/u;

const WORKSPACE_API_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PATCH",
  "DELETE",
]);

function isWorkspaceApiRoute(pathname: string, method: string): boolean {
  if (!WORKSPACE_API_METHODS.has(method)) {
    return false;
  }
  return (
    WORKSPACE_API_EXACT_PATHS.has(pathname) ||
    WORKSPACE_API_DOCUMENT_PATTERN.test(pathname)
  );
}

function hasSessionCookieCredential(request: NextRequest): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader.includes("__Host-uptech_session=");
}

function isLocalWorkspacePreviewRequest(pathname: string, method: string) {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }

  if (process.env.UPTECH_WORKSPACE_PREVIEW !== "true") {
    return false;
  }

  if (isWorkspaceApiRoute(pathname, method)) {
    return true;
  }

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (WORKSPACE_PREVIEW_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return WORKSPACE_PREVIEW_DYNAMIC_PATTERNS.some((pattern) =>
    pattern.test(pathname),
  );
}

export function proxy(request: NextRequest) {
  const routeDecision = classifyUnconfiguredRoute(
    request.nextUrl.pathname,
    request.method,
  );
  const allowWorkspacePreview = isLocalWorkspacePreviewRequest(
    request.nextUrl.pathname,
    request.method,
  );
  const allowAuthenticatedWorkspaceApi =
    isWorkspaceApiRoute(request.nextUrl.pathname, request.method) &&
    hasSessionCookieCredential(request);
  const requestId = crypto.randomUUID();

  if (
    routeDecision === "allow-public" ||
    routeDecision === "allow-auth-ingress" ||
    routeDecision === "allow-protected" ||
    allowWorkspacePreview ||
    allowAuthenticatedWorkspaceApi
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
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    },
  );
}
