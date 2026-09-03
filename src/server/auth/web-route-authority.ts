import {
  type DatabasePool,
} from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { requireCurrentDirectoryAuthority } from "./directory-authority.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  authenticateWebSession,
  type AuthenticatedWebSession,
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
  ) => Pick<DatabasePool, "connect" | "query">;
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
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
    return target === "ADMIN" ? "ALLOW" : "ADMIN";
  }
  if (workspaceRole === "MEMBER") {
    return target === "HOME" ? "ALLOW" : "HOME";
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
    const pool = dependencies.getPool(config.databaseUrl);
    const session = await dependencies.authenticate(
      headers,
      config.sessionPepper,
      pool,
    );
    if (!await requireCurrentDirectoryAuthority(session, pool)) {
      return "LOGIN";
    }
    return decisionForRole(target, session.context.workspaceRole);
  } catch {
    return "LOGIN";
  }
}
