import type { DatabasePool } from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  authenticateWebSession,
  type AuthenticatedWebSession,
  WebSessionAuthenticationError,
} from "./web-session.ts";

export type WebRouteTarget = "HOME" | "ADMIN";
export type WebRouteAuthorityDecision = "ALLOW" | "ADMIN" | "HOME" | "LOGIN";

export interface WebRouteAuthorityDependencies {
  readonly loadConfig: () => {
    readonly databaseUrl: string;
    readonly sessionPepper: Uint8Array;
  };
  readonly getPool: (
    databaseUrl: string,
  ) => Pick<DatabasePool, "query">;
  readonly authenticate: (
    headers: Headers,
    sessionPepper: Uint8Array,
    pool: Pick<DatabasePool, "query">,
  ) => Promise<AuthenticatedWebSession>;
}

const productionDependencies: WebRouteAuthorityDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  authenticate: authenticateWebSession,
});

function decisionForRole(
  target: WebRouteTarget,
  workspaceRole: unknown,
): WebRouteAuthorityDecision {
  if (workspaceRole === "MEMBER") {
    return target === "HOME" ? "ALLOW" : "HOME";
  }
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
    return target === "ADMIN" ? "ALLOW" : "ADMIN";
  }
  return "LOGIN";
}

/**
 * Resolves the destination from the current verified Web session only.
 * Callers must redirect for every non-ALLOW result before rendering a route.
 */
export async function resolveWebRouteAuthority(
  headers: Headers,
  target: WebRouteTarget,
  dependencies: WebRouteAuthorityDependencies = productionDependencies,
): Promise<WebRouteAuthorityDecision> {
  try {
    const config = dependencies.loadConfig();
    const session = await dependencies.authenticate(
      headers,
      config.sessionPepper,
      dependencies.getPool(config.databaseUrl),
    );
    return decisionForRole(target, session.context.workspaceRole);
  } catch (error) {
    if (error instanceof WebSessionAuthenticationError) return "LOGIN";
    throw error;
  }
}
