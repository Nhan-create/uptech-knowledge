import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type { SecretReference } from "../../secrets/core.ts";
import {
  BootstrapCommitUnknownError,
  createGoogleWorkspaceBootstrapStartAdmission,
  createGoogleWorkspaceBootstrapRepository,
} from "./repository.ts";

const hash = (value: number) => new Uint8Array(32).fill(value);
const secret = "gcp-sm:v1:top-secret-reference" as SecretReference;

const claims = {
  issuer: "https://accounts.google.com" as const,
  providerSubject: "bootstrap-commit-sub",
  normalizedEmail: "owner@commit.example",
  emailVerified: true as const,
  hostedDomain: "commit.example",
  issuedAtEpochSeconds: 1_893_456_000,
  expiresAtEpochSeconds: 1_893_459_600,
  audienceConfigurationKey: "GOOGLE_WEB_LOGIN_V1" as const,
  authorizedPartyConfigurationKey: null,
  nonceHash: hash(8),
  displayName: null,
  pictureUrl: null,
};

test("bootstrap start admission calls only the closed v1 network gate", async () => {
  for (const outcome of ["ADMITTED", "RATE_LIMITED", "DENIED"] as const) {
    const fake = fakePool([{ outcome }]);
    const admission = createGoogleWorkspaceBootstrapStartAdmission(fake.pool as never);
    assert.deepEqual(await admission({
      networkHmac: hash(7),
      requestId: "10000000-0000-4000-8000-000000000003",
    }), { outcome });
    assert.match(fake.calls[0]!.text, /admit_google_workspace_bootstrap_start_v1/u);
    assert.deepEqual(fake.calls[0]!.values, [
      Buffer.from(hash(7)),
      "10000000-0000-4000-8000-000000000003",
    ]);
  }
});

test("bootstrap start admission fails closed on malformed input, rows, and database uncertainty", async () => {
  for (const [networkHmac, requestId, rows] of [
    [new Uint8Array(31), "10000000-0000-4000-8000-000000000003", [{ outcome: "ADMITTED" }]],
    [hash(7), "browser-value", [{ outcome: "ADMITTED" }]],
    [hash(7), "10000000-0000-4000-8000-000000000003", [{ outcome: "UNKNOWN" }]],
    [hash(7), "10000000-0000-4000-8000-000000000003", new Error("database uncertainty")],
  ] as const) {
    const fake = fakePool(rows as QueryResultRow[] | Error);
    const admission = createGoogleWorkspaceBootstrapStartAdmission(fake.pool as never);
    await assert.rejects(admission({ networkHmac, requestId }), BootstrapCommitUnknownError);
  }
});

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

test("status and retry call only their exact v1 capability routines", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";
  const statusFake = fakePool([{ outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE" }]);
  const statusRepository = createGoogleWorkspaceBootstrapRepository(statusFake.pool as never);
  assert.deepEqual(await statusRepository.readStatus({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE" });
  assert.match(statusFake.calls[0]!.text, /read_google_workspace_bootstrap_status_v1/u);
  assert.deepEqual(statusFake.calls[0]!.values, [Buffer.from(hash(9)), requestId]);

  const retryFake = fakePool([{ outcome: "REQUEUED" }]);
  const retryRepository = createGoogleWorkspaceBootstrapRepository(retryFake.pool as never);
  assert.deepEqual(await retryRepository.retrySync({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "REQUEUED" });
  assert.match(retryFake.calls[0]!.text, /retry_google_workspace_bootstrap_sync_v1/u);
  assert.deepEqual(retryFake.calls[0]!.values, [Buffer.from(hash(9)), requestId]);
});

test("status and retry reject malformed inputs and non-closed database rows", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";
  for (const [method, rows] of [
    ["readStatus", [{ outcome: "REQUEUED" }]],
    ["readStatus", [{ outcome: "READY", workspace_id: "leak" }]],
    ["retrySync", [{ outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE" }]],
    ["retrySync", []],
  ] as const) {
    const repository = createGoogleWorkspaceBootstrapRepository(fakePool([...rows] as QueryResultRow[]).pool as never);
    await assert.rejects(repository[method]({ statusTokenHash: hash(9), requestId }), BootstrapCommitUnknownError);
  }
  for (const method of ["readStatus", "retrySync"] as const) {
    const repository = createGoogleWorkspaceBootstrapRepository(fakePool([{ outcome: "DENIED" }]).pool as never);
    await assert.rejects(repository[method]({ statusTokenHash: new Uint8Array(31), requestId }), BootstrapCommitUnknownError);
    await assert.rejects(repository[method]({ statusTokenHash: hash(9), requestId: "browser-value" }), BootstrapCommitUnknownError);
  }
});

test("finish, fresh-login reissue, and revoke use only their closed v1 routines", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";

  const finishFake = fakePool([{ outcome: "FINISHED" }]);
  assert.deepEqual(await createGoogleWorkspaceBootstrapRepository(finishFake.pool as never).finish({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "FINISHED" });
  assert.match(finishFake.calls[0]!.text, /finish_google_workspace_bootstrap_v1/u);
  assert.deepEqual(finishFake.calls[0]!.values, [Buffer.from(hash(9)), requestId]);

  const expiry = new Date("2030-01-01T00:00:00.000Z");
  const reissueFake = fakePool([{ outcome: "REISSUED", status_expires_at: expiry }]);
  assert.deepEqual(await createGoogleWorkspaceBootstrapRepository(reissueFake.pool as never).reissueStatus({
    reservedCompletionHash: hash(7), claims, newStatusTokenHash: hash(9), requestId,
  }), { outcome: "REISSUED", statusExpiresAt: expiry });
  assert.match(reissueFake.calls[0]!.text, /reissue_google_workspace_bootstrap_status_v1/u);
  assert.deepEqual(reissueFake.calls[0]!.values, [
    Buffer.from(hash(7)), claims.issuer, claims.providerSubject, claims.normalizedEmail,
    true, claims.hostedDomain, new Date(claims.issuedAtEpochSeconds * 1000),
    new Date(claims.expiresAtEpochSeconds * 1000), claims.audienceConfigurationKey,
    null, Buffer.from(claims.nonceHash), Buffer.from(hash(9)), requestId,
  ]);

  const revokeFake = fakePool([{ outcome: "REVOKED" }]);
  assert.deepEqual(await createGoogleWorkspaceBootstrapRepository(revokeFake.pool as never).revokeCapability({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "REVOKED" });
  assert.match(revokeFake.calls[0]!.text, /revoke_onboarding_capability_v1/u);
});

test("finish, reissue, and revoke fail closed on malformed inputs and result shapes", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";
  for (const [method, input, rows] of [
    ["finish", { statusTokenHash: hash(9), requestId }, [{ outcome: "READY" }]],
    ["revokeCapability", { statusTokenHash: hash(9), requestId }, [{ outcome: "REVOKED", workspace_id: "leak" }]],
    ["reissueStatus", { reservedCompletionHash: hash(7), claims, newStatusTokenHash: hash(9), requestId }, [{ outcome: "REISSUED", status_expires_at: null }]],
  ] as const) {
    const repository = createGoogleWorkspaceBootstrapRepository(fakePool([...rows] as QueryResultRow[]).pool as never);
    await assert.rejects((repository[method] as (value: never) => Promise<unknown>)(input as never), BootstrapCommitUnknownError);
  }
  const repository = createGoogleWorkspaceBootstrapRepository(fakePool([{ outcome: "DENIED" }]).pool as never);
  await assert.rejects(repository.reissueStatus({
    reservedCompletionHash: new Uint8Array(31), claims,
    newStatusTokenHash: hash(9), requestId,
  }), BootstrapCommitUnknownError);
});

test("access request submit and read use only closed v1 capability routines", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";
  const receiptId = "10000000-0000-4000-8000-000000000004";
  const submitFake = fakePool([{ outcome: "PENDING", request_id: receiptId, status: "PENDING" }]);
  const submitRepository = createGoogleWorkspaceBootstrapRepository(submitFake.pool as never);
  assert.deepEqual(await submitRepository.submitAccessRequest({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "PENDING", requestId: receiptId, status: "PENDING" });
  assert.match(submitFake.calls[0]!.text, /submit_workspace_access_request_v1/u);
  assert.deepEqual(submitFake.calls[0]!.values, [Buffer.from(hash(9)), requestId]);

  const readFake = fakePool([{ outcome: "FOUND", request_id: receiptId, status: "FULFILLED" }]);
  const readRepository = createGoogleWorkspaceBootstrapRepository(readFake.pool as never);
  assert.deepEqual(await readRepository.readAccessRequest({
    statusTokenHash: hash(9), requestId,
  }), { outcome: "FOUND", requestId: receiptId, status: "FULFILLED" });
  assert.match(readFake.calls[0]!.text, /read_workspace_access_request_v1/u);
});

test("access request repository rejects malformed input and leaky or open result rows", async () => {
  const requestId = "10000000-0000-4000-8000-000000000003";
  const receiptId = "10000000-0000-4000-8000-000000000004";
  for (const [method, rows] of [
    ["submitAccessRequest", [{ outcome: "FULFILLED", request_id: receiptId, status: "FULFILLED" }]],
    ["submitAccessRequest", [{ outcome: "PENDING", request_id: receiptId, status: "PENDING", workspace_id: "leak" }]],
    ["readAccessRequest", [{ outcome: "FOUND", request_id: receiptId, status: "UNKNOWN" }]],
    ["readAccessRequest", [{ outcome: "DENIED", request_id: receiptId, status: null }]],
  ] as const) {
    const repository = createGoogleWorkspaceBootstrapRepository(fakePool([...rows] as QueryResultRow[]).pool as never);
    await assert.rejects((repository[method] as (value: never) => Promise<unknown>)({
      statusTokenHash: hash(9), requestId,
    } as never), BootstrapCommitUnknownError);
  }
  for (const method of ["submitAccessRequest", "readAccessRequest"] as const) {
    const repository = createGoogleWorkspaceBootstrapRepository(fakePool([{ outcome: "DENIED", request_id: null, status: null }]).pool as never);
    await assert.rejects((repository[method] as (value: never) => Promise<unknown>)({
      statusTokenHash: new Uint8Array(31), requestId,
    } as never), BootstrapCommitUnknownError);
  }
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
