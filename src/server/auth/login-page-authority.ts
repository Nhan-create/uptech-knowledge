import type { DatabasePool } from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  authenticateWebSession,
  WebSessionAuthenticationError,
} from "./web-session.ts";

export type LoginPageAuthorityDecision = "HOME" | "LOGIN" | "UNAVAILABLE";

export function resolveLoginPageError(
  requestedError: string | undefined,
  authority: LoginPageAuthorityDecision,
): string | undefined {
  if (authority === "UNAVAILABLE") {
    return "temporarily_unavailable";
  }
  return requestedError;
}

export interface LoginPageAuthorityDependencies {
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
  ) => Promise<unknown>;
}

const productionDependencies: LoginPageAuthorityDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  authenticate: authenticateWebSession,
});

export async function resolveLoginPageAuthority(
  headers: Headers,
  hasWebSessionCookie: boolean,
  dependencies: LoginPageAuthorityDependencies = productionDependencies,
): Promise<LoginPageAuthorityDecision> {
  if (!hasWebSessionCookie) {
    return "LOGIN";
  }

  try {
    const config = dependencies.loadConfig();
    const pool = dependencies.getPool(config.databaseUrl);
    await dependencies.authenticate(headers, config.sessionPepper, pool);
    return "HOME";
  } catch (error) {
    if (error instanceof WebSessionAuthenticationError) {
      return "LOGIN";
    }
    return "UNAVAILABLE";
  }
}
