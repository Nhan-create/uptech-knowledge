import assert from "node:assert/strict";
import test from "node:test";

import {
  JobLeaseBoundaryError,
  leaseNextDirectoryJobFromPool,
  leaseNextJobFromPool,
} from "./core.ts";

function result(rows: readonly Record<string, unknown>[]) {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("leaseNextJob calls only the approved no-argument routine", async () => {
  const calls: Array<{ text: string; argumentCount: number }> = [];
  const leaseExpiresAt = new Date("2099-08-25T00:05:00Z");
  const pool = {
    async query(text: string, ...values: unknown[]) {
      calls.push({ text, argumentCount: values.length });
      return result([
        {
          job_id: "job-1",
          job_kind: "DRIVE_SYNC",
          workspace_id: "workspace-1",
          service_actor_id: "service-actor-1",
          connector_id: "connector-1",
          source_id: "source-1",
          lease_fence: "123e4567-e89b-42d3-a456-426614174000",
          lease_expires_at: leaseExpiresAt,
        },
      ]);
    },
  };

  const lease = await leaseNextJobFromPool(pool as never);

  assert.deepEqual(lease, {
    jobId: "job-1",
    jobKind: "DRIVE_SYNC",
    workspaceId: "workspace-1",
    serviceActor: "service-actor-1",
    connectorId: "connector-1",
    sourceId: "source-1",
    leaseFence: "123e4567-e89b-42d3-a456-426614174000",
    leaseExpiresAt,
  });
  assert.deepEqual(calls, [
    { text: "SELECT * FROM uptech.lease_next_job()", argumentCount: 0 },
  ]);
});

test("leaseNextJob returns null on masked miss and fails closed on malformed rows", async () => {
  const validRow = {
    job_id: "job-1",
    job_kind: "DIRECTORY_SYNC",
    workspace_id: "workspace-1",
    service_actor_id: "service-actor-1",
    connector_id: "connector-1",
    source_id: null,
    lease_fence: "123e4567-e89b-42d3-a456-426614174000",
    lease_expires_at: new Date("2099-08-25T00:05:00Z"),
  };

  assert.equal(
    await leaseNextJobFromPool(
      { query: async () => result([]) } as never,
    ),
    null,
  );

  await assert.rejects(
    leaseNextJobFromPool(
      {
        query: async () =>
          result([
            {
              ...validRow,
              workspace_id: "",
            },
          ]),
      } as never,
    ),
    JobLeaseBoundaryError,
  );

  await assert.rejects(
    leaseNextJobFromPool(
      {
        query: async () =>
          result([
            {
              ...validRow,
              service_actor_id: null,
            },
          ]),
      } as never,
    ),
    JobLeaseBoundaryError,
  );

  await assert.rejects(
    leaseNextJobFromPool(
      {
        query: async () =>
          result([
            {
              ...validRow,
            },
            {
              ...validRow,
              job_id: "job-2",
              workspace_id: "workspace-2",
              service_actor_id: "service-actor-2",
              connector_id: "connector-2",
            },
          ]),
      } as never,
    ),
    JobLeaseBoundaryError,
  );

  for (const malformed of [
    { job_kind: "UNAPPROVED_SYNC" },
    { lease_fence: "123e4567-e89b-12d3-a456-426614174000" },
    { lease_expires_at: "2099-08-25T00:05:00Z" },
    { lease_expires_at: new Date("2000-01-01T00:00:00Z") },
    { source_id: "" },
    { job_kind: "DRIVE_SYNC", source_id: null },
    { job_kind: "DIRECTORY_SYNC", source_id: "source-1" },
  ]) {
    await assert.rejects(
      leaseNextJobFromPool(
        {
          query: async () => result([{ ...validRow, ...malformed }]),
        } as never,
      ),
      JobLeaseBoundaryError,
    );
  }
});

test("Directory worker leases only through the approved Directory-only routine", async () => {
  const calls: string[] = [];
  const pool = {
    async query(text: string) {
      calls.push(text);
      return result([{
        job_id: "job-directory-1",
        job_kind: "DIRECTORY_SYNC",
        workspace_id: "workspace-1",
        service_actor_id: "service-actor-1",
        connector_id: "connector-directory-1",
        source_id: null,
        lease_fence: "123e4567-e89b-42d3-a456-426614174000",
        lease_expires_at: new Date("2099-08-25T00:05:00Z"),
      }]);
    },
  };

  const lease = await leaseNextDirectoryJobFromPool(pool as never);

  assert.equal(lease?.jobKind, "DIRECTORY_SYNC");
  assert.deepEqual(calls, [
    "SELECT * FROM uptech.lease_next_directory_job_v1()",
  ]);
});
