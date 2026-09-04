import assert from "node:assert/strict";
import test from "node:test";

import type { DatabaseClient } from "../server/db/core.ts";
import type { LeasedJob } from "../server/jobs/core.ts";
import { createWorkerBoundary } from "./core.ts";
import {
  createGoogleDirectoryProductionWorker,
  loadGoogleDirectoryProductionConfiguration,
} from "./google-directory-production.ts";

test("production Directory worker dispatches a lease-derived sync without tenant input", async () => {
  const lease = {
    jobId: "job-from-lease",
    jobKind: "DIRECTORY_SYNC",
    workspaceId: "workspace-from-lease",
    serviceActor: "worker-from-lease",
    connectorId: "connector-from-lease",
    sourceId: null,
    leaseFence: "123e4567-e89b-42d3-a456-426614174000",
    leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  } satisfies LeasedJob;
  const client = {} as DatabaseClient;
  const boundary = createWorkerBoundary({
    async leaseNextJob() {
      return lease;
    },
    async withWorkerTransaction(context, work) {
      assert.deepEqual(context, {
        kind: "worker",
        workspaceId: "workspace-from-lease",
        jobId: "job-from-lease",
        serviceActor: "worker-from-lease",
        connectorId: "connector-from-lease",
        sourceId: null,
        leaseFence: "123e4567-e89b-42d3-a456-426614174000",
      });
      return work(client);
    },
  });
  const worker = createGoogleDirectoryProductionWorker({
    boundary,
    syncJobHandler: async (context) => ({
      kind: "published" as const,
      workspaceId: context.lease.workspaceId,
      generationId: "generation-1",
    }),
  });

  assert.deepEqual(await worker.runNext(), {
    kind: "processed",
    jobId: "job-from-lease",
    result: {
      kind: "published",
      workspaceId: "workspace-from-lease",
      generationId: "generation-1",
    },
  });
  assert.equal(worker.runNext.length, 0);
});

test("production Directory worker configuration is fail-closed and trims server-only values", () => {
  assert.throws(
    () => loadGoogleDirectoryProductionConfiguration({}),
    /Directory production configuration is missing/i,
  );

  assert.deepEqual(
    loadGoogleDirectoryProductionConfiguration({
      DATABASE_URL: " postgresql://runtime@tenant-a.example/uptech ",
      GOOGLE_CLIENT_ID: " google-client.apps.googleusercontent.com ",
      GOOGLE_CLIENT_SECRET: " server-only-client-secret ",
    }),
    {
      databaseUrl: "postgresql://runtime@tenant-a.example/uptech",
      oauthClient: {
        clientId: "google-client.apps.googleusercontent.com",
        clientSecret: "server-only-client-secret",
      },
    },
  );
});
