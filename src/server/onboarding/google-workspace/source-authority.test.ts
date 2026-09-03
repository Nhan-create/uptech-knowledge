import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
  GoogleWorkspaceSourceAuthorityUnavailableError,
  createGoogleWorkspaceBootstrapSourceAuthority,
} from "./source-authority.ts";

const digest = new Uint8Array(32).fill(0x5a);
const validRow = {
  identity_id: "550e8400-e29b-41d4-a716-446655440000",
  provider_subject: "google-subject-1",
  normalized_email: "owner@example.com",
  hosted_domain: "example.com",
  identity_active: true,
  user_active: true,
};

function fakePool(result: QueryResultRow[] | Error) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  return {
    calls,
    pool: {
      async query(text: string, values: readonly unknown[]) {
        calls.push({ text, values });
        if (result instanceof Error) throw result;
        return { rows: result };
      },
    },
  };
}

test("source authority sends only one 32-byte digest to the fixed reserve routine", async () => {
  const fake = fakePool([validRow]);
  const authority = createGoogleWorkspaceBootstrapSourceAuthority(fake.pool as never);

  assert.deepEqual(await authority.authenticate({
    credentialHash: digest,
    requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE",
  }), {
    identityId: validRow.identity_id,
    providerSubject: validRow.provider_subject,
    normalizedEmail: validRow.normalized_email,
    hostedDomain: validRow.hosted_domain,
    identityActive: true,
    userActive: true,
  });
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0]!.text, /authenticate_google_workspace_bootstrap_source_v1/);
  assert.equal(fake.calls[0]!.values.length, 1);
  assert.ok(Buffer.isBuffer(fake.calls[0]!.values[0]));
  assert.equal((fake.calls[0]!.values[0] as Buffer).byteLength, 32);
  assert.notEqual(fake.calls[0]!.values[0], digest);
});

test("source authority rejects non-reserve operations and non-digests without querying", async () => {
  const fake = fakePool([validRow]);
  const authority = createGoogleWorkspaceBootstrapSourceAuthority(fake.pool as never);

  for (const input of [
    { credentialHash: digest, requiredOperation: "FIRST_DOMAIN_CLAIM_READ" },
    { credentialHash: new Uint8Array(31), requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE" },
  ]) {
    await assert.rejects(
      authority.authenticate(input as never),
      GoogleWorkspaceSourceAuthorityUnavailableError,
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("source authority accepts a masked miss and rejects every non-scalar or malformed row", async () => {
  assert.equal(await createGoogleWorkspaceBootstrapSourceAuthority(
    fakePool([]).pool as never,
  ).authenticate({ credentialHash: digest, requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE" }), null);

  for (const result of [
    [validRow, validRow],
    [{ ...validRow, workspace_id: "must-not-cross-boundary" }],
    [{ ...validRow, normalized_email: "Owner@example.com" }],
    [{ ...validRow, hosted_domain: "other.example" }],
    [{ ...validRow, identity_active: false }],
  ] satisfies QueryResultRow[][]) {
    await assert.rejects(
      createGoogleWorkspaceBootstrapSourceAuthority(fakePool(result).pool as never)
        .authenticate({ credentialHash: digest, requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE" }),
      GoogleWorkspaceSourceAuthorityUnavailableError,
    );
  }
});

test("query and shape failures collapse to one secret-safe unavailable error", async () => {
  const secret = "raw-onboarding-secret-that-must-not-leak";
  for (const result of [new Error(secret), [{ ...validRow, provider_subject: "" }]]) {
    await assert.rejects(
      createGoogleWorkspaceBootstrapSourceAuthority(fakePool(result as Error | QueryResultRow[]).pool as never)
        .authenticate({ credentialHash: digest, requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE" }),
      (error: unknown) => {
        assert.ok(error instanceof GoogleWorkspaceSourceAuthorityUnavailableError);
        assert.equal(String(error).includes(secret), false);
        return true;
      },
    );
  }
});
