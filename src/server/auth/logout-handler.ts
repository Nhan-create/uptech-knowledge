import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  authenticateWebSession,
  clearedWebSessionCookie,
  requireWebCsrf,
  revokeCurrentWebSession,
  WebSessionAuthenticationError,
  WebSessionCsrfError,
} from "./web-session.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import {
  createSafeProblem,
  problemResponse,
  requestIdFromHeaders,
} from "../http/problem.ts";
import { logAuthOperation } from "./operational-log.ts";

interface LogoutHandlerDependencies {
  readonly loadConfig: typeof loadWebSessionRuntimeConfig;
  readonly getPool: typeof getRuntimeDatabasePool;
  readonly authenticate: typeof authenticateWebSession;
  readonly requireCsrf: typeof requireWebCsrf;
  readonly revoke: typeof revokeCurrentWebSession;
  readonly requestId: typeof requestIdFromHeaders;
}

const productionDependencies: LogoutHandlerDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  authenticate: authenticateWebSession,
  requireCsrf: requireWebCsrf,
  revoke: revokeCurrentWebSession,
  requestId: requestIdFromHeaders,
});

function appendClearedCookie(response: Response): Response {
  response.headers.append("Set-Cookie", clearedWebSessionCookie());
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function createLogoutHandler(
  dependencies: LogoutHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async function logout(request: Request): Promise<Response> {
    const operationRequestId = dependencies.requestId(request.headers);
    try {
      const config = dependencies.loadConfig();
      const pool = dependencies.getPool(config.databaseUrl);
      const session = await dependencies.authenticate(
        request.headers,
        config.sessionPepper,
        pool,
      );
      dependencies.requireCsrf({
        request,
        appOrigin: config.appOrigin,
        session,
      });
      await dependencies.revoke(session, operationRequestId, pool);
      logAuthOperation({
        requestId: operationRequestId,
        operation: "WEB_LOGOUT",
        outcome: "REVOKED",
      });
      const response = appendClearedCookie(new Response(null, { status: 204 }));
      response.headers.set("X-Request-Id", operationRequestId);
      return response;
    } catch (error) {
      if (error instanceof WebSessionCsrfError) {
        logAuthOperation({
          requestId: operationRequestId,
          operation: "WEB_LOGOUT",
          outcome: "FORBIDDEN",
        });
        return problemResponse(
          createSafeProblem("FORBIDDEN", operationRequestId),
        );
      }
      if (error instanceof WebSessionAuthenticationError) {
        logAuthOperation({
          requestId: operationRequestId,
          operation: "WEB_LOGOUT",
          outcome: "UNAUTHENTICATED",
        });
        return appendClearedCookie(
          problemResponse(
            createSafeProblem("UNAUTHENTICATED", operationRequestId),
          ),
        );
      }
      logAuthOperation({
        requestId: operationRequestId,
        operation: "WEB_LOGOUT",
        outcome: "PROVIDER_UNAVAILABLE",
      });
      return problemResponse(
        createSafeProblem("PROVIDER_UNAVAILABLE", operationRequestId),
      );
    }
  };
}

export const logoutPost = createLogoutHandler(productionDependencies);
