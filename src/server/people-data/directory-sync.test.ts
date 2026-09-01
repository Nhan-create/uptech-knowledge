import assert from "node:assert/strict";
import test from "node:test";

import {
  createDirectorySyncJobHandler,
  runDirectorySync,
} from "./directory-sync.ts";

function routineResult(text: string) {
  if (text.includes("begin_people_sync_generation_v1")) {
    return { rows: [{ outcome: "STARTED", connector_id: "directory-connector" }] };
  }
  if (text.includes("publish_people_sync_generation_v1")) {
    return { rows: [{ outcome: "PUBLISHED" }] };
  }
  return { rows: [{ outcome: "STAGED" }] };
}

const lease = {
  jobId: "job-directory-1",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "tenant-a",
  serviceActor: "directory-service-actor",
  connectorId: "directory-connector",
  sourceId: null,
  leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("directory sync stages read-only Google people and direct group edges before publishing", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const result = await runDirectorySync({
    client: {
      async query(text: string, values: readonly unknown[]) {
        calls.push({ text, values });
        return routineResult(text);
      },
    },
    lease,
    transport: {
      async listUsers() {
        return {
          items: [
            {
              googleSubject: "tenant-a-sales-subject",
              fullName: "Sales Person",
              primaryEmail: "sales@tenant-a.example",
              department: "Sales",
              lifecycleState: "ACTIVE" as const,
              isAdmin: true,
            },
          ],
          traversalComplete: true,
          freshUntil: new Date("2099-01-01T01:00:00.000Z"),
        };
      },
      async listGroups() {
        return {
          items: [
            { googleGroupId: "tenant-a-sales-group", groupName: "Sales" },
          ],
          traversalComplete: true,
          freshUntil: new Date("2099-01-01T01:00:00.000Z"),
        };
      },
      async listDirectMembers() {
        return {
          items: [{ googleSubject: "tenant-a-sales-subject" }],
          traversalComplete: true,
          freshUntil: new Date("2099-01-01T01:00:00.000Z"),
        };
      },
    },
    generationId: "223e4567-e89b-42d3-a456-426614174000",
    requestId: "323e4567-e89b-42d3-a456-426614174000",
  });

  assert.deepEqual(result, {
    kind: "published",
    workspaceId: "tenant-a",
    generationId: "223e4567-e89b-42d3-a456-426614174000",
  });
  assert.deepEqual(calls, [
    {
      text: "SELECT * FROM uptech.begin_people_sync_generation_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid)",
      values: [
        "tenant-a",
        "223e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174000",
        "323e4567-e89b-42d3-a456-426614174000",
      ],
    },
    {
      text: "SELECT * FROM uptech.stage_people_profile_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text)",
      values: [
        "tenant-a",
        "223e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174000",
        "tenant-a-sales-subject",
        "Sales Person",
        "sales@tenant-a.example",
        "Sales",
        "ACTIVE",
      ],
    },
    {
      text: "SELECT * FROM uptech.stage_people_group_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)",
      values: [
        "tenant-a",
        "223e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174000",
        "tenant-a-sales-group",
        "Sales",
      ],
    },
    {
      text: "SELECT * FROM uptech.stage_people_group_membership_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)",
      values: [
        "tenant-a",
        "223e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174000",
        "tenant-a-sales-group",
        "tenant-a-sales-subject",
      ],
    },
    {
      text: "SELECT * FROM uptech.publish_people_sync_generation_v1($1::uuid,$2::uuid,$3::uuid,$4::boolean,$5::timestamptz,$6::uuid)",
      values: [
        "tenant-a",
        "223e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174000",
        true,
        new Date("2099-01-01T01:00:00.000Z"),
        "323e4567-e89b-42d3-a456-426614174000",
      ],
    },
  ]);
});

test("directory sync refuses incomplete traversals without publishing a partial authority snapshot", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runDirectorySync({
      client: {
        async query(text: string) {
          calls.push(text);
          return routineResult(text);
        },
      },
      lease,
      transport: {
        async listUsers() {
          return {
            items: [],
            traversalComplete: false,
            freshUntil: new Date("2099-01-01T01:00:00.000Z"),
          };
        },
        async listGroups() {
          throw new Error("must not list groups after an incomplete user traversal");
        },
        async listDirectMembers() {
          throw new Error("must not list group members after an incomplete user traversal");
        },
      },
      generationId: "223e4567-e89b-42d3-a456-426614174000",
      requestId: "323e4567-e89b-42d3-a456-426614174000",
    }),
    /complete traversal/u,
  );
  assert.deepEqual(calls, [
    "SELECT * FROM uptech.begin_people_sync_generation_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid)",
  ]);
});

test("directory sync refuses non-directory leases before calling Google", async () => {
  let calledGoogle = false;
  await assert.rejects(
    runDirectorySync({
      client: { async query() { return { rows: [] }; } },
      lease: { ...lease, jobKind: "DRIVE_SYNC", sourceId: "drive-source" },
      transport: {
        async listUsers() {
          calledGoogle = true;
          throw new Error("must not call Google");
        },
        async listGroups() { throw new Error("must not call Google"); },
        async listDirectMembers() { throw new Error("must not call Google"); },
      },
      generationId: "223e4567-e89b-42d3-a456-426614174000",
      requestId: "323e4567-e89b-42d3-a456-426614174000",
    }),
    /DIRECTORY_SYNC/u,
  );
  assert.equal(calledGoogle, false);
});

test("directory sync fails closed when the lease-bound begin routine denies the generation", async () => {
  await assert.rejects(
    runDirectorySync({
      client: {
        async query() {
          return { rows: [{ outcome: "DENIED" }] };
        },
      },
      lease,
      transport: {
        async listUsers() {
          throw new Error("must not call Google after a denied generation");
        },
        async listGroups() { throw new Error("must not call Google"); },
        async listDirectMembers() { throw new Error("must not call Google"); },
      },
      generationId: "223e4567-e89b-42d3-a456-426614174000",
      requestId: "323e4567-e89b-42d3-a456-426614174000",
    }),
    /begin_people_sync_generation_v1.*DENIED/u,
  );
});

test("directory sync refuses a generation attached to a different connector", async () => {
  await assert.rejects(
    runDirectorySync({
      client: { async query() { return { rows: [{ outcome: "STARTED", connector_id: "other-directory-connector" }] }; } },
      lease,
      transport: {
        async listUsers() { throw new Error("must not call Google after connector mismatch"); },
        async listGroups() { throw new Error("must not call Google"); },
        async listDirectMembers() { throw new Error("must not call Google"); },
      },
      generationId: "223e4567-e89b-42d3-a456-426614174000",
      requestId: "323e4567-e89b-42d3-a456-426614174000",
    }),
    /wrong connector/u,
  );
});

test("directory sync stops when a stage routine loses its lease race", async () => {
  await assert.rejects(
    runDirectorySync({
      client: {
        async query(text: string) {
          if (text.includes("begin_people")) return { rows: [{ outcome: "STARTED", connector_id: "directory-connector" }] };
          return { rows: [{ outcome: "CONCURRENT_LOSER" }] };
        },
      },
      lease,
      transport: {
        async listUsers() { return { items: [{ googleSubject: "tenant-a-subject", fullName: "Tenant A", primaryEmail: "a@tenant-a.example", department: null, lifecycleState: "ACTIVE" as const }], traversalComplete: true, freshUntil: new Date("2099-01-01T00:00:00.000Z") }; },
        async listGroups() { throw new Error("must not list groups after a failed stage"); },
        async listDirectMembers() { throw new Error("must not list members"); },
      },
      generationId: "223e4567-e89b-42d3-a456-426614174000",
      requestId: "323e4567-e89b-42d3-a456-426614174000",
    }),
    /stage_people_profile_v1.*CONCURRENT_LOSER/u,
  );
});

test("directory handler derives generation and request identifiers at the worker boundary", async () => {
  const handler = createDirectorySyncJobHandler({
    transportForLease: () => ({
      async listUsers() {
        return { items: [], traversalComplete: true, freshUntil: new Date("2099-01-01T01:00:00.000Z") };
      },
      async listGroups() {
        return { items: [], traversalComplete: true, freshUntil: new Date("2099-01-01T01:00:00.000Z") };
      },
      async listDirectMembers() {
        throw new Error("no groups need members");
      },
    }),
    nextId: (() => {
      const ids = [
        "223e4567-e89b-42d3-a456-426614174000",
        "323e4567-e89b-42d3-a456-426614174000",
      ];
      return () => ids.shift()!;
    })(),
  });
  const calls: Array<readonly unknown[]> = [];

  const result = await handler({
    client: {
      async query(text: string, values: readonly unknown[]) {
        calls.push(values);
        return routineResult(text);
      },
    },
    lease,
  });

  assert.equal(result.generationId, "223e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(calls[0], [
    "tenant-a",
    "223e4567-e89b-42d3-a456-426614174000",
    "123e4567-e89b-42d3-a456-426614174000",
    "323e4567-e89b-42d3-a456-426614174000",
  ]);
});
