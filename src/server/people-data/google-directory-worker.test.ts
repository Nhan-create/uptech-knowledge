import assert from "node:assert/strict";
import test from "node:test";

import type { SecretAdapter, SecretReference } from "../secrets/core.ts";
import { createGoogleDirectorySyncJobHandler } from "./google-directory-worker.ts";

const lease = {
  jobId: "job-a",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "workspace-a",
  serviceActor: "directory-worker",
  connectorId: "connector-a",
  sourceId: null,
  leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("Directory worker runs the lease-bound secret-to-Google-to-publish pipeline", async () => {
  const reference = "secret://directory/workspace-a" as SecretReference;
  const statements: string[] = [];
  const secrets: SecretAdapter = {
    async create() { throw new Error("not used"); },
    async read() { return Uint8Array.from(Buffer.from("refresh-token", "utf8")); },
    async replace() { throw new Error("not used"); },
    async destroy() { throw new Error("not used"); },
  };
  const handler = createGoogleDirectorySyncJobHandler({
    secretAdapter: secrets,
    oauthClient: { clientId: "client-id", clientSecret: "client-secret" },
    nextId: (() => {
      let next = 1;
      return () => `00000000-0000-4000-8000-00000000000${next++}`;
    })(),
    fetch: async (url) => {
      const request = requestUrl(url);
      if (request.href === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "directory-access-token" });
      }
      if (request.pathname.endsWith("/customers/my_customer")) {
        return json({ id: "C0123abc", customerDomain: "workspace.example" });
      }
      if (request.pathname.endsWith("/orgunits")) return json({ organizationUnits: [] });
      if (request.pathname.endsWith("/users")) return json({ users: [] });
      if (request.pathname.endsWith("/groups")) return json({ groups: [] });
      throw new Error(`unexpected request ${request.href}`);
    },
  });

  const result = await handler({
    lease,
    client: {
      async query(text) {
        statements.push(text);
        if (text.includes("resolve_directory_connector_credential_reference")) {
          return { rows: [{ credential_reference: reference }] };
        }
        if (text.includes("begin_people_sync_generation")) {
          return { rows: [{ outcome: "STARTED", connector_id: "connector-a" }] };
        }
        if (text.includes("stage_people_directory_customer")) return { rows: [{ outcome: "STAGED" }] };
        if (text.includes("publish_people_sync_generation")) return { rows: [{ outcome: "PUBLISHED" }] };
        throw new Error(`unexpected SQL ${text}`);
      },
    },
  });

  assert.deepEqual(result, {
    kind: "published",
    workspaceId: "workspace-a",
    generationId: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(statements[0].includes("begin_people_sync_generation"), true);
  assert.equal(statements.some((text) => text.includes("resolve_directory_connector_credential_reference")), true);
  assert.equal(statements.at(-1)?.includes("publish_people_sync_generation"), true);
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(value: URL | RequestInfo): URL {
  return new URL(value instanceof Request ? value.url : value);
}
