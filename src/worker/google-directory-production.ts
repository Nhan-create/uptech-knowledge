import { randomUUID } from "node:crypto";

import {
  createDatabasePool,
  withWorkerTransaction,
} from "../server/db/core.ts";
import { leaseNextDirectoryJobFromPool } from "../server/jobs/core.ts";
import type { PublishedDirectorySync } from "../server/people-data/directory-sync.ts";
import { createConfiguredGoogleCloudDirectoryRuntime } from "../server/people-data/directory-runtime.ts";
import { createWorkerBoundary, type WorkerJobHandler, type WorkerRunResult } from "./core.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export interface GoogleDirectoryProductionConfiguration {
  readonly databaseUrl: string;
  readonly oauthClient: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
}

export class GoogleDirectoryProductionConfigurationError extends Error {
  override readonly name = "GoogleDirectoryProductionConfigurationError";
}

function required(environment: Environment, ...names: readonly string[]): string {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  throw new GoogleDirectoryProductionConfigurationError(
    "Directory production configuration is missing",
  );
}

/** Loads only server-side worker configuration; no tenant/customer is configurable. */
export function loadGoogleDirectoryProductionConfiguration(
  environment: Environment = process.env,
): GoogleDirectoryProductionConfiguration {
  return Object.freeze({
    databaseUrl: required(environment, "DATABASE_URL"),
    oauthClient: Object.freeze({
      clientId: required(
        environment,
        "GOOGLE_CLIENT_ID",
        "UPTECH_GOOGLE_LOGIN_WEB_CLIENT_ID",
      ),
      clientSecret: required(environment, "GOOGLE_CLIENT_SECRET"),
    }),
  });
}

export interface GoogleDirectoryProductionWorkerDependencies {
  readonly boundary: {
    runNext(
      handler: WorkerJobHandler<PublishedDirectorySync>,
    ): Promise<WorkerRunResult<PublishedDirectorySync>>;
  };
  readonly syncJobHandler: WorkerJobHandler<PublishedDirectorySync>;
}

/** A zero-input worker entrypoint: all tenant authority comes from its DB lease. */
export function createGoogleDirectoryProductionWorker(
  dependencies: GoogleDirectoryProductionWorkerDependencies,
) {
  return Object.freeze({
    runNext: () => dependencies.boundary.runNext(dependencies.syncJobHandler),
  });
}

/**
 * Production composition for a dedicated Directory worker process. PostgreSQL
 * assumes the existing worker role before it can lease or enter tenant RLS.
 */
export function createConfiguredGoogleDirectoryProductionWorker(
  environment: Environment = process.env,
) {
  const configuration = loadGoogleDirectoryProductionConfiguration(environment);
  const pool = createDatabasePool({
    connectionString: configuration.databaseUrl,
    options: "-c role=uptech_worker_runtime",
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  const boundary = createWorkerBoundary({
    leaseNextJob: () => leaseNextDirectoryJobFromPool(pool),
    withWorkerTransaction: (context, work) =>
      withWorkerTransaction(context, work, pool),
  });
  const runtime = createConfiguredGoogleCloudDirectoryRuntime(
    {
      oauthClient: configuration.oauthClient,
      nextId: randomUUID,
    },
    environment,
  );
  const worker = createGoogleDirectoryProductionWorker({
    boundary,
    syncJobHandler: runtime.createSyncJobHandler(),
  });

  return Object.freeze({
    runNext: worker.runNext,
    close: () => pool.end(),
  });
}
