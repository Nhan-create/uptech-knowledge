import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleDirectoryHttpTransport } from "./google-directory-http.ts";

const lease = {
  jobId: "123e4567-e89b-42d3-a456-426614174000",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "223e4567-e89b-42d3-a456-426614174000",
  serviceActor: "323e4567-e89b-42d3-a456-426614174000",
  connectorId: "423e4567-e89b-42d3-a456-426614174000",
  sourceId: null,
  leaseFence: "523e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("Google Directory transport follows every user page before returning a complete snapshot", async () => {
  const urls: string[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify(url.includes("pageToken=second")
        ? { users: [{ id: "tenant-a-subject-2", name: { fullName: "Two" }, primaryEmail: "two@tenant-a.example", suspended: true }] }
        : { users: [{ id: "tenant-a-subject-1", name: { fullName: "One" }, primaryEmail: "one@tenant-a.example", isAdmin: true }], nextPageToken: "second" }),
        { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const users = await transport.listUsers();

  assert.equal(users.traversalComplete, true);
  assert.deepEqual(users.items.map((user) => [user.googleSubject, user.lifecycleState, user.isAdmin]), [
    ["tenant-a-subject-1", "ACTIVE", true],
    ["tenant-a-subject-2", "SUSPENDED", false],
  ]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /pageToken=second/u);
});

test("Google Directory transport fails closed on a repeated page token", async () => {
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    fetch: async () => new Response(JSON.stringify({ groups: [], nextPageToken: "loop" }), { status: 200 }),
  });

  await assert.rejects(transport.listGroups(), /repeated a page token/u);
});

test("Google Directory transport rejects a non-Directory lease before token or network access", () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  assert.throws(
    () => createGoogleDirectoryHttpTransport(
      { ...lease, jobKind: "DRIVE_SYNC", sourceId: "623e4567-e89b-42d3-a456-426614174000" },
      {
        accessTokenProvider: { async getAccessToken() { tokenCalls += 1; return "server-token"; } },
        fetch: async () => { fetchCalls += 1; return new Response(null, { status: 500 }); },
      },
    ),
    /DIRECTORY_SYNC/u,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});
