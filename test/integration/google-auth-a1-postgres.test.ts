import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import {
  Pool,
  type PoolClient,
  type QueryResultRow,
} from "pg";

import {
  revokeCurrentWebSession,
  type AuthenticatedWebSession,
} from "../../src/server/auth/web-session.ts";
import { authenticateSession } from "../../src/server/db/core.ts";
import { runtimePoolConfig } from "../../src/server/db/runtime-pool.ts";

const TEST_DATABASE_NAME_PREFIX = "uptech_phase1_test";
const API_TEST_LOGIN = `uptech_a1_api_login_${process.pid}`;
const WORKER_TEST_LOGIN = `uptech_a1_worker_login_${process.pid}`;
const TEST_LOGIN_PASSWORD = "a1-postgres-integration-only";
const TEST_ENVIRONMENT_NAME = "a1-integration";
const TEST_WEB_KMS_KEY_VERSION = "a1-integration-kms-v1";

type GooglePurpose =
  | "WEB_LOGIN"
  | "NATIVE_ANDROID_LOGIN"
  | "NATIVE_IOS_LOGIN";

type GoogleConfigurationKey =
  | "GOOGLE_WEB_LOGIN_V1"
  | "GOOGLE_NATIVE_ANDROID_LOGIN_V1"
  | "GOOGLE_NATIVE_IOS_LOGIN_V1";

interface WebTransactionFixture {
  readonly networkHash: Buffer;
  readonly stateHash: Buffer;
  readonly nonceHash: Buffer;
  readonly browserHash: Buffer;
  readonly envelopeNonce: Buffer;
  readonly envelopeCiphertext: Buffer;
  readonly envelopeTag: Buffer;
  readonly requestId: string;
}

interface NativeTransactionFixture {
  readonly purpose: Exclude<GooglePurpose, "WEB_LOGIN">;
  readonly networkHash: Buffer;
  readonly handleHash: Buffer;
  readonly challengeHash: Buffer;
  readonly requestId: string;
}

interface VerifiedClaims {
  readonly issuer: "https://accounts.google.com" | "accounts.google.com";
  readonly subject: string;
  readonly email: string;
  readonly domain: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly audience: GoogleConfigurationKey;
  readonly authorizedParty: GoogleConfigurationKey | null;
  readonly webNonceHash: Buffer | null;
}

interface WebConsumeResult extends QueryResultRow {
  readonly outcome: "RESERVED" | "RATE_LIMITED" | "DENIED";
  readonly configuration_key: GoogleConfigurationKey | null;
  readonly expected_nonce_hash: Buffer | null;
  readonly envelope_version: number | null;
  readonly pkce_kms_key_version: string | null;
  readonly pkce_associated_data: Buffer | null;
}

let admin: Pool | undefined;
let api: Pool | undefined;
let worker: Pool | undefined;
let runtimeLoginsCreated = false;
let activeEnvironment = "";
let webKmsKeyVersion = "";

function requiredTestDatabaseUrl(): string {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "UPTECH_TEST_DATABASE_URL is required; A1 PostgreSQL integration tests never skip",
    );
  }

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName.startsWith(TEST_DATABASE_NAME_PREFIX)) {
    throw new Error(
      `refusing non-disposable database: name must start with ${TEST_DATABASE_NAME_PREFIX}`,
    );
  }

  return value;
}

function adminPool(): Pool {
  return new Pool({
    connectionString: requiredTestDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max: 8,
  });
}

function runtimePool(
  role: "uptech_api_runtime" | "uptech_worker_runtime",
  max = 1,
): Pool {
  const connectionUrl = new URL(requiredTestDatabaseUrl());
  connectionUrl.username =
    role === "uptech_api_runtime" ? API_TEST_LOGIN : WORKER_TEST_LOGIN;
  connectionUrl.password = TEST_LOGIN_PASSWORD;
  if (role === "uptech_api_runtime") {
    return new Pool({
      ...runtimePoolConfig(connectionUrl.toString()),
      idleTimeoutMillis: 1_000,
      max,
    });
  }
  return new Pool({
    connectionString: connectionUrl.toString(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max,
    options: `-c role=${role}`,
  });
}

function hash32(): Buffer {
  return randomBytes(32);
}

function normalizedTestDomain(label: string): string {
  return `${label}-${randomBytes(8).toString("hex")}.test`;
}

function newWebTransaction(): WebTransactionFixture {
  return {
    networkHash: hash32(),
    stateHash: hash32(),
    nonceHash: hash32(),
    browserHash: hash32(),
    envelopeNonce: randomBytes(12),
    envelopeCiphertext: randomBytes(36),
    envelopeTag: randomBytes(16),
    requestId: randomUUID(),
  };
}

function newNativeTransaction(
  purpose: Exclude<GooglePurpose, "WEB_LOGIN">,
): NativeTransactionFixture {
  return {
    purpose,
    networkHash: hash32(),
    handleHash: hash32(),
    challengeHash: hash32(),
    requestId: randomUUID(),
  };
}

function newClaims(input: {
  subject: string;
  domain: string;
  webNonceHash: Buffer | null;
  audience?: GoogleConfigurationKey;
  authorizedParty?: GoogleConfigurationKey | null;
}): VerifiedClaims {
  const issuedAt = new Date(Date.now() - 1_000);
  return {
    issuer: "https://accounts.google.com",
    subject: input.subject,
    email: `member-${randomBytes(6).toString("hex")}@${input.domain}`,
    domain: input.domain,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1_000),
    audience: input.audience ?? "GOOGLE_WEB_LOGIN_V1",
    authorizedParty: input.authorizedParty ?? null,
    webNonceHash: input.webNonceHash,
  };
}

async function withMigrationOwner<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assert.ok(admin !== undefined);
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrationRows<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return withMigrationOwner(async (client) => {
    const result = await client.query<Row>(text, [...values]);
    return result.rows;
  });
}

async function seedImmutableRegistry(): Promise<void> {
  await withMigrationOwner(async (client) => {
    const existingEnvironment = await client.query<{
      environment_name: string;
    }>(`
      SELECT environment_name::text
      FROM uptech.google_auth_environment_registry
      WHERE is_active
    `);

    if (existingEnvironment.rowCount === 0) {
      await client.query(
        `INSERT INTO uptech.google_auth_environment_registry
           (environment_name, rate_limit_audit_hmac_key, is_active)
         VALUES ($1::uptech.google_auth_ascii_identifier_v1,
                 $2::uptech.google_auth_hash32_v1, true)`,
        [TEST_ENVIRONMENT_NAME, hash32()],
      );
      activeEnvironment = TEST_ENVIRONMENT_NAME;
    } else {
      activeEnvironment = existingEnvironment.rows[0].environment_name;
    }

    await client.query(
      `INSERT INTO uptech.google_auth_configuration_registry
         (configuration_key, environment_name, purpose, google_client_id,
          google_audience, audience_configuration_key, callback_uri, scopes,
          allowed_azp_configuration_keys, web_pkce_kms_key_version, is_enabled)
       VALUES (
         'GOOGLE_WEB_LOGIN_V1',
         $1::uptech.google_auth_ascii_identifier_v1,
         'WEB_LOGIN',
         'a1-web.apps.googleusercontent.com',
         'a1-web.apps.googleusercontent.com',
         'GOOGLE_WEB_LOGIN_V1',
         'https://a1.example.test/api/v1/auth/google/callback',
         ARRAY['openid', 'email', 'profile']::text[],
         ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
         $2::uptech.google_auth_ascii_identifier_v1,
         true
       )
       ON CONFLICT (configuration_key) DO NOTHING`,
      [activeEnvironment, TEST_WEB_KMS_KEY_VERSION],
    );

    await client.query(
      `INSERT INTO uptech.google_auth_configuration_registry
         (configuration_key, environment_name, purpose, google_client_id,
          google_audience, audience_configuration_key, callback_uri, scopes,
          allowed_azp_configuration_keys, web_pkce_kms_key_version, is_enabled)
       VALUES (
         'GOOGLE_NATIVE_ANDROID_LOGIN_V1',
         $1::uptech.google_auth_ascii_identifier_v1,
         'NATIVE_ANDROID_LOGIN',
         'a1-android.apps.googleusercontent.com',
         'a1-web.apps.googleusercontent.com',
         'GOOGLE_WEB_LOGIN_V1',
         'https://a1.example.test/api/v1/auth/google/native/android',
         ARRAY['openid', 'email', 'profile']::text[],
         ARRAY[
           'GOOGLE_NATIVE_ANDROID_LOGIN_V1'::uptech.google_auth_configuration_key_v1
         ],
         NULL,
         true
       )
       ON CONFLICT (configuration_key) DO NOTHING`,
      [activeEnvironment],
    );

    await client.query(
      `INSERT INTO uptech.google_auth_configuration_registry
         (configuration_key, environment_name, purpose, google_client_id,
          google_audience, audience_configuration_key, callback_uri, scopes,
          allowed_azp_configuration_keys, web_pkce_kms_key_version, is_enabled)
       VALUES (
         'GOOGLE_NATIVE_IOS_LOGIN_V1',
         $1::uptech.google_auth_ascii_identifier_v1,
         'NATIVE_IOS_LOGIN',
         'a1-ios.apps.googleusercontent.com',
         'a1-web.apps.googleusercontent.com',
         'GOOGLE_WEB_LOGIN_V1',
         'https://a1.example.test/api/v1/auth/google/native/ios',
         ARRAY['openid', 'email', 'profile']::text[],
         ARRAY[
           'GOOGLE_NATIVE_IOS_LOGIN_V1'::uptech.google_auth_configuration_key_v1
         ],
         NULL,
         true
       )
       ON CONFLICT (configuration_key) DO NOTHING`,
      [activeEnvironment],
    );

    const configurations = await client.query<{
      configuration_key: GoogleConfigurationKey;
      web_pkce_kms_key_version: string | null;
    }>(
      `SELECT configuration_key::text, web_pkce_kms_key_version::text
       FROM uptech.google_auth_configuration_registry
       WHERE environment_name = $1::uptech.google_auth_ascii_identifier_v1
         AND is_enabled
       ORDER BY configuration_key`,
      [activeEnvironment],
    );
    assert.equal(
      configurations.rowCount,
      3,
      "the disposable database must expose all three enabled A1 configurations",
    );
    webKmsKeyVersion =
      configurations.rows.find(
        ({ configuration_key }) =>
          configuration_key === "GOOGLE_WEB_LOGIN_V1",
      )?.web_pkce_kms_key_version ?? "";
    assert.notEqual(webKmsKeyVersion, "");
  });
}

async function beginWeb(
  fixture: WebTransactionFixture,
  purpose: GooglePurpose = "WEB_LOGIN",
  requestId = fixture.requestId,
): Promise<"CREATED" | "RATE_LIMITED" | "DENIED"> {
  assert.ok(api !== undefined);
  const result = await api.query<{ outcome: "CREATED" | "RATE_LIMITED" | "DENIED" }>(
    `SELECT result.outcome::text AS outcome
     FROM uptech.begin_google_login_transaction_v1(
       $1::uptech.google_login_purpose_v1,
       $2::uptech.google_auth_hash32_v1,
       $3::uptech.google_auth_hash32_v1,
       $4::uptech.google_auth_hash32_v1,
       $5::uptech.google_auth_hash32_v1,
       ROW(
         1::smallint,
         'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
         $6::uptech.google_auth_nonce12_v1,
         $7::uptech.google_auth_pkce_ciphertext_v1,
         $8::uptech.google_auth_tag16_v1
       )::uptech.google_web_pkce_envelope_v1,
       $9::uuid
     ) AS result`,
    [
      purpose,
      fixture.networkHash,
      fixture.stateHash,
      fixture.nonceHash,
      fixture.browserHash,
      fixture.envelopeNonce,
      fixture.envelopeCiphertext,
      fixture.envelopeTag,
      requestId,
    ],
  );
  return result.rows[0].outcome;
}

async function consumeWeb(input: {
  purpose?: GooglePurpose;
  networkHash: Buffer;
  stateHash: Buffer;
  browserHash: Buffer;
  completionHash: Buffer;
  requestId?: string;
}): Promise<WebConsumeResult> {
  assert.ok(api !== undefined);
  const result = await api.query<WebConsumeResult>(
    `SELECT
       result.outcome::text AS outcome,
       result.configuration_key::text AS configuration_key,
       result.expected_nonce_hash,
       (result.pkce_envelope).envelope_version AS envelope_version,
       result.pkce_kms_key_version::text AS pkce_kms_key_version,
       result.pkce_associated_data
     FROM uptech.consume_google_login_transaction_v1(
       $1::uptech.google_login_purpose_v1,
       $2::uptech.google_auth_hash32_v1,
       $3::uptech.google_auth_hash32_v1,
       $4::uptech.google_auth_hash32_v1,
       $5::uptech.google_auth_hash32_v1,
       $6::uuid
     ) AS result`,
    [
      input.purpose ?? "WEB_LOGIN",
      input.networkHash,
      input.stateHash,
      input.browserHash,
      input.completionHash,
      input.requestId ?? randomUUID(),
    ],
  );
  return result.rows[0];
}

async function beginNative(
  fixture: NativeTransactionFixture,
  purpose: GooglePurpose = fixture.purpose,
  requestId = fixture.requestId,
): Promise<"CREATED" | "RATE_LIMITED" | "DENIED"> {
  assert.ok(api !== undefined);
  const result = await api.query<{ outcome: "CREATED" | "RATE_LIMITED" | "DENIED" }>(
    `SELECT result.outcome::text AS outcome
     FROM uptech.begin_google_login_transaction_v1(
       $1::uptech.google_login_purpose_v1,
       $2::uptech.google_auth_hash32_v1,
       $3::uptech.google_native_transaction_handle_hash_v1,
       $4::uptech.google_native_s256_hash_v1,
       $5::uuid
     ) AS result`,
    [
      purpose,
      fixture.networkHash,
      fixture.handleHash,
      fixture.challengeHash,
      requestId,
    ],
  );
  return result.rows[0].outcome;
}

async function consumeNative(input: {
  purpose: GooglePurpose;
  networkHash: Buffer;
  handleHash: Buffer;
  verifierHash: Buffer;
  completionHash: Buffer;
  requestId?: string;
}): Promise<"RESERVED" | "RATE_LIMITED" | "DENIED"> {
  assert.ok(api !== undefined);
  const result = await api.query<{
    outcome: "RESERVED" | "RATE_LIMITED" | "DENIED";
  }>(
    `SELECT result.outcome::text AS outcome
     FROM uptech.consume_google_login_transaction_v1(
       $1::uptech.google_login_purpose_v1,
       $2::uptech.google_auth_hash32_v1,
       $3::uptech.google_native_transaction_handle_hash_v1,
       $4::uptech.google_native_s256_hash_v1,
       $5::uptech.google_auth_hash32_v1,
       $6::uuid
     ) AS result`,
    [
      input.purpose,
      input.networkHash,
      input.handleHash,
      input.verifierHash,
      input.completionHash,
      input.requestId ?? randomUUID(),
    ],
  );
  return result.rows[0].outcome;
}

async function rejectUnbound(
  purpose: GooglePurpose,
  networkHash: Buffer,
  requestId = randomUUID(),
): Promise<"RECORDED" | "RATE_LIMITED"> {
  assert.ok(api !== undefined);
  const result = await api.query<{ outcome: "RECORDED" | "RATE_LIMITED" }>(
    `SELECT uptech.record_google_login_rejection_v1(
       $1::uptech.google_login_purpose_v1,
       $2::uptech.google_auth_hash32_v1,
       'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,
       $3::uuid
     )::text AS outcome`,
    [purpose, networkHash, requestId],
  );
  return result.rows[0].outcome;
}

async function completeWeb(input: {
  completionHash: Buffer;
  claims: VerifiedClaims;
  sessionTokenHash: Buffer;
  csrfTokenHash: Buffer;
  onboardingTokenHash: Buffer | null;
  requestId?: string;
}): Promise<{
  outcome: "NORMAL" | "ONBOARDING" | "DENIED";
  allowed_operations: string[] | null;
}> {
  assert.ok(api !== undefined);
  const result = await api.query<{
    outcome: "NORMAL" | "ONBOARDING" | "DENIED";
    allowed_operations: string[] | null;
  }>(
    `SELECT
       result.outcome::text AS outcome,
       result.allowed_operations
     FROM uptech.complete_web_google_login_v1(
       $1::uptech.google_auth_hash32_v1,
       ROW(
         $2::uptech.google_auth_issuer_v1,
         $3::uptech.google_provider_subject_v1,
         $4::uptech.google_normalized_email_v1,
         true,
         $5::uptech.google_normalized_domain_v1,
         $6::timestamptz,
         $7::timestamptz,
         $8::uptech.google_auth_configuration_key_v1,
         $9::uptech.google_auth_configuration_key_v1,
         $10::uptech.google_auth_hash32_v1
       )::uptech.google_verified_claims_assertion_v1,
       $11::uptech.google_auth_hash32_v1,
       $12::uptech.google_auth_hash32_v1,
       $13::uptech.google_auth_hash32_v1,
       $14::uuid
     ) AS result`,
    [
      input.completionHash,
      input.claims.issuer,
      input.claims.subject,
      input.claims.email,
      input.claims.domain,
      input.claims.issuedAt,
      input.claims.expiresAt,
      input.claims.audience,
      input.claims.authorizedParty,
      input.claims.webNonceHash,
      input.sessionTokenHash,
      input.csrfTokenHash,
      input.onboardingTokenHash,
      input.requestId ?? randomUUID(),
    ],
  );
  return result.rows[0];
}

async function completeNative(input: {
  completionHash: Buffer;
  claims: VerifiedClaims;
  accessTokenHash: Buffer;
  refreshTokenHash: Buffer;
  deviceBindingHash: Buffer;
  onboardingTokenHash: Buffer | null;
  requestId?: string;
}): Promise<{
  outcome: "NORMAL" | "ONBOARDING" | "DENIED";
  allowed_operations: string[] | null;
}> {
  assert.ok(api !== undefined);
  const result = await api.query<{
    outcome: "NORMAL" | "ONBOARDING" | "DENIED";
    allowed_operations: string[] | null;
  }>(
    `SELECT
       result.outcome::text AS outcome,
       result.allowed_operations
     FROM uptech.complete_native_google_login_v1(
       $1::uptech.google_auth_hash32_v1,
       ROW(
         $2::uptech.google_auth_issuer_v1,
         $3::uptech.google_provider_subject_v1,
         $4::uptech.google_normalized_email_v1,
         true,
         $5::uptech.google_normalized_domain_v1,
         $6::timestamptz,
         $7::timestamptz,
         $8::uptech.google_auth_configuration_key_v1,
         $9::uptech.google_auth_configuration_key_v1,
         $10::uptech.google_auth_hash32_v1
       )::uptech.google_verified_claims_assertion_v1,
       $11::uptech.google_auth_hash32_v1,
       $12::uptech.google_auth_hash32_v1,
       $13::uptech.google_auth_hash32_v1,
       $14::uptech.google_auth_hash32_v1,
       $15::uuid
     ) AS result`,
    [
      input.completionHash,
      input.claims.issuer,
      input.claims.subject,
      input.claims.email,
      input.claims.domain,
      input.claims.issuedAt,
      input.claims.expiresAt,
      input.claims.audience,
      input.claims.authorizedParty,
      input.claims.webNonceHash,
      input.accessTokenHash,
      input.refreshTokenHash,
      input.deviceBindingHash,
      input.onboardingTokenHash,
      input.requestId ?? randomUUID(),
    ],
  );
  return result.rows[0];
}

async function reserveWebTransaction(): Promise<{
  fixture: WebTransactionFixture;
  completionHash: Buffer;
}> {
  const fixture = newWebTransaction();
  assert.equal(await beginWeb(fixture), "CREATED");
  const completionHash = hash32();
  const consumed = await consumeWeb({
    networkHash: fixture.networkHash,
    stateHash: fixture.stateHash,
    browserHash: fixture.browserHash,
    completionHash,
  });
  assert.equal(consumed.outcome, "RESERVED");
  assert.equal(consumed.configuration_key, "GOOGLE_WEB_LOGIN_V1");
  assert.deepEqual(consumed.expected_nonce_hash, fixture.nonceHash);
  assert.equal(consumed.envelope_version, 1);
  assert.equal(consumed.pkce_kms_key_version, webKmsKeyVersion);
  assert.deepEqual(
    consumed.pkce_associated_data,
    Buffer.from(
      `${activeEnvironment}\x1fWEB_LOGIN\x1fGOOGLE_WEB_LOGIN_V1\x1f${fixture.stateHash.toString("hex")}`,
      "utf8",
    ),
  );
  return { fixture, completionHash };
}

async function seedWorkspace(
  domain: string,
  provisioningPolicy: "INVITE_ONLY" | "DOMAIN_AUTO_PROVISION",
): Promise<string> {
  const workspaceId = randomUUID();
  await withMigrationOwner(async (client) => {
    await client.query(
      `INSERT INTO uptech.workspaces
         (workspace_id, status, provisioning_policy)
       VALUES ($1::uuid, 'ACTIVE', $2::text)`,
      [workspaceId, provisioningPolicy],
    );
    await client.query(
      `INSERT INTO uptech.workspace_domain_locators
         (normalized_domain, workspace_id, status, verified_at)
       VALUES ($1::uptech.google_normalized_domain_v1, $2::uuid,
               'VERIFIED', clock_timestamp())`,
      [domain, workspaceId],
    );
  });
  return workspaceId;
}

async function alignAwayFromDatabaseMinuteBoundary(): Promise<void> {
  assert.ok(admin !== undefined);
  const observed = await admin.query<{ second: number }>(
    `SELECT extract(second FROM clock_timestamp())::double precision AS second`,
  );
  const second = observed.rows[0].second;
  if (second >= 50) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.ceil((61 - second) * 1_000)),
    );
  }
}

async function waitForApiLock(queryFragment: string): Promise<void> {
  assert.ok(admin !== undefined);
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const waiting = await admin.query<{ waiting: number }>(
      `SELECT count(*)::integer AS waiting
       FROM pg_catalog.pg_stat_activity
       WHERE usename = $1
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query LIKE '%' || $2 || '%'`,
      [API_TEST_LOGIN, queryFragment],
    );
    if (waiting.rows[0].waiting > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`A1 integration query did not reach lock wait: ${queryFragment}`);
}

before(async () => {
  admin = adminPool();
  await admin.query(`
    BEGIN;
    CREATE ROLE ${API_TEST_LOGIN}
      LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${WORKER_TEST_LOGIN}
      LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    GRANT uptech_api_runtime TO ${API_TEST_LOGIN}
      WITH INHERIT FALSE, SET TRUE;
    GRANT uptech_worker_runtime TO ${WORKER_TEST_LOGIN}
      WITH INHERIT FALSE, SET TRUE;
    COMMIT;
  `);
  runtimeLoginsCreated = true;
  api = runtimePool("uptech_api_runtime", 40);
  worker = runtimePool("uptech_worker_runtime");
  await seedImmutableRegistry();
});

after(async () => {
  await Promise.all([api?.end(), worker?.end()]);
  if (admin !== undefined) {
    try {
      if (runtimeLoginsCreated) {
        await admin.query(`
          DROP ROLE IF EXISTS ${API_TEST_LOGIN};
          DROP ROLE IF EXISTS ${WORKER_TEST_LOGIN};
        `);
      }
    } finally {
      await admin.end();
    }
  }
});

test("A1 routines are API-execute-only and both runtime roles lack direct pre-tenant table access", async () => {
  const signatures = [
    "uptech.begin_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_web_pkce_envelope_v1,uuid)",
    "uptech.begin_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_native_transaction_handle_hash_v1,uptech.google_native_s256_hash_v1,uuid)",
    "uptech.consume_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)",
    "uptech.consume_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_native_transaction_handle_hash_v1,uptech.google_native_s256_hash_v1,uptech.google_auth_hash32_v1,uuid)",
    "uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)",
    "uptech.complete_native_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)",
    "uptech.record_google_login_rejection_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uuid)",
    "uptech.record_google_login_rejection_v1(uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uuid)",
  ];
  const privileges = await migrationRows<{
    signature: string;
    api_execute: boolean;
    worker_execute: boolean;
    public_execute: boolean;
  }>(
    `SELECT
       signature,
       has_function_privilege(
         'uptech_api_runtime', to_regprocedure(signature), 'EXECUTE'
       ) AS api_execute,
       has_function_privilege(
         'uptech_worker_runtime', to_regprocedure(signature), 'EXECUTE'
       ) AS worker_execute,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) AS acl_row
         WHERE procedure_row.oid = to_regprocedure(signature)
           AND acl_row.grantee = 0
           AND acl_row.privilege_type = 'EXECUTE'
       ) AS public_execute
     FROM unnest($1::text[]) AS signatures(signature)`,
    [signatures],
  );
  assert.equal(privileges.length, 8);
  for (const privilege of privileges) {
    assert.equal(privilege.api_execute, true, privilege.signature);
    assert.equal(privilege.worker_execute, false, privilege.signature);
    assert.equal(privilege.public_execute, false, privilege.signature);
  }

  const directPrivileges = await migrationRows<{
    role_name: string;
    table_name: string;
    has_any: boolean;
  }>(`
    SELECT
      role_name,
      table_name,
      has_table_privilege(
        role_name,
        format('uptech.%I', table_name),
        'SELECT'
      )
      OR has_table_privilege(
        role_name,
        format('uptech.%I', table_name),
        'INSERT'
      )
      OR has_table_privilege(
        role_name,
        format('uptech.%I', table_name),
        'UPDATE'
      )
      OR has_table_privilege(
        role_name,
        format('uptech.%I', table_name),
        'DELETE'
      ) AS has_any
    FROM unnest(ARRAY[
      'uptech_api_runtime', 'uptech_worker_runtime'
    ]) AS roles(role_name)
    CROSS JOIN unnest(ARRAY[
      'google_auth_environment_registry',
      'google_auth_configuration_registry',
      'workspace_domain_locators',
      'google_auth_rate_limit_buckets',
      'oauth_transactions',
      'platform_audit_events',
      'users',
      'identities',
      'onboarding_sessions'
    ]) AS tables(table_name)
  `);
  assert.ok(directPrivileges.every(({ has_any }) => !has_any));

  const networkHash = hash32();
  assert.equal(await rejectUnbound("WEB_LOGIN", networkHash), "RECORDED");
  assert.ok(worker !== undefined);
  await assert.rejects(
    worker.query(
      `SELECT uptech.record_google_login_rejection_v1(
         'WEB_LOGIN'::uptech.google_login_purpose_v1,
         $1::uptech.google_auth_hash32_v1,
         'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,
         $2::uuid
       )`,
      [hash32(), randomUUID()],
    ),
    /permission denied/u,
  );
});

test("concurrent mixed and cross-purpose ingress shares one 10/minute bucket and one summary audit", async () => {
  await alignAwayFromDatabaseMinuteBoundary();
  const networkHash = hash32();
  const requestIds = Array.from({ length: 36 }, () => randomUUID());
  const calls = requestIds.map(async (requestId, index) => {
    switch (index % 4) {
      case 0:
        return beginWeb(
          { ...newWebTransaction(), networkHash },
          "WEB_LOGIN",
          requestId,
        );
      case 1:
        return beginNative(
          {
            ...newNativeTransaction("NATIVE_ANDROID_LOGIN"),
            networkHash,
          },
          "NATIVE_ANDROID_LOGIN",
          requestId,
        );
      case 2:
        return rejectUnbound("NATIVE_IOS_LOGIN", networkHash, requestId);
      default:
        return (
          await consumeWeb({
            networkHash,
            stateHash: hash32(),
            browserHash: hash32(),
            completionHash: hash32(),
            requestId,
          })
        ).outcome;
    }
  });
  const outcomes = await Promise.all(calls);
  assert.equal(
    outcomes.filter((outcome) => outcome !== "RATE_LIMITED").length,
    10,
  );
  assert.equal(
    outcomes.filter((outcome) => outcome === "RATE_LIMITED").length,
    26,
  );

  const independentNetwork = hash32();
  assert.equal(
    await rejectUnbound("NATIVE_ANDROID_LOGIN", independentNetwork),
    "RECORDED",
  );

  const rows = await migrationRows<{
    flood_count: number;
    flood_over_limit: boolean;
    independent_count: number;
    summary_count: number;
  }>(
    `SELECT
       (SELECT request_count::integer
        FROM uptech.google_auth_rate_limit_buckets
        WHERE network_hmac = $1::uptech.google_auth_hash32_v1
        ORDER BY window_started_at DESC
        LIMIT 1) AS flood_count,
       (SELECT over_limit_observed
        FROM uptech.google_auth_rate_limit_buckets
        WHERE network_hmac = $1::uptech.google_auth_hash32_v1
        ORDER BY window_started_at DESC
        LIMIT 1) AS flood_over_limit,
       (SELECT request_count::integer
        FROM uptech.google_auth_rate_limit_buckets
        WHERE network_hmac = $2::uptech.google_auth_hash32_v1
        ORDER BY window_started_at DESC
        LIMIT 1) AS independent_count,
       (SELECT count(*)::integer
        FROM uptech.platform_audit_events
        WHERE action = 'GOOGLE_AUTH_RATE_LIMITED'
          AND google_auth_rate_limit_audit_key IS NOT NULL
          AND request_id = ANY($3::uuid[])) AS summary_count`,
    [networkHash, independentNetwork, requestIds],
  );
  assert.deepEqual(rows, [
    {
      flood_count: 10,
      flood_over_limit: true,
      independent_count: 1,
      summary_count: 1,
    },
  ]);
});

test("expired transactions stay unusable and concurrent reservation has exactly one winner", async () => {
  const expired = newWebTransaction();
  assert.equal(await beginWeb(expired), "CREATED");
  await migrationRows(
    `WITH fixed_time AS (
       SELECT clock_timestamp() - interval '11 minutes' AS created_at
     )
     UPDATE uptech.oauth_transactions AS transaction_row
     SET created_at = fixed_time.created_at,
         expires_at = fixed_time.created_at + interval '10 minutes'
     FROM fixed_time
     WHERE transaction_row.locator_hash =
       $1::uptech.google_auth_hash32_v1`,
    [expired.stateHash],
  );
  const expiredConsume = await consumeWeb({
    networkHash: hash32(),
    stateHash: expired.stateHash,
    browserHash: expired.browserHash,
    completionHash: hash32(),
  });
  assert.equal(expiredConsume.outcome, "DENIED");
  assert.deepEqual(
    await migrationRows<{
      status: string;
      completion_handle_hash: Buffer | null;
    }>(
      `SELECT status::text, completion_handle_hash
       FROM uptech.oauth_transactions
       WHERE locator_hash = $1::uptech.google_auth_hash32_v1`,
      [expired.stateHash],
    ),
    [{ status: "PENDING", completion_handle_hash: null }],
  );

  const raced = newWebTransaction();
  assert.equal(await beginWeb(raced), "CREATED");
  const completionHashes = Array.from({ length: 12 }, () => hash32());
  const results = await Promise.all(
    completionHashes.map((completionHash) =>
      consumeWeb({
        networkHash: hash32(),
        stateHash: raced.stateHash,
        browserHash: raced.browserHash,
        completionHash,
      }),
    ),
  );
  assert.equal(
    results.filter(({ outcome }) => outcome === "RESERVED").length,
    1,
  );
  assert.equal(
    results.filter(({ outcome }) => outcome === "DENIED").length,
    11,
  );
  const winner = completionHashes[results.findIndex(({ outcome }) => outcome === "RESERVED")];
  const stored = await migrationRows<{
    status: string;
    completion_handle_hash: Buffer;
  }>(
    `SELECT status::text, completion_handle_hash
     FROM uptech.oauth_transactions
     WHERE locator_hash = $1::uptech.google_auth_hash32_v1`,
    [raced.stateHash],
  );
  assert.equal(stored[0].status, "EXCHANGE_RESERVED");
  assert.deepEqual(stored[0].completion_handle_hash, winner);
});

test("row-lock waits cannot reserve or complete after database expiry", async () => {
  assert.ok(admin !== undefined);

  const pending = newWebTransaction();
  assert.equal(await beginWeb(pending), "CREATED");
  await migrationRows(
    `WITH decision AS (SELECT clock_timestamp() AS observed_at)
     UPDATE uptech.oauth_transactions AS transaction_row
     SET created_at = decision.observed_at - interval '10 minutes'
                        + interval '2 seconds',
         expires_at = decision.observed_at + interval '2 seconds'
     FROM decision
     WHERE transaction_row.locator_hash =
       $1::uptech.google_auth_hash32_v1`,
    [pending.stateHash],
  );

  const pendingBlocker = await admin.connect();
  let pendingConsume: Promise<WebConsumeResult> | undefined;
  try {
    await pendingBlocker.query("BEGIN");
    await pendingBlocker.query("SET LOCAL ROLE uptech_migration_owner");
    await pendingBlocker.query(
      `SELECT id
       FROM uptech.oauth_transactions
       WHERE locator_hash = $1::uptech.google_auth_hash32_v1
       FOR UPDATE`,
      [pending.stateHash],
    );
    pendingConsume = consumeWeb({
      networkHash: pending.networkHash,
      stateHash: pending.stateHash,
      browserHash: pending.browserHash,
      completionHash: hash32(),
    });
    await waitForApiLock("consume_google_login_transaction_v1");
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await pendingBlocker.query("ROLLBACK");
  } finally {
    try {
      await pendingBlocker.query("ROLLBACK");
    } catch {
      // The guarded transaction may already be closed.
    }
    pendingBlocker.release();
  }
  assert.ok(pendingConsume !== undefined);
  assert.equal((await pendingConsume).outcome, "DENIED");

  const reserved = await reserveWebTransaction();
  await migrationRows(
    `WITH decision AS (SELECT clock_timestamp() AS observed_at)
     UPDATE uptech.oauth_transactions AS transaction_row
     SET consumed_at = decision.observed_at - interval '2 minutes'
                       + interval '2 seconds',
         completion_expires_at = decision.observed_at + interval '2 seconds'
     FROM decision
     WHERE transaction_row.completion_handle_hash =
       $1::uptech.google_auth_hash32_v1`,
    [reserved.completionHash],
  );

  const completionSubject = `lock-expiry-${randomUUID()}`;
  const completionBlocker = await admin.connect();
  let blockedCompletion: Promise<{
    outcome: "NORMAL" | "ONBOARDING" | "DENIED";
    allowed_operations: string[] | null;
  }> | undefined;
  try {
    await completionBlocker.query("BEGIN");
    await completionBlocker.query("SET LOCAL ROLE uptech_migration_owner");
    await completionBlocker.query(
      `SELECT id
       FROM uptech.oauth_transactions
       WHERE completion_handle_hash = $1::uptech.google_auth_hash32_v1
       FOR UPDATE`,
      [reserved.completionHash],
    );
    blockedCompletion = completeWeb({
      completionHash: reserved.completionHash,
      claims: newClaims({
        subject: completionSubject,
        domain: normalizedTestDomain("lock-expiry"),
        webNonceHash: reserved.fixture.nonceHash,
      }),
      sessionTokenHash: hash32(),
      csrfTokenHash: hash32(),
      onboardingTokenHash: hash32(),
    });
    await waitForApiLock("complete_web_google_login_v1");
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await completionBlocker.query("ROLLBACK");
  } finally {
    try {
      await completionBlocker.query("ROLLBACK");
    } catch {
      // The guarded transaction may already be closed.
    }
    completionBlocker.release();
  }
  assert.ok(blockedCompletion !== undefined);
  assert.equal((await blockedCompletion).outcome, "DENIED");

  const persisted = await migrationRows<{
    pending_status: string;
    pending_completion_hash: Buffer | null;
    reserved_status: string;
    identity_count: number;
  }>(
    `SELECT
       (SELECT status::text
        FROM uptech.oauth_transactions
        WHERE locator_hash = $1::uptech.google_auth_hash32_v1)
          AS pending_status,
       (SELECT completion_handle_hash
        FROM uptech.oauth_transactions
        WHERE locator_hash = $1::uptech.google_auth_hash32_v1)
          AS pending_completion_hash,
       (SELECT status::text
        FROM uptech.oauth_transactions
        WHERE completion_handle_hash = $2::uptech.google_auth_hash32_v1)
          AS reserved_status,
       (SELECT count(*)::integer
        FROM uptech.identities
        WHERE provider = 'GOOGLE'
          AND issuer = 'https://accounts.google.com'
          AND provider_subject = $3) AS identity_count`,
    [pending.stateHash, reserved.completionHash, completionSubject],
  );
  assert.deepEqual(persisted, [
    {
      pending_status: "PENDING",
      pending_completion_hash: null,
      reserved_status: "EXCHANGE_RESERVED",
      identity_count: 0,
    },
  ]);
});

test("native matrix masks wrong purpose, platform, configuration, nonce shape, and S256 proof", async () => {
  const android = newNativeTransaction("NATIVE_ANDROID_LOGIN");
  assert.equal(await beginNative(android), "CREATED");
  assert.equal(
    await consumeNative({
      purpose: "NATIVE_IOS_LOGIN",
      networkHash: hash32(),
      handleHash: android.handleHash,
      verifierHash: android.challengeHash,
      completionHash: hash32(),
    }),
    "DENIED",
  );
  assert.equal(
    (
      await consumeWeb({
        networkHash: hash32(),
        stateHash: android.handleHash,
        browserHash: hash32(),
        completionHash: hash32(),
      })
    ).outcome,
    "DENIED",
  );
  assert.equal(
    await consumeNative({
      purpose: "NATIVE_ANDROID_LOGIN",
      networkHash: hash32(),
      handleHash: android.handleHash,
      verifierHash: hash32(),
      completionHash: hash32(),
    }),
    "DENIED",
  );
  const androidCompletion = hash32();
  assert.equal(
    await consumeNative({
      purpose: "NATIVE_ANDROID_LOGIN",
      networkHash: hash32(),
      handleHash: android.handleHash,
      verifierHash: android.challengeHash,
      completionHash: androidCompletion,
    }),
    "RESERVED",
  );
  const androidDomain = normalizedTestDomain("native-android-invalid");
  assert.equal(
    (
      await completeWeb({
        completionHash: androidCompletion,
        claims: newClaims({
          subject: `android-web-${randomUUID()}`,
          domain: androidDomain,
          webNonceHash: hash32(),
        }),
        sessionTokenHash: hash32(),
        csrfTokenHash: hash32(),
        onboardingTokenHash: hash32(),
      })
    ).outcome,
    "DENIED",
  );
  assert.equal(
    (
      await completeNative({
        completionHash: androidCompletion,
        claims: newClaims({
          subject: `android-audience-${randomUUID()}`,
          domain: androidDomain,
          webNonceHash: null,
          audience: "GOOGLE_NATIVE_ANDROID_LOGIN_V1",
          authorizedParty: "GOOGLE_NATIVE_ANDROID_LOGIN_V1",
        }),
        accessTokenHash: hash32(),
        refreshTokenHash: hash32(),
        deviceBindingHash: hash32(),
        onboardingTokenHash: hash32(),
      })
    ).outcome,
    "DENIED",
  );

  const iosWrongAzp = newNativeTransaction("NATIVE_IOS_LOGIN");
  assert.equal(await beginNative(iosWrongAzp), "CREATED");
  const iosWrongAzpCompletion = hash32();
  assert.equal(
    await consumeNative({
      purpose: iosWrongAzp.purpose,
      networkHash: hash32(),
      handleHash: iosWrongAzp.handleHash,
      verifierHash: iosWrongAzp.challengeHash,
      completionHash: iosWrongAzpCompletion,
    }),
    "RESERVED",
  );
  assert.equal(
    (
      await completeNative({
        completionHash: iosWrongAzpCompletion,
        claims: newClaims({
          subject: `ios-azp-${randomUUID()}`,
          domain: normalizedTestDomain("native-ios-azp"),
          webNonceHash: null,
          authorizedParty: "GOOGLE_NATIVE_ANDROID_LOGIN_V1",
        }),
        accessTokenHash: hash32(),
        refreshTokenHash: hash32(),
        deviceBindingHash: hash32(),
        onboardingTokenHash: hash32(),
      })
    ).outcome,
    "DENIED",
  );

  const androidWrongNonce = newNativeTransaction("NATIVE_ANDROID_LOGIN");
  assert.equal(await beginNative(androidWrongNonce), "CREATED");
  const androidWrongNonceCompletion = hash32();
  assert.equal(
    await consumeNative({
      purpose: androidWrongNonce.purpose,
      networkHash: hash32(),
      handleHash: androidWrongNonce.handleHash,
      verifierHash: androidWrongNonce.challengeHash,
      completionHash: androidWrongNonceCompletion,
    }),
    "RESERVED",
  );
  assert.equal(
    (
      await completeNative({
        completionHash: androidWrongNonceCompletion,
        claims: newClaims({
          subject: `android-nonce-${randomUUID()}`,
          domain: normalizedTestDomain("native-android-nonce"),
          webNonceHash: hash32(),
          authorizedParty: "GOOGLE_NATIVE_ANDROID_LOGIN_V1",
        }),
        accessTokenHash: hash32(),
        refreshTokenHash: hash32(),
        deviceBindingHash: hash32(),
        onboardingTokenHash: hash32(),
      })
    ).outcome,
    "DENIED",
  );

  const iosSuccess = newNativeTransaction("NATIVE_IOS_LOGIN");
  assert.equal(await beginNative(iosSuccess), "CREATED");
  const iosSuccessCompletion = hash32();
  assert.equal(
    await consumeNative({
      purpose: iosSuccess.purpose,
      networkHash: hash32(),
      handleHash: iosSuccess.handleHash,
      verifierHash: iosSuccess.challengeHash,
      completionHash: iosSuccessCompletion,
    }),
    "RESERVED",
  );
  const success = await completeNative({
    completionHash: iosSuccessCompletion,
    claims: newClaims({
      subject: `ios-success-${randomUUID()}`,
      domain: normalizedTestDomain("native-ios-success"),
      webNonceHash: null,
      authorizedParty: "GOOGLE_NATIVE_IOS_LOGIN_V1",
    }),
    accessTokenHash: hash32(),
    refreshTokenHash: hash32(),
    deviceBindingHash: hash32(),
    onboardingTokenHash: hash32(),
  });
  assert.equal(success.outcome, "ONBOARDING");

  const statuses = await migrationRows<{ status: string; count: number }>(
    `SELECT status::text, count(*)::integer AS count
     FROM uptech.oauth_transactions
     WHERE encode(locator_hash, 'hex') = ANY($1::text[])
     GROUP BY status
     ORDER BY status`,
    [[
      android.handleHash.toString("hex"),
      iosWrongAzp.handleHash.toString("hex"),
      androidWrongNonce.handleHash.toString("hex"),
      iosSuccess.handleHash.toString("hex"),
    ]],
  );
  assert.deepEqual(statuses, [
    { status: "COMPLETED", count: 1 },
    { status: "REJECTED", count: 3 },
  ]);
});

test("concurrent completion issues exactly one onboarding credential and one identity", async () => {
  const { fixture, completionHash } = await reserveWebTransaction();
  const subject = `completion-race-${randomUUID()}`;
  const claims = newClaims({
    subject,
    domain: normalizedTestDomain("completion-race"),
    webNonceHash: fixture.nonceHash,
  });
  const requestIds = Array.from({ length: 10 }, () => randomUUID());
  const onboardingHashes = Array.from({ length: 10 }, () => hash32());
  const results = await Promise.all(
    requestIds.map((requestId, index) =>
      completeWeb({
        completionHash,
        claims,
        sessionTokenHash: hash32(),
        csrfTokenHash: hash32(),
        onboardingTokenHash: onboardingHashes[index],
        requestId,
      }),
    ),
  );
  assert.equal(
    results.filter(({ outcome }) => outcome === "ONBOARDING").length,
    1,
  );
  assert.equal(
    results.filter(({ outcome }) => outcome === "DENIED").length,
    9,
  );

  const persisted = await migrationRows<{
    identity_count: number;
    onboarding_count: number;
    session_count: number;
    success_audit_count: number;
    transaction_status: string;
  }>(
    `SELECT
       (SELECT count(*)::integer
        FROM uptech.identities
        WHERE provider = 'GOOGLE'
          AND issuer = 'https://accounts.google.com'
          AND provider_subject = $1) AS identity_count,
       (SELECT count(*)::integer
        FROM uptech.onboarding_sessions AS onboarding_row
        JOIN uptech.identities AS identity_row
          ON identity_row.id = onboarding_row.identity_id
        WHERE identity_row.provider = 'GOOGLE'
          AND identity_row.issuer = 'https://accounts.google.com'
          AND identity_row.provider_subject = $1) AS onboarding_count,
       (SELECT count(*)::integer
        FROM uptech.sessions AS session_row
        JOIN uptech.identities AS identity_row
          ON identity_row.id = session_row.identity_id
        WHERE identity_row.provider = 'GOOGLE'
          AND identity_row.issuer = 'https://accounts.google.com'
          AND identity_row.provider_subject = $1) AS session_count,
       (SELECT count(*)::integer
        FROM uptech.platform_audit_events
        WHERE action = 'GOOGLE_AUTH_ONBOARDING_ISSUED'
          AND request_id = ANY($2::uuid[])) AS success_audit_count,
       (SELECT status::text
        FROM uptech.oauth_transactions
        WHERE locator_hash = $3::uptech.google_auth_hash32_v1)
          AS transaction_status`,
    [subject, requestIds, fixture.stateHash],
  );
  assert.deepEqual(persisted, [
    {
      identity_count: 1,
      onboarding_count: 1,
      session_count: 0,
      success_audit_count: 1,
      transaction_status: "COMPLETED",
    },
  ]);
});

test("one candidate hash cannot win concurrently in session and onboarding tables", async () => {
  const normalDomain = normalizedTestDomain("credential-race-normal");
  await seedWorkspace(normalDomain, "DOMAIN_AUTO_PROVISION");
  const normalReservation = await reserveWebTransaction();
  const onboardingReservation = await reserveWebTransaction();
  const sharedCandidateHash = hash32();
  const requestIds = [randomUUID(), randomUUID()];

  const [normalAttempt, onboardingAttempt] = await Promise.all([
    completeWeb({
      completionHash: normalReservation.completionHash,
      claims: newClaims({
        subject: `credential-race-normal-${randomUUID()}`,
        domain: normalDomain,
        webNonceHash: normalReservation.fixture.nonceHash,
      }),
      sessionTokenHash: sharedCandidateHash,
      csrfTokenHash: hash32(),
      onboardingTokenHash: null,
      requestId: requestIds[0],
    }),
    completeWeb({
      completionHash: onboardingReservation.completionHash,
      claims: newClaims({
        subject: `credential-race-onboarding-${randomUUID()}`,
        domain: normalizedTestDomain("credential-race-unknown"),
        webNonceHash: onboardingReservation.fixture.nonceHash,
      }),
      sessionTokenHash: hash32(),
      csrfTokenHash: hash32(),
      onboardingTokenHash: sharedCandidateHash,
      requestId: requestIds[1],
    }),
  ]);
  const outcomes = [normalAttempt.outcome, onboardingAttempt.outcome];
  assert.equal(outcomes.filter((outcome) => outcome === "DENIED").length, 1);
  assert.equal(
    outcomes.filter(
      (outcome) => outcome === "NORMAL" || outcome === "ONBOARDING",
    ).length,
    1,
  );

  const persisted = await migrationRows<{
    authority_count: number;
    completed_count: number;
    rejected_count: number;
    success_audit_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer
        FROM uptech.session_tokens
        WHERE token_hash = $1::bytea)
       +
       (SELECT count(*)::integer
        FROM uptech.onboarding_sessions
        WHERE token_hash = $1::bytea) AS authority_count,
       (SELECT count(*)::integer
        FROM uptech.oauth_transactions
        WHERE encode(locator_hash, 'hex') = ANY($2::text[])
          AND status = 'COMPLETED') AS completed_count,
       (SELECT count(*)::integer
        FROM uptech.oauth_transactions
        WHERE encode(locator_hash, 'hex') = ANY($2::text[])
          AND status = 'REJECTED') AS rejected_count,
       (SELECT count(*)::integer
        FROM uptech.platform_audit_events
        WHERE request_id = ANY($3::uuid[])
          AND action IN (
            'GOOGLE_AUTH_LOGIN_SUCCEEDED',
            'GOOGLE_AUTH_ONBOARDING_ISSUED'
          )) AS success_audit_count`,
    [
      sharedCandidateHash,
      [
        normalReservation.fixture.stateHash.toString("hex"),
        onboardingReservation.fixture.stateHash.toString("hex"),
      ],
      requestIds,
    ],
  );
  assert.deepEqual(persisted, [
    {
      authority_count: 1,
      completed_count: 1,
      rejected_count: 1,
      success_audit_count: 1,
    },
  ]);
});

test("provisioning policy, session expiry, and logout audit remain fail-closed", async () => {
  const inviteDomain = normalizedTestDomain("invite-only");
  const inviteWorkspace = await seedWorkspace(inviteDomain, "INVITE_ONLY");
  const inviteReservation = await reserveWebTransaction();
  const inviteSubject = `invite-${randomUUID()}`;
  const inviteResult = await completeWeb({
    completionHash: inviteReservation.completionHash,
    claims: newClaims({
      subject: inviteSubject,
      domain: inviteDomain,
      webNonceHash: inviteReservation.fixture.nonceHash,
    }),
    sessionTokenHash: hash32(),
    csrfTokenHash: hash32(),
    onboardingTokenHash: hash32(),
  });
  assert.deepEqual(inviteResult, {
    outcome: "ONBOARDING",
    allowed_operations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
  });
  const inviteAuthority = await migrationRows<{
    membership_count: number;
    session_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer
        FROM uptech.workspace_memberships AS membership_row
        JOIN uptech.identities AS identity_row
          ON identity_row.user_id = membership_row.user_id
        WHERE membership_row.workspace_id = $1::uuid
          AND identity_row.provider_subject = $2) AS membership_count,
       (SELECT count(*)::integer
        FROM uptech.sessions AS session_row
        JOIN uptech.identities AS identity_row
          ON identity_row.id = session_row.identity_id
        WHERE session_row.workspace_id = $1::uuid
          AND identity_row.provider_subject = $2) AS session_count`,
    [inviteWorkspace, inviteSubject],
  );
  assert.deepEqual(inviteAuthority, [{ membership_count: 0, session_count: 0 }]);

  const autoDomain = normalizedTestDomain("auto-provision");
  const autoWorkspace = await seedWorkspace(
    autoDomain,
    "DOMAIN_AUTO_PROVISION",
  );
  const autoSubject = `auto-${randomUUID()}`;

  async function issueAutoProvisionedSession(): Promise<Buffer> {
    const reservation = await reserveWebTransaction();
    const sessionTokenHash = hash32();
    const result = await completeWeb({
      completionHash: reservation.completionHash,
      claims: newClaims({
        subject: autoSubject,
        domain: autoDomain,
        webNonceHash: reservation.fixture.nonceHash,
      }),
      sessionTokenHash,
      csrfTokenHash: hash32(),
      onboardingTokenHash: null,
    });
    assert.equal(result.outcome, "NORMAL");
    return sessionTokenHash;
  }

  const expiredTokenHash = await issueAutoProvisionedSession();
  assert.notEqual(await authenticateSession(expiredTokenHash, api!), null);
  const membership = await migrationRows<{ role: string; status: string }>(
    `SELECT membership_row.role, membership_row.status
     FROM uptech.workspace_memberships AS membership_row
     JOIN uptech.identities AS identity_row
       ON identity_row.user_id = membership_row.user_id
     WHERE membership_row.workspace_id = $1::uuid
       AND identity_row.provider = 'GOOGLE'
       AND identity_row.provider_subject = $2`,
    [autoWorkspace, autoSubject],
  );
  assert.deepEqual(membership, [{ role: "MEMBER", status: "ACTIVE" }]);

  await migrationRows(
    `WITH fixed_time AS (SELECT clock_timestamp() AS observed_at)
     UPDATE uptech.session_tokens AS token_row
     SET issued_at = fixed_time.observed_at - interval '2 hours',
         expires_at = fixed_time.observed_at - interval '1 hour'
     FROM fixed_time
     WHERE token_row.token_hash = $1::bytea`,
    [expiredTokenHash],
  );
  assert.equal(await authenticateSession(expiredTokenHash, api!), null);

  const expiredSessionTokenHash = await issueAutoProvisionedSession();
  assert.notEqual(await authenticateSession(expiredSessionTokenHash, api!), null);
  await migrationRows(
    `WITH fixed_time AS (SELECT clock_timestamp() AS observed_at),
     selected_session AS (
       SELECT workspace_id, session_id
       FROM uptech.session_tokens
       WHERE token_hash = $1::bytea
     )
     UPDATE uptech.sessions AS session_row
     SET created_at = fixed_time.observed_at - interval '8 days',
         last_seen_at = fixed_time.observed_at - interval '7 days',
         idle_expires_at = fixed_time.observed_at - interval '1 hour',
         absolute_expires_at = fixed_time.observed_at - interval '30 minutes'
     FROM fixed_time, selected_session
     WHERE session_row.workspace_id = selected_session.workspace_id
       AND session_row.id = selected_session.session_id`,
    [expiredSessionTokenHash],
  );
  assert.equal(await authenticateSession(expiredSessionTokenHash, api!), null);

  const logoutTokenHash = await issueAutoProvisionedSession();
  const logoutContext = await authenticateSession(logoutTokenHash, api!);
  assert.ok(
    logoutContext !== null &&
      logoutContext.kind === "session" &&
      logoutContext.clientType === "WEB" &&
      logoutContext.csrfTokenHash !== null,
  );
  const logoutRequestId = randomUUID();
  await revokeCurrentWebSession(
    {
      rawCredential: "integration-only",
      credentialHash: logoutTokenHash,
      csrfCredential: "integration-only",
      context: logoutContext,
    } as AuthenticatedWebSession,
    logoutRequestId,
    api!,
  );
  assert.equal(await authenticateSession(logoutTokenHash, api!), null);
  const logoutActions = await migrationRows<{ action: string }>(
    `SELECT action
     FROM uptech.audit_events
     WHERE workspace_id = $1::uuid
       AND request_id = $2::uuid
     ORDER BY action`,
    [autoWorkspace, logoutRequestId],
  );
  assert.deepEqual(logoutActions, [
    { action: "AUTH_LOGOUT" },
    { action: "SESSION_REVOKED" },
  ]);

  const suspendedDomain = normalizedTestDomain("suspended-member");
  const suspendedWorkspace = await seedWorkspace(
    suspendedDomain,
    "DOMAIN_AUTO_PROVISION",
  );
  const suspendedSubject = `suspended-${randomUUID()}`;
  const suspendedUserId = randomUUID();
  const suspendedIdentityId = randomUUID();
  await withMigrationOwner(async (client) => {
    await client.query(
      `INSERT INTO uptech.users (id, status)
       VALUES ($1::uuid, 'ACTIVE')`,
      [suspendedUserId],
    );
    await client.query(
      `INSERT INTO uptech.identities
         (id, user_id, provider, issuer, provider_subject, status,
          email_claim, email_verified, hosted_domain_claim, claims_observed_at)
       VALUES ($1::uuid, $2::uuid, 'GOOGLE', 'https://accounts.google.com',
               $3, 'ACTIVE', $4, true, $5, clock_timestamp())`,
      [
        suspendedIdentityId,
        suspendedUserId,
        suspendedSubject,
        `suspended@${suspendedDomain}`,
        suspendedDomain,
      ],
    );
    await client.query(
      `INSERT INTO uptech.workspace_memberships
         (workspace_id, id, user_id, role, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'MEMBER', 'SUSPENDED')`,
      [suspendedWorkspace, randomUUID(), suspendedUserId],
    );
  });
  const suspendedReservation = await reserveWebTransaction();
  const suspendedSessionToken = hash32();
  const suspendedResult = await completeWeb({
    completionHash: suspendedReservation.completionHash,
    claims: newClaims({
      subject: suspendedSubject,
      domain: suspendedDomain,
      webNonceHash: suspendedReservation.fixture.nonceHash,
    }),
    sessionTokenHash: suspendedSessionToken,
    csrfTokenHash: hash32(),
    onboardingTokenHash: hash32(),
  });
  assert.equal(suspendedResult.outcome, "DENIED");
  const suspendedState = await migrationRows<{
    membership_status: string;
    session_count: number;
    transaction_status: string;
  }>(
    `SELECT
       (SELECT status
        FROM uptech.workspace_memberships
        WHERE workspace_id = $1::uuid AND user_id = $2::uuid)
          AS membership_status,
       (SELECT count(*)::integer
        FROM uptech.session_tokens
        WHERE token_hash = $3::bytea) AS session_count,
       (SELECT status::text
        FROM uptech.oauth_transactions
        WHERE locator_hash = $4::uptech.google_auth_hash32_v1)
          AS transaction_status`,
    [
      suspendedWorkspace,
      suspendedUserId,
      suspendedSessionToken,
      suspendedReservation.fixture.stateHash,
    ],
  );
  assert.deepEqual(suspendedState, [
    {
      membership_status: "SUSPENDED",
      session_count: 0,
      transaction_status: "REJECTED",
    },
  ]);
});

test("audit failure rolls back begin, consume, and completion atomically", async () => {
  const beginFaultRequest = randomUUID();
  const consumeFaultRequest = randomUUID();
  const completionFaultRequest = randomUUID();
  const triggerFunction = `a1_integration_fail_audit_${process.pid}`;
  const triggerName = `a1_integration_fail_audit_${process.pid}`;

  await withMigrationOwner(async (client) => {
    await client.query(`
      CREATE FUNCTION uptech.${triggerFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path TO pg_catalog, uptech
      AS $function$
      BEGIN
        IF (NEW.request_id = '${beginFaultRequest}'::uuid
            AND NEW.action = 'GOOGLE_AUTH_TRANSACTION_CREATED')
           OR (NEW.request_id = '${consumeFaultRequest}'::uuid
               AND NEW.action = 'GOOGLE_AUTH_EXCHANGE_RESERVED')
           OR (NEW.request_id = '${completionFaultRequest}'::uuid
               AND NEW.action = 'GOOGLE_AUTH_ONBOARDING_ISSUED') THEN
          RAISE EXCEPTION 'forced A1 integration audit failure';
        END IF;
        RETURN NEW;
      END
      $function$;

      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON uptech.platform_audit_events
      FOR EACH ROW EXECUTE FUNCTION uptech.${triggerFunction}();
    `);
  });

  try {
    const beginFault = newWebTransaction();
    await assert.rejects(
      beginWeb(beginFault, "WEB_LOGIN", beginFaultRequest),
      /forced A1 integration audit failure/u,
    );
    assert.deepEqual(
      await migrationRows<{ transaction_count: number; bucket_count: number }>(
        `SELECT
           (SELECT count(*)::integer
            FROM uptech.oauth_transactions
            WHERE locator_hash = $1::uptech.google_auth_hash32_v1)
             AS transaction_count,
           (SELECT count(*)::integer
            FROM uptech.google_auth_rate_limit_buckets
            WHERE network_hmac = $2::uptech.google_auth_hash32_v1)
             AS bucket_count`,
        [beginFault.stateHash, beginFault.networkHash],
      ),
      [{ transaction_count: 0, bucket_count: 0 }],
    );

    const consumeFault = newWebTransaction();
    assert.equal(await beginWeb(consumeFault), "CREATED");
    const consumeNetwork = hash32();
    await assert.rejects(
      consumeWeb({
        networkHash: consumeNetwork,
        stateHash: consumeFault.stateHash,
        browserHash: consumeFault.browserHash,
        completionHash: hash32(),
        requestId: consumeFaultRequest,
      }),
      /forced A1 integration audit failure/u,
    );
    assert.deepEqual(
      await migrationRows<{
        status: string;
        completion_handle_hash: Buffer | null;
        bucket_count: number;
      }>(
        `SELECT
           transaction_row.status::text AS status,
           transaction_row.completion_handle_hash,
           (SELECT count(*)::integer
            FROM uptech.google_auth_rate_limit_buckets
            WHERE network_hmac = $2::uptech.google_auth_hash32_v1)
             AS bucket_count
         FROM uptech.oauth_transactions AS transaction_row
         WHERE transaction_row.locator_hash =
           $1::uptech.google_auth_hash32_v1`,
        [consumeFault.stateHash, consumeNetwork],
      ),
      [{ status: "PENDING", completion_handle_hash: null, bucket_count: 0 }],
    );

    const completionFault = await reserveWebTransaction();
    const subject = `completion-fault-${randomUUID()}`;
    const onboardingHash = hash32();
    await assert.rejects(
      completeWeb({
        completionHash: completionFault.completionHash,
        claims: newClaims({
          subject,
          domain: normalizedTestDomain("completion-fault"),
          webNonceHash: completionFault.fixture.nonceHash,
        }),
        sessionTokenHash: hash32(),
        csrfTokenHash: hash32(),
        onboardingTokenHash: onboardingHash,
        requestId: completionFaultRequest,
      }),
      /forced A1 integration audit failure/u,
    );
    assert.deepEqual(
      await migrationRows<{
        transaction_status: string;
        identity_count: number;
        onboarding_count: number;
        audit_count: number;
      }>(
        `SELECT
           (SELECT status::text
            FROM uptech.oauth_transactions
            WHERE locator_hash = $1::uptech.google_auth_hash32_v1)
              AS transaction_status,
           (SELECT count(*)::integer
            FROM uptech.identities
            WHERE provider = 'GOOGLE'
              AND issuer = 'https://accounts.google.com'
              AND provider_subject = $2) AS identity_count,
           (SELECT count(*)::integer
            FROM uptech.onboarding_sessions
            WHERE token_hash = $3::bytea) AS onboarding_count,
           (SELECT count(*)::integer
            FROM uptech.platform_audit_events
            WHERE request_id = $4::uuid) AS audit_count`,
        [
          completionFault.fixture.stateHash,
          subject,
          onboardingHash,
          completionFaultRequest,
        ],
      ),
      [
        {
          transaction_status: "EXCHANGE_RESERVED",
          identity_count: 0,
          onboarding_count: 0,
          audit_count: 0,
        },
      ],
    );
  } finally {
    await withMigrationOwner(async (client) => {
      await client.query(`
        DROP TRIGGER IF EXISTS ${triggerName}
          ON uptech.platform_audit_events;
        DROP FUNCTION IF EXISTS uptech.${triggerFunction}();
      `);
    });
  }
});
