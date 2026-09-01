import {
  authenticateWebSession,
  WebSessionAuthenticationError,
} from "@/server/auth/web-session";
import { loadWebSessionRuntimeConfig } from "@/server/auth/google/config";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import {
  createSafeProblem,
  problemResponse,
  requestIdFromHeaders,
} from "@/server/http/problem";
import { logAuthOperation } from "@/server/auth/operational-log";
import { classifyRequestCredential } from "@/server/http/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const operationRequestId = requestIdFromHeaders(request.headers);
  const credential = classifyRequestCredential(request.headers);
  if (!credential.ok || credential.kind !== "cookie") {
    return problemResponse(
      createSafeProblem("UNAUTHENTICATED", operationRequestId),
    );
  }
  try {
    const config = loadWebSessionRuntimeConfig();
    const session = await authenticateWebSession(
      request.headers,
      config.sessionPepper,
      getRuntimeDatabasePool(config.databaseUrl),
    );
    logAuthOperation({
      requestId: operationRequestId,
      operation: "WEB_SESSION_BOOTSTRAP",
      outcome: "AUTHORIZED",
    });
    return Response.json(
      {
        authenticated: true,
        user: {
          id: session.context.actorId,
          workspace_id: session.context.workspaceId,
          role: session.context.workspaceRole,
        },
        csrf_token: session.csrfCredential,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": operationRequestId,
        },
      },
    );
  } catch (error) {
    if (error instanceof WebSessionAuthenticationError) {
      return problemResponse(
        createSafeProblem("UNAUTHENTICATED", operationRequestId),
      );
    }
    return problemResponse(
      createSafeProblem("PROVIDER_UNAVAILABLE", operationRequestId),
    );
  }
}
