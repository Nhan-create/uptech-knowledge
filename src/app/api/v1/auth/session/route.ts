import {
  authenticateWebSession,
  clearedWebSessionCookie,
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
import { requireCurrentDirectoryAuthority } from "@/server/auth/directory-authority";

interface WebSessionBootstrapDependencies {
  readonly loadConfig: typeof loadWebSessionRuntimeConfig;
  readonly getPool: typeof getRuntimeDatabasePool;
  readonly authenticate: typeof authenticateWebSession;
  readonly requireDirectoryAuthority: typeof requireCurrentDirectoryAuthority;
  readonly requestId: typeof requestIdFromHeaders;
  readonly log: typeof logAuthOperation;
}

const productionDependencies: WebSessionBootstrapDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  authenticate: authenticateWebSession,
  requireDirectoryAuthority: requireCurrentDirectoryAuthority,
  requestId: requestIdFromHeaders,
  log: logAuthOperation,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createWebSessionBootstrapGet(
  dependencies: WebSessionBootstrapDependencies = productionDependencies,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const operationRequestId = dependencies.requestId(request.headers);
    const credential = classifyRequestCredential(request.headers);
    if (!credential.ok || credential.kind !== "cookie") {
      return problemResponse(
        createSafeProblem("UNAUTHENTICATED", operationRequestId),
      );
    }
    try {
      const config = dependencies.loadConfig();
      const pool = dependencies.getPool(config.databaseUrl);
      const session = await dependencies.authenticate(
        request.headers,
        config.sessionPepper,
        pool,
      );
      if (!await dependencies.requireDirectoryAuthority(session, pool)) {
        dependencies.log({
          requestId: operationRequestId,
          operation: "WEB_SESSION_BOOTSTRAP",
          outcome: "UNAUTHENTICATED",
        });
        return problemResponse(
          createSafeProblem("UNAUTHENTICATED", operationRequestId),
        );
      }
      dependencies.log({
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
        const response = problemResponse(
          createSafeProblem("UNAUTHENTICATED", operationRequestId),
        );
        if (typeof clearedWebSessionCookie === "function") {
          response.headers.append("Set-Cookie", clearedWebSessionCookie());
        }
        return response;
      }
      return problemResponse(
        createSafeProblem("PROVIDER_UNAVAILABLE", operationRequestId),
      );
    }
  };
}

export const GET = createWebSessionBootstrapGet();
