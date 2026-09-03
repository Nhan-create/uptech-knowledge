import assert from "node:assert/strict";
import test from "node:test";

import { resolveDirectoryCredentialReference } from "./directory-credentials.ts";

test("Directory worker resolves one opaque credential reference through its lease-bound routine", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const reference = await resolveDirectoryCredentialReference({
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ credential_reference: "secret://directory/workspace-a" }] };
    },
  }, {
    jobId: "job-a",
    jobKind: "DIRECTORY_SYNC",
    workspaceId: "workspace-a",
    serviceActor: "directory-worker",
    connectorId: "connector-a",
    sourceId: null,
    leaseFence: "123e4567-e89b-42d3-a456-426614174000",
    leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  });

  assert.equal(reference, "secret://directory/workspace-a");
  assert.deepEqual(calls, [{
    text: "SELECT * FROM uptech.resolve_directory_connector_credential_reference_v1()",
    values: [],
  }]);
});
