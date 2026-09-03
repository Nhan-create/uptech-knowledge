import assert from "node:assert/strict";
import test from "node:test";

import type { QueryResultRow } from "pg";

import type { VerifiedGoogleClaims } from "./claims.ts";
import type { WebPkceEnvelope } from "./crypto.ts";
import {
  createGoogleLoginRepository,
  GoogleLoginRepositoryError,
  type BeginGoogleLoginInput,
  type CompleteGoogleLoginInput,
  type ConsumeGoogleLoginInput,
  type GoogleLoginAccessState,
} from "./repository.ts";

const REQUEST_ID = "00000000-0000-4000-8000-000000000011";

function bytes(length: number, fill: number): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

const ENVELOPE: WebPkceEnvelope = Object.freeze({
  envelopeVersion: 1,
  algorithm: "AES-256-GCM",
  nonce: bytes(12, 1),
  ciphertext: bytes(43, 2),
  tag: bytes(16, 3),
});

const BEGIN_INPUT: BeginGoogleLoginInput = Object.freeze({
  networkHmac: bytes(32, 1),
  stateHash: bytes(32, 2),
  nonceHash: bytes(32, 3),
  browserBindingHash: bytes(32, 4),
  pkceEnvelope: ENVELOPE,
  requestId: REQUEST_ID,
});

const CONSUME_INPUT: ConsumeGoogleLoginInput = Object.freeze({
  networkHmac: bytes(32, 1),
  stateHash: bytes(32, 2),
  browserBindingHash: bytes(32, 4),
  completionHandleHash: bytes(32, 5),
  requestId: REQUEST_ID,
});

const CLAIMS: VerifiedGoogleClaims = Object.freeze({
  issuer: "https://accounts.google.com",
  providerSubject: "google-subject-123",
  normalizedEmail: "member@tenant-a.example",
  emailVerified: true,
  hostedDomain: "tenant-a.example",
  issuedAtEpochSeconds: 1_777_000_000,
  expiresAtEpochSeconds: 1_777_003_600,
  audienceConfigurationKey: "GOOGLE_WEB_LOGIN_V1",
  authorizedPartyConfigurationKey: "GOOGLE_WEB_LOGIN_V1",
  nonceHash: bytes(32, 6),
  displayName: "Display metadata is not a DB assertion field",
  pictureUrl: "https://lh3.googleusercontent.com/not-a-db-assertion-field",
});

const COMPLETE_INPUT: CompleteGoogleLoginInput = Object.freeze({
  completionHandleHash: bytes(32, 5),
  claims: CLAIMS,
  sessionTokenHash: bytes(32, 7),
  csrfTokenHash: bytes(32, 8),
  onboardingTokenHash: bytes(32, 9),
  requestId: REQUEST_ID,
});

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function queryResult<T extends QueryResultRow>(rows: T[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function fakePool(rows: QueryResultRow[]): {
  readonly calls: QueryCall[];
  readonly pool: {
    query<T extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<ReturnType<typeof queryResult<T>>>;
  };
} {
  const calls: QueryCall[] = [];
  return {
    calls,
    pool: {
      async query<T extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ) {
        calls.push({ text, values });
        return queryResult(rows as T[]);
      },
    },
  };
}

test("begin calls only the approved routine and strictly parses CREATED", async () => {
  const expiresAt = new Date("2026-08-25T04:10:00.000Z");
  const fake = fakePool([{ outcome: "CREATED", expires_at: expiresAt }]);
  const repository = createGoogleLoginRepository(fake.pool as never);

  const result = await repository.begin(BEGIN_INPUT);

  assert.deepEqual(result, { outcome: "CREATED", expiresAt });
  assert.notEqual(result.outcome === "CREATED" && result.expiresAt, expiresAt);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /uptech\.begin_google_login_transaction_v1/u);
  assert.doesNotMatch(fake.calls[0].text, /INSERT|UPDATE|DELETE/iu);
  assert.equal(fake.calls[0].values.length, 10);
  assert.deepEqual(fake.calls[0].values, [
    Buffer.from(BEGIN_INPUT.networkHmac),
    Buffer.from(BEGIN_INPUT.stateHash),
    Buffer.from(BEGIN_INPUT.nonceHash),
    Buffer.from(BEGIN_INPUT.browserBindingHash),
    1,
    "AES-256-GCM",
    Buffer.from(ENVELOPE.nonce),
    Buffer.from(ENVELOPE.ciphertext),
    Buffer.from(ENVELOPE.tag),
    REQUEST_ID,
  ]);
});

for (const outcome of ["RATE_LIMITED", "DENIED"] as const) {
  test(`begin strictly parses ${outcome} without an expiry`, async () => {
    const fake = fakePool([{ outcome, expires_at: null }]);
    const repository = createGoogleLoginRepository(fake.pool as never);

    assert.deepEqual(await repository.begin(BEGIN_INPUT), { outcome });
  });
}

test("consume parses and defensively copies the bounded reservation", async () => {
  const completionExpiresAt = new Date("2026-08-25T04:02:00.000Z");
  const expectedNonceHash = Buffer.alloc(32, 10);
  const associatedData = Buffer.from("bounded-associated-data", "utf8");
  const fake = fakePool([
    {
      outcome: "RESERVED",
      configuration_key: "GOOGLE_WEB_LOGIN_V1",
      expected_nonce_hash: expectedNonceHash,
      envelope_version: 1,
      algorithm: "AES-256-GCM",
      nonce: Buffer.from(ENVELOPE.nonce),
      ciphertext: Buffer.from(ENVELOPE.ciphertext),
      tag: Buffer.from(ENVELOPE.tag),
      pkce_kms_key_version: "offline-test-v1",
      pkce_associated_data: associatedData,
      completion_expires_at: completionExpiresAt,
    },
  ]);
  const repository = createGoogleLoginRepository(fake.pool as never);

  const result = await repository.consume(CONSUME_INPUT);

  assert.equal(result.outcome, "RESERVED");
  if (result.outcome !== "RESERVED") {
    assert.fail("expected a reserved result");
  }
  assert.deepEqual(result, {
    outcome: "RESERVED",
    configurationKey: "GOOGLE_WEB_LOGIN_V1",
    expectedNonceHash: Uint8Array.from(expectedNonceHash),
    pkceEnvelope: ENVELOPE,
    pkceKmsKeyVersion: "offline-test-v1",
    pkceAssociatedData: Uint8Array.from(associatedData),
    completionExpiresAt,
  });
  assert.notEqual(result.expectedNonceHash, expectedNonceHash);
  assert.notEqual(result.pkceEnvelope.nonce, ENVELOPE.nonce);
  assert.notEqual(result.pkceEnvelope.ciphertext, ENVELOPE.ciphertext);
  assert.notEqual(result.pkceEnvelope.tag, ENVELOPE.tag);
  assert.notEqual(result.pkceAssociatedData, associatedData);
  assert.notEqual(result.completionExpiresAt, completionExpiresAt);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /uptech\.consume_google_login_transaction_v1/u);
  assert.equal(fake.calls[0].values.length, 5);
  assert.deepEqual(fake.calls[0].values, [
    Buffer.from(CONSUME_INPUT.networkHmac),
    Buffer.from(CONSUME_INPUT.stateHash),
    Buffer.from(CONSUME_INPUT.browserBindingHash),
    Buffer.from(CONSUME_INPUT.completionHandleHash),
    REQUEST_ID,
  ]);
});

for (const outcome of ["RATE_LIMITED", "DENIED"] as const) {
  test(`consume parses the minimal ${outcome} discriminant`, async () => {
    const fake = fakePool([{ outcome }]);
    const repository = createGoogleLoginRepository(fake.pool as never);

    assert.deepEqual(await repository.consume(CONSUME_INPUT), { outcome });
  });
}

test("complete sends exactly the approved typed assertion and credential hashes", async () => {
  const fake = fakePool([
    { outcome: "NORMAL", allowed_operations: null, expires_at: null },
  ]);
  const repository = createGoogleLoginRepository(fake.pool as never);

  assert.deepEqual(await repository.complete(COMPLETE_INPUT), {
    outcome: "NORMAL",
  });

  assert.equal(fake.calls.length, 1);
  assert.match(
    fake.calls[0].text,
    /uptech\.complete_web_google_login_directory_v1/u,
  );
  assert.doesNotMatch(
    fake.calls[0].text,
    /FROM uptech\.complete_web_google_login_v1\(/u,
  );
  assert.equal(fake.calls[0].values.length, 15);
  assert.deepEqual(fake.calls[0].values, [
    Buffer.from(COMPLETE_INPUT.completionHandleHash),
    CLAIMS.issuer,
    CLAIMS.providerSubject,
    CLAIMS.normalizedEmail,
    true,
    CLAIMS.hostedDomain,
    new Date(CLAIMS.issuedAtEpochSeconds * 1_000),
    new Date(CLAIMS.expiresAtEpochSeconds * 1_000),
    "GOOGLE_WEB_LOGIN_V1",
    "GOOGLE_WEB_LOGIN_V1",
    Buffer.from(CLAIMS.nonceHash),
    Buffer.from(COMPLETE_INPUT.sessionTokenHash),
    Buffer.from(COMPLETE_INPUT.csrfTokenHash),
    Buffer.from(COMPLETE_INPUT.onboardingTokenHash),
    REQUEST_ID,
  ]);

  const serializedValues = JSON.stringify(fake.calls[0].values);
  assert.equal(serializedValues.includes(CLAIMS.displayName ?? ""), false);
  assert.equal(serializedValues.includes(CLAIMS.pictureUrl ?? ""), false);
});

test("complete strictly parses onboarding and copies its operations/expiry", async () => {
  const expiresAt = new Date("2026-08-25T04:15:00.000Z");
  const operations = ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"];
  const fake = fakePool([
    {
      outcome: "ONBOARDING",
      access_state: "USER_NOT_PROVISIONED",
      allowed_operations: operations,
      expires_at: expiresAt,
    },
  ]);
  const repository = createGoogleLoginRepository(fake.pool as never);

  const result = await repository.complete(COMPLETE_INPUT);

  assert.deepEqual(result, {
    outcome: "ONBOARDING",
    accessState: "USER_NOT_PROVISIONED",
    allowedOperations: operations,
    expiresAt,
  });
  if (result.outcome !== "ONBOARDING") {
    assert.fail("expected onboarding");
  }
  assert.notEqual(result.allowedOperations, operations);
  assert.notEqual(result.expiresAt, expiresAt);
  assert.equal(Object.isFrozen(result.allowedOperations), true);
});

test("complete parses DENIED without returning candidate authority", async () => {
  const fake = fakePool([
    { outcome: "DENIED", allowed_operations: null, expires_at: null },
  ]);
  const repository = createGoogleLoginRepository(fake.pool as never);

  assert.deepEqual(await repository.complete(COMPLETE_INPUT), {
    outcome: "DENIED",
  });
});

const ONBOARDING_ACCESS_STATES = [
  [
    "UNKNOWN_WORKSPACE",
    [
      "FIRST_DOMAIN_CLAIM_READ",
      "FIRST_DOMAIN_CLAIM_RESERVE",
      "FIRST_DOMAIN_CLAIM_COMPLETE",
      "ACCESS_REQUEST_READ",
      "ACCESS_REQUEST_SUBMIT",
    ],
  ],
] as const satisfies readonly (readonly [
  GoogleLoginAccessState,
  readonly string[],
])[];

for (const [accessState, allowedOperations] of ONBOARDING_ACCESS_STATES) {
  test(`complete preserves the fixed ${accessState} onboarding access state without authority`, async () => {
    const expiresAt = new Date("2026-09-01T04:15:00.000Z");
    const fake = fakePool([
      {
        outcome: "ONBOARDING",
        access_state: accessState,
        allowed_operations: allowedOperations,
        expires_at: expiresAt,
      },
    ]);
    const repository = createGoogleLoginRepository(fake.pool as never);

    assert.deepEqual(await repository.complete(COMPLETE_INPUT), {
      outcome: "ONBOARDING",
      accessState,
      allowedOperations,
      expiresAt,
    });
    assert.match(fake.calls[0].text, /result\.access_state/u);
  });
}

const SUSPENDED_ACCESS_STATES = [
  "USER_SUSPENDED",
  "WORKSPACE_SUSPENDED",
] as const satisfies readonly GoogleLoginAccessState[];

for (const accessState of SUSPENDED_ACCESS_STATES) {
  test(`complete preserves the fixed ${accessState} denied access state without authority`, async () => {
    const fake = fakePool([
      {
        outcome: "DENIED",
        access_state: accessState,
        allowed_operations: null,
        expires_at: null,
      },
    ]);
    const repository = createGoogleLoginRepository(fake.pool as never);

    assert.deepEqual(await repository.complete(COMPLETE_INPUT), {
      outcome: "DENIED",
      accessState,
    });
  });
}

test("complete rejects access states that do not match their safe completion outcome", async () => {
  for (const row of [
    {
      outcome: "ONBOARDING",
      access_state: "USER_SUSPENDED",
      allowed_operations: ["ACCESS_REQUEST_READ"],
      expires_at: new Date("2026-09-01T04:15:00.000Z"),
    },
    {
      outcome: "DENIED",
      access_state: "UNKNOWN_WORKSPACE",
      allowed_operations: null,
      expires_at: null,
    },
  ]) {
    const fake = fakePool([row]);
    const repository = createGoogleLoginRepository(fake.pool as never);
    await assert.rejects(
      repository.complete(COMPLETE_INPUT),
      GoogleLoginRepositoryError,
    );
  }
});

test("complete rejects onboarding operations mapped to the wrong safe access state", async () => {
  for (const row of [
    {
      outcome: "ONBOARDING",
      access_state: "UNKNOWN_WORKSPACE",
      allowed_operations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
      expires_at: new Date("2026-09-01T04:15:00.000Z"),
    },
    {
      outcome: "ONBOARDING",
      access_state: "USER_NOT_PROVISIONED",
      allowed_operations: [
        "FIRST_DOMAIN_CLAIM_READ",
        "FIRST_DOMAIN_CLAIM_RESERVE",
        "FIRST_DOMAIN_CLAIM_COMPLETE",
        "ACCESS_REQUEST_READ",
        "ACCESS_REQUEST_SUBMIT",
      ],
      expires_at: new Date("2026-09-01T04:15:00.000Z"),
    },
  ]) {
    const fake = fakePool([row]);
    const repository = createGoogleLoginRepository(fake.pool as never);
    await assert.rejects(
      repository.complete(COMPLETE_INPUT),
      GoogleLoginRepositoryError,
    );
  }
});

test("bound and unbound rejection calls use only their approved overloads", async () => {
  const unbound = fakePool([{ outcome: "RECORDED" }]);
  const unboundRepository = createGoogleLoginRepository(unbound.pool as never);
  assert.equal(
    await unboundRepository.rejectUnbound({
      networkHmac: bytes(32, 1),
      rejectionClass: "PROTOCOL_INVALID",
      requestId: REQUEST_ID,
    }),
    "RECORDED",
  );
  assert.match(unbound.calls[0].text, /'WEB_LOGIN'/u);
  assert.deepEqual(unbound.calls[0].values, [
    Buffer.from(bytes(32, 1)),
    "PROTOCOL_INVALID",
    REQUEST_ID,
  ]);

  const bound = fakePool([{ outcome: "RATE_LIMITED" }]);
  const boundRepository = createGoogleLoginRepository(bound.pool as never);
  assert.equal(
    await boundRepository.rejectBound({
      completionHandleHash: bytes(32, 5),
      rejectionClass: "CLAIMS_INVALID",
      requestId: REQUEST_ID,
    }),
    "RATE_LIMITED",
  );
  assert.doesNotMatch(bound.calls[0].text, /'WEB_LOGIN'/u);
  assert.deepEqual(bound.calls[0].values, [
    Buffer.from(bytes(32, 5)),
    "CLAIMS_INVALID",
    REQUEST_ID,
  ]);
});

test("malformed begin rows fail closed", async () => {
  for (const rows of [
    [],
    [
      { outcome: "CREATED", expires_at: new Date() },
      { outcome: "CREATED", expires_at: new Date() },
    ],
    [{ outcome: "CREATED", expires_at: "not-a-date" }],
    [{ outcome: "DENIED", expires_at: new Date() }],
    [{ outcome: "UNKNOWN", expires_at: null }],
  ]) {
    const fake = fakePool(rows);
    const repository = createGoogleLoginRepository(fake.pool as never);
    await assert.rejects(
      repository.begin(BEGIN_INPUT),
      GoogleLoginRepositoryError,
    );
  }
});

test("malformed consume reservations fail closed", async () => {
  const valid = {
    outcome: "RESERVED",
    configuration_key: "GOOGLE_WEB_LOGIN_V1",
    expected_nonce_hash: Buffer.alloc(32),
    envelope_version: 1,
    algorithm: "AES-256-GCM",
    nonce: Buffer.alloc(12),
    ciphertext: Buffer.alloc(43),
    tag: Buffer.alloc(16),
    pkce_associated_data: Buffer.from("associated-data"),
    completion_expires_at: new Date(),
  };
  for (const row of [
    { ...valid, configuration_key: "UNAPPROVED" },
    { ...valid, expected_nonce_hash: Buffer.alloc(31) },
    { ...valid, envelope_version: 2 },
    { ...valid, algorithm: "PLAINTEXT" },
    { ...valid, nonce: Buffer.alloc(11) },
    { ...valid, ciphertext: Buffer.alloc(35) },
    { ...valid, tag: Buffer.alloc(15) },
    { ...valid, pkce_associated_data: "not-bytes" },
    { ...valid, completion_expires_at: Number.NaN },
  ]) {
    const fake = fakePool([row]);
    const repository = createGoogleLoginRepository(fake.pool as never);
    await assert.rejects(
      repository.consume(CONSUME_INPUT),
      GoogleLoginRepositoryError,
    );
  }
});

test("malformed completion and rejection rows fail closed", async () => {
  for (const row of [
    { outcome: "ONBOARDING", allowed_operations: [], expires_at: new Date() },
    {
      outcome: "ONBOARDING",
      allowed_operations: [""],
      expires_at: new Date(),
    },
    {
      outcome: "ONBOARDING",
      allowed_operations: ["allowed"],
      expires_at: "not-a-date",
    },
    { outcome: "UNKNOWN", allowed_operations: null, expires_at: null },
  ]) {
    const fake = fakePool([row]);
    const repository = createGoogleLoginRepository(fake.pool as never);
    await assert.rejects(
      repository.complete(COMPLETE_INPUT),
      GoogleLoginRepositoryError,
    );
  }

  const fake = fakePool([{ outcome: "UNKNOWN" }]);
  const repository = createGoogleLoginRepository(fake.pool as never);
  await assert.rejects(
    repository.rejectBound({
      completionHandleHash: bytes(32, 1),
      rejectionClass: "INTERNAL_FAILURE",
      requestId: REQUEST_ID,
    }),
    GoogleLoginRepositoryError,
  );
});
