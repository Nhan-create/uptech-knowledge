import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerBoundary,
} from "./core.ts";
import type { LeasedJob } from "../server/jobs/core.ts";

const lease: LeasedJob = {
  jobId: "job-1",
  jobKind: "DRIVE_SYNC",
  workspaceId: "workspace-from-lease",
  serviceActor: "service-actor-from-lease",
  connectorId: "connector-from-lease",
  sourceId: "source-from-lease",
  leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-08-25T00:05:00Z"),
};

test("worker boundary does nothing when the approved lease routine returns no job", async () => {
  let transactions = 0;
  const worker = createWorkerBoundary(
    {
      leaseNextJob: async () => null,
      async withWorkerTransaction() {
        transactions += 1;
        throw new Error("must not run");
      },
    },
  );

  const result = await worker.runNext(async () => {
    throw new Error("must not handle");
  });

  assert.deepEqual(result, { kind: "idle" });
  assert.equal(transactions, 0);
});

test("worker boundary derives every RLS context value from the lease", async () => {
  const client = { query: async () => undefined, release() {} };
  let transactionContext: unknown;
  let handlerClient: unknown;

  const worker = createWorkerBoundary(
    {
      leaseNextJob: async () => lease,
      async withWorkerTransaction(context, work) {
        transactionContext = context;
        return work(client as never);
      },
    },
  );

  const result = await worker.runNext(async ({ client: received, lease: receivedLease }) => {
    handlerClient = received;
    assert.equal(receivedLease, lease);
    return "processed";
  });

  assert.deepEqual(transactionContext, {
    kind: "worker",
    workspaceId: "workspace-from-lease",
    jobId: "job-1",
    serviceActor: "service-actor-from-lease",
    connectorId: "connector-from-lease",
    sourceId: "source-from-lease",
    leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  });
  assert.equal(handlerClient, client);
  assert.deepEqual(result, {
    kind: "processed",
    jobId: "job-1",
    result: "processed",
  });
});
