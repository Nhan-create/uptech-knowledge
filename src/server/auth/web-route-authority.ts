import {
  type DatabasePool,
} from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { inspectCurrentDirectoryAuthority } from "./directory-authority.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  authenticateWebSession,
  type AuthenticatedWebSession,
  WebSessionAuthenticationError,
} from "./web-session.ts";

export type WebRouteTarget = "HOME" | "ADMIN";
export type WebRouteAuthorityDecision = "ALLOW" | "ADMIN" | "HOME" | "LOGIN";
export type DetailedWebRouteAuthorityDecision =
  | Readonly<{ kind: "ROUTE"; decision: Exclude<WebRouteAuthorityDecision, "LOGIN"> }>
  | Readonly<{ kind: "NOT_CURRENT" }>
  | Readonly<{ kind: "UNAVAILABLE" }>;

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
  const detailed = await resolveWebRouteAuthorityDetailed(headers, target, dependencies);
  return detailed.kind === "ROUTE" ? detailed.decision : "LOGIN";
}

export async function resolveWebRouteAuthorityDetailed(
  headers: Headers,
  target: WebRouteTarget,
  dependencies: WebRouteAuthorityDependencies = productionDependencies,
): Promise<DetailedWebRouteAuthorityDecision> {
  try {
    const config = dependencies.loadConfig();
    const pool = dependencies.getPool(config.databaseUrl);
    const session = await dependencies.authenticate(
      headers,
      config.sessionPepper,
      pool,
    );
    const directory = await inspectCurrentDirectoryAuthority(session, pool);
    if (directory === "UNAVAILABLE") {
      return Object.freeze({ kind: "UNAVAILABLE" });
    }
    if (directory === "NOT_CURRENT") {
      return Object.freeze({ kind: "NOT_CURRENT" });
    }
    const decision = decisionForRole(target, session.context.workspaceRole);
    return decision === "LOGIN"
      ? Object.freeze({ kind: "NOT_CURRENT" })
      : Object.freeze({ kind: "ROUTE", decision });
  } catch (error) {
    return error instanceof WebSessionAuthenticationError
      ? Object.freeze({ kind: "NOT_CURRENT" })
      : Object.freeze({ kind: "UNAVAILABLE" });
  }
}
