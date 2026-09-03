import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { SecretReference } from "../../secrets/core.ts";
import {
  BootstrapCommitUnknownError,
  createGoogleWorkspaceBootstrapRepository,
} from "./repository.ts";

const hash = (value: number) => new Uint8Array(32).fill(value);
const secret = "gcp-sm:v1:top-secret-reference" as SecretReference;

function fakePool(rows: QueryResultRow[] | Error) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  return {
    calls,
    pool: {
      async query(text: string, values: readonly unknown[]) {
        calls.push({ text, values });
        if (rows instanceof Error) throw rows;
        return { rows };
      },
    },
  };
}

test("prepare calls only v1 and strictly accepts PREPARED", async () => {
  const fake = fakePool([{ outcome: "PREPARED" }]);
  const repository = createGoogleWorkspaceBootstrapRepository(fake.pool as never);
  assert.deepEqual(await repository.prepare({
    attemptId: "10000000-0000-0000-0000-000000000001",
    sourceTokenHash: hash(1),
    candidateWorkspaceId: "10000000-0000-0000-0000-000000000002",
    statusTokenHash: hash(2),
    requestId: "10000000-0000-0000-0000-000000000003",
  }), { outcome: "PREPARED" });
  assert.match(fake.calls[0]!.text, /prepare_google_workspace_bootstrap_v1/);
  assert.equal(fake.calls[0]!.values.length, 5);
  assert.ok(Buffer.isBuffer(fake.calls[0]!.values[1]));
});

test("complete serializes verified domains and strictly parses PROVISIONING", async () => {
  const expiry = new Date("2030-01-01T00:00:00.000Z");
  const fake = fakePool([{ outcome: "PROVISIONING", status_expires_at: expiry }]);
  const repository = createGoogleWorkspaceBootstrapRepository(fake.pool as never);
  const result = await repository.complete({
    attemptId: "10000000-0000-0000-0000-000000000001",
    sourceTokenHash: hash(1), statusTokenHash: hash(2),
    customerId: "C0123", customerDomain: "example.com",
    providerSubject: "google-sub", hostedDomain: "example.com",
    verifiedDomains: [{ normalizedDomain: "example.com", domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: secret,
    authorizedScopes: ["scope-a"],
    requestId: "10000000-0000-0000-0000-000000000003",
  });
  assert.deepEqual(result, { outcome: "PROVISIONING", statusExpiresAt: expiry });
  assert.match(fake.calls[0]!.text, /complete_google_workspace_bootstrap_v1/);
  assert.equal(fake.calls[0]!.values[7], '{"(example.com,PRIMARY,)"}');
  assert.equal(fake.calls[0]!.values[8], secret);
});

test("reconcile and abort strictly accept their closed outcome sets", async () => {
  const reconcileFake = fakePool([{ outcome: "NOT_COMMITTED" }]);
  const reconcile = createGoogleWorkspaceBootstrapRepository(reconcileFake.pool as never);
  assert.deepEqual(await reconcile.reconcile({
    attemptId: "10000000-0000-0000-0000-000000000001", sourceTokenHash: hash(1),
    statusTokenHash: hash(2), credentialReference: secret,
    requestId: "10000000-0000-0000-0000-000000000003",
  }), { outcome: "NOT_COMMITTED" });
  const abortFake = fakePool([{ outcome: "ABORTED" }]);
  const abort = createGoogleWorkspaceBootstrapRepository(abortFake.pool as never);
  assert.deepEqual(await abort.abort({
    attemptId: "10000000-0000-0000-0000-000000000001", sourceTokenHash: hash(1),
    requestId: "10000000-0000-0000-0000-000000000003",
  }), { outcome: "ABORTED" });
});

test("query and result-shape failures are secret-safe unknown errors", async () => {
  for (const rows of [new Error(`database leaked ${secret}`), [{ outcome: "DENIED", status_expires_at: new Date() }]]) {
    const fake = fakePool(rows as QueryResultRow[] | Error);
    const repository = createGoogleWorkspaceBootstrapRepository(fake.pool as never);
    await assert.rejects(repository.complete({
      attemptId: "10000000-0000-0000-0000-000000000001", sourceTokenHash: hash(1), statusTokenHash: hash(2),
      customerId: "C", customerDomain: "example.com", providerSubject: "sub", hostedDomain: "example.com",
      verifiedDomains: [{ normalizedDomain: "example.com", domainKind: "PRIMARY", providerParentDomain: null }],
      credentialReference: secret, authorizedScopes: [], requestId: "10000000-0000-0000-0000-000000000003",
    }), (error: unknown) => {
      assert.ok(error instanceof BootstrapCommitUnknownError);
      assert.equal(String(error).includes(secret), false);
      return true;
    });
  }
});
