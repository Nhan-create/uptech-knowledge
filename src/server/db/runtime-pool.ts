import { Pool, type PoolConfig } from "pg";

import { DatabaseConfigurationError, type DatabasePool } from "./core.ts";

const runtimeGlobal = globalThis as typeof globalThis & {
  __uptechRuntimeDatabasePool?: Pool;
  __uptechRuntimeDatabaseUrl?: string;
};

function requireDatabaseUrl(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new DatabaseConfigurationError("PostgreSQL configuration is incomplete");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatabaseConfigurationError("PostgreSQL configuration is invalid");
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0 ||
    parsed.pathname.length <= 1
  ) {
    throw new DatabaseConfigurationError("PostgreSQL configuration is invalid");
  }
  return value;
}

export function getRuntimeDatabasePool(databaseUrl: string): DatabasePool {
  const safeUrl = requireDatabaseUrl(databaseUrl);
  if (runtimeGlobal.__uptechRuntimeDatabasePool !== undefined) {
    if (runtimeGlobal.__uptechRuntimeDatabaseUrl !== safeUrl) {
      throw new DatabaseConfigurationError(
        "Runtime PostgreSQL configuration changed after initialization",
      );
    }
    return runtimeGlobal.__uptechRuntimeDatabasePool;
  }

  const pool = new Pool(runtimePoolConfig(safeUrl));
  runtimeGlobal.__uptechRuntimeDatabasePool = pool;
  runtimeGlobal.__uptechRuntimeDatabaseUrl = safeUrl;
  return pool;
}

export function runtimePoolConfig(databaseUrl: string): Readonly<PoolConfig> {
  const safeUrl = requireDatabaseUrl(databaseUrl);
  return Object.freeze({
    connectionString: safeUrl,
    options: "-c role=uptech_api_runtime",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
}
