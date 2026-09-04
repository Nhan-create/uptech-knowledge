import { readFile } from "node:fs/promises";
import process from "node:process";

import pg from "pg";

const production = process.env.VERCEL_ENV === "production";
if (!production) {
  console.log("Multi-tenant login database migration skipped outside Vercel production.");
  process.exit(0);
}

const migrationMode = process.env.UPTECH_APPLY_LOGIN_MIGRATION?.trim();
if (!migrationMode || migrationMode === "false") {
  console.log(
    "Multi-tenant login migration skipped without the explicit one-shot release flag.",
  );
  process.exit(0);
}
if (migrationMode !== "true") {
  throw new Error("Multi-tenant login one-shot release flag is invalid");
}

if (
  process.env.VERCEL_GIT_COMMIT_REF !== "main" ||
  process.env.VERCEL_GIT_PROVIDER !== "github" ||
  process.env.VERCEL_GIT_REPO_SLUG !== "uptech-knowledge"
) {
  throw new Error("Multi-tenant login migration requires github/uptech-knowledge@main");
}

const configuredConnections = [
  process.env.UPTECH_MIGRATION_DATABASE_URL_UNPOOLED,
  process.env.UPTECH_MIGRATION_POSTGRES_URL_NON_POOLING,
].map((candidate) => candidate?.trim() ?? "").filter(Boolean);

if (configuredConnections.length === 0) {
  throw new Error("Production migration database URL is unavailable");
}

function canonicalDirectDatabaseTarget(candidate) {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Production migration database URL is invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Production migration database URL is invalid");
  }
  parsed.protocol = "postgresql:";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port === "") parsed.port = "5432";
  parsed.hash = "";
  parsed.searchParams.sort();
  return parsed.href;
}

const canonicalConnections = configuredConnections.map(
  canonicalDirectDatabaseTarget,
);
if (new Set(canonicalConnections).size !== 1) {
  throw new Error("Production migration direct database targets conflict");
}
const connectionString = configuredConnections[0];

const androidFingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u;
const iosTeamIdPattern = /^[A-Z0-9]{10}$/u;

function requiredText(name, value, pattern = /^[\x21-\x7e]{1,512}$/u) {
  const result = value?.trim() ?? "";
  if (!pattern.test(result)) {
    throw new Error(`Production mobile registry ${name} is unavailable`);
  }
  return result;
}

function enabledIos() {
  const value = process.env.UPTECH_IOS_UNIVERSAL_LINKS_ENABLED?.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Production iOS universal-link configuration is invalid");
}

function mobileOAuthClientId() {
  const mobileClientId = process.env.GOOGLE_MOBILE_CLIENT_ID?.trim();
  const mobileClientSecret = process.env.GOOGLE_MOBILE_CLIENT_SECRET?.trim();
  if (Boolean(mobileClientId) !== Boolean(mobileClientSecret)) {
    throw new Error("Production mobile OAuth override is incomplete");
  }
  if (mobileClientId && mobileClientSecret) {
    requiredText("Google mobile client secret", mobileClientSecret);
    return requiredText("Google mobile client", mobileClientId);
  }
  requiredText("Google shared client secret", process.env.GOOGLE_CLIENT_SECRET);
  return requiredText("Google shared client", process.env.GOOGLE_CLIENT_ID);
}

const iosEnabled = enabledIos();
const mobileRegistry = Object.freeze({
  environmentId: requiredText(
    "environment",
    process.env.UPTECH_ENVIRONMENT_ID,
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u,
  ),
  clientId: mobileOAuthClientId(),
  pkceKeyVersion: requiredText(
    "PKCE key version",
    process.env.UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION,
    /^[\x21-\x7e]{1,128}$/u,
  ),
  androidApplicationId: "vn.uptech.uptech_knowledge_mobile",
  androidFingerprint: requiredText(
    "Android release fingerprint",
    process.env.UPTECH_ANDROID_APP_LINKS_SHA256,
    androidFingerprintPattern,
  ),
  iosEnabled,
  iosBundleId: "vn.uptech.uptechKnowledgeMobile",
  iosTeamId: iosEnabled
    ? requiredText(
        "iOS Team ID",
        process.env.UPTECH_IOS_TEAM_ID,
        iosTeamIdPattern,
      )
    : null,
});

const mobileCallbackUri =
  "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback";
const mobileAppReturnUri =
  "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback";

function exactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function exactMobileRegistryRow(row, platform) {
  const expectedConfiguration = platform === "ANDROID"
    ? "GOOGLE_MOBILE_ANDROID_V1"
    : "GOOGLE_MOBILE_IOS_V1";
  return row?.environment_name === mobileRegistry.environmentId &&
    row?.platform === platform &&
    row?.configuration_key === expectedConfiguration &&
    row?.google_client_id === mobileRegistry.clientId &&
    row?.google_audience === mobileRegistry.clientId &&
    row?.callback_uri === mobileCallbackUri &&
    row?.app_return_uri === mobileAppReturnUri &&
    exactArray(row?.scopes, ["openid", "email", "profile"]) &&
    exactArray(row?.allowed_azp_configuration_keys, ["GOOGLE_WEB_LOGIN_V1"]) &&
    row?.pkce_kms_key_version === mobileRegistry.pkceKeyVersion &&
    row?.is_enabled === true &&
    (platform === "ANDROID"
      ? row?.android_application_id === mobileRegistry.androidApplicationId &&
        row?.android_release_cert_sha256 === mobileRegistry.androidFingerprint &&
        row?.ios_bundle_id === null && row?.ios_team_id === null
      : row?.android_application_id === null &&
        row?.android_release_cert_sha256 === null &&
        row?.ios_bundle_id === mobileRegistry.iosBundleId &&
        row?.ios_team_id === mobileRegistry.iosTeamId);
}

async function reconcileMobileRegistry(client) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    const environment = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM uptech.google_auth_environment_registry
        WHERE environment_name = $1
          AND is_active
      ) AS active
    `, [mobileRegistry.environmentId]);
    if (environment.rows[0]?.active !== true) {
      throw new Error("Production mobile registry environment is not active");
    }

    const existing = await client.query(`
      SELECT environment_name::text, platform::text, configuration_key::text,
             google_client_id::text, google_audience::text,
             callback_uri::text, app_return_uri::text, scopes,
             allowed_azp_configuration_keys::text[],
             pkce_kms_key_version::text,
             android_application_id::text,
             android_release_cert_sha256::text,
             ios_bundle_id::text, ios_team_id::text, is_enabled
      FROM uptech.mobile_google_configuration_registry
      WHERE environment_name = $1
      ORDER BY platform
    `, [mobileRegistry.environmentId]);
    for (const row of existing.rows) {
      if (
        (row.platform !== "ANDROID" && row.platform !== "IOS") ||
        !exactMobileRegistryRow(row, row.platform) ||
        (row.platform === "IOS" && !mobileRegistry.iosEnabled)
      ) {
        throw new Error("Production mobile Google registry conflicts with deployment input");
      }
    }

    await client.query(`
      INSERT INTO uptech.mobile_google_configuration_registry(
        environment_name, platform, configuration_key, google_client_id,
        google_audience, callback_uri, app_return_uri, scopes,
        allowed_azp_configuration_keys, pkce_kms_key_version,
        android_application_id, android_release_cert_sha256, is_enabled
      ) VALUES (
        $1, 'ANDROID', 'GOOGLE_MOBILE_ANDROID_V1', $2, $2, $3, $4,
        ARRAY['openid','email','profile']::text[],
        ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
        $5, $6, $7, true
      )
      ON CONFLICT (environment_name, platform) DO NOTHING
    `, [
      mobileRegistry.environmentId,
      mobileRegistry.clientId,
      mobileCallbackUri,
      mobileAppReturnUri,
      mobileRegistry.pkceKeyVersion,
      mobileRegistry.androidApplicationId,
      mobileRegistry.androidFingerprint,
    ]);

    if (mobileRegistry.iosEnabled) {
      await client.query(`
        INSERT INTO uptech.mobile_google_configuration_registry(
          environment_name, platform, configuration_key, google_client_id,
          google_audience, callback_uri, app_return_uri, scopes,
          allowed_azp_configuration_keys, pkce_kms_key_version,
          ios_bundle_id, ios_team_id, is_enabled
        ) VALUES (
          $1, 'IOS', 'GOOGLE_MOBILE_IOS_V1', $2, $2, $3, $4,
          ARRAY['openid','email','profile']::text[],
          ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
          $5, $6, $7, true
        )
        ON CONFLICT (environment_name, platform) DO NOTHING
      `, [
        mobileRegistry.environmentId,
        mobileRegistry.clientId,
        mobileCallbackUri,
        mobileAppReturnUri,
        mobileRegistry.pkceKeyVersion,
        mobileRegistry.iosBundleId,
        mobileRegistry.iosTeamId,
      ]);
    }

    const verified = await client.query(`
      SELECT environment_name::text, platform::text, configuration_key::text,
             google_client_id::text, google_audience::text,
             callback_uri::text, app_return_uri::text, scopes,
             allowed_azp_configuration_keys::text[],
             pkce_kms_key_version::text,
             android_application_id::text,
             android_release_cert_sha256::text,
             ios_bundle_id::text, ios_team_id::text, is_enabled
      FROM uptech.mobile_google_configuration_registry
      WHERE environment_name = $1
      ORDER BY platform
    `, [mobileRegistry.environmentId]);
    const expectedPlatforms = mobileRegistry.iosEnabled
      ? ["ANDROID", "IOS"]
      : ["ANDROID"];
    if (
      verified.rows.length !== expectedPlatforms.length ||
      !verified.rows.every((row, index) =>
        row.platform === expectedPlatforms[index] &&
        exactMobileRegistryRow(row, expectedPlatforms[index]))
    ) {
      throw new Error("Production mobile Google registry verification failed");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function executableSql(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

const [
  enterpriseLoginBaselineMigrationSource,
  googleDirectoryMigrationSource,
  googleWorkspaceBootstrapMigrationSource,
  enterpriseLoginVerificationSource,
  googleWorkspaceBootstrapVerificationSource,
] = await Promise.all([
  readFile("db/migrations/0007_enterprise_login.sql", "utf8"),
  readFile("db/migrations/0008_google_directory_production.sql", "utf8"),
  readFile("db/migrations/0009_google_workspace_tenant_bootstrap.sql", "utf8"),
  readFile("db/verify/enterprise_login.sql", "utf8"),
  readFile("db/verify/google_workspace_tenant_bootstrap.sql", "utf8"),
]);

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  application_name: "uptech_multi_tenant_login_release_v1",
});

try {
  await client.connect();
  await client.query(`
    SET statement_timeout = '45s';
    SET lock_timeout = '8s';
    SET idle_in_transaction_session_timeout = '60s';
  `);

  const releaseLock = await client.query(`
    SELECT pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended('uptech_multi_tenant_login_release_v1', 0)
    ) AS acquired
  `);
  if (releaseLock.rows[0]?.acquired !== true) {
    throw new Error("Multi-tenant login database release lock is unavailable");
  }

  const preflight = await client.query(`
    SELECT
      pg_catalog.pg_has_role(
        current_user, 'uptech_migration_owner', 'MEMBER'
      ) AS migration_member,
      pg_catalog.to_regprocedure(
        'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS web_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS mobile_boundary_present,
      pg_catalog.to_regclass(
        'uptech.people_sync_generations'
      ) IS NOT NULL AS enterprise_login_baseline_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_web_google_login_directory_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS directory_upgrade_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,text,text,text,text,uptech.google_workspace_verified_domain_v1[],text,text[],uuid)'
      ) IS NOT NULL AS workspace_bootstrap_present,
      NOT EXISTS (
        SELECT 1
        FROM uptech.identities AS legacy_identity
        JOIN uptech.identities AS canonical_identity
          ON canonical_identity.provider = legacy_identity.provider
         AND canonical_identity.provider_subject = legacy_identity.provider_subject
         AND canonical_identity.issuer = 'https://accounts.google.com'
         AND canonical_identity.id <> legacy_identity.id
        WHERE legacy_identity.provider = 'GOOGLE'
          AND legacy_identity.issuer = 'accounts.google.com'
      ) AS issuer_reconciliation_safe
  `);
  const state = preflight.rows[0];
  const failedPreflightChecks = [
    ["migration_member", state?.migration_member],
    ["web_boundary_present", state?.web_boundary_present],
    ["mobile_boundary_present", state?.mobile_boundary_present],
    ["issuer_reconciliation_safe", state?.issuer_reconciliation_safe],
  ].filter(([, passed]) => passed !== true).map(([name]) => name);
  if (failedPreflightChecks.length > 0) {
    throw new Error(
      `Multi-tenant login database preflight failed: ${failedPreflightChecks.join(", ")}`,
    );
  }

  if (state.enterprise_login_baseline_present !== true) {
    await client.query(executableSql(enterpriseLoginBaselineMigrationSource));
  }
  if (state.directory_upgrade_present !== true) {
    await client.query(executableSql(googleDirectoryMigrationSource));
  }
  if (state.workspace_bootstrap_present !== true) {
    await client.query(executableSql(googleWorkspaceBootstrapMigrationSource));
  }
  await client.query(`
    BEGIN;
    SET LOCAL ROLE uptech_migration_owner;
    REVOKE ALL ON FUNCTION uptech.exchange_mobile_handoff_v1(
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uuid
    ) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
    COMMIT;
  `);
  await client.query(executableSql(enterpriseLoginVerificationSource));
  await client.query(executableSql(googleWorkspaceBootstrapVerificationSource));
  await reconcileMobileRegistry(client);

  const verified = await client.query(`
    SELECT
      pg_catalog.to_regtype(
        'uptech.google_login_completion_result_v2'
      ) IS NOT NULL AS result_type_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS web_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_web_google_login_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS directory_web_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS mobile_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS directory_mobile_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,text,text,text,text,uptech.google_workspace_verified_domain_v1[],text,text[],uuid)'
      ) IS NOT NULL AS workspace_bootstrap_boundary_present,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'uptech'
          AND relation.relname = 'google_workspace_bootstrap_receipts'
          AND relation.relkind = 'r'
      ) AS workspace_bootstrap_receipts_present,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger
        JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'uptech'
          AND relation.relname = 'google_workspace_bootstrap_receipts'
          AND trigger.tgname = 'google_workspace_bootstrap_receipts_committed_attempt'
          AND NOT trigger.tgisinternal
          AND trigger.tgconstraint <> 0
          AND trigger.tgenabled = 'O'
          AND trigger.tgtype = 5
          AND trigger.tgdeferrable
          AND trigger.tginitdeferred
          AND trigger.tgfoid = 'uptech.enforce_google_workspace_bootstrap_receipt_v1()'::regprocedure
      ) AS workspace_bootstrap_trigger_present,
      pg_catalog.to_regtype(
        'uptech.mobile_handoff_exchange_result_v2'
      ) IS NOT NULL AS mobile_exchange_result_present,
      pg_catalog.to_regprocedure(
        'uptech.complete_mobile_google_denial_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uptech.mobile_auth_ui_category_v1,uuid)'
      ) IS NOT NULL AS mobile_denial_boundary_present,
      pg_catalog.to_regprocedure(
        'uptech.exchange_mobile_handoff_v2(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
      ) IS NOT NULL AS mobile_exchange_boundary_present,
      NOT EXISTS (
        SELECT 1 FROM uptech.identities
        WHERE provider = 'GOOGLE' AND issuer = 'accounts.google.com'
      ) AS issuers_canonical
  `);
  const result = verified.rows[0];
  if (
    result?.result_type_present !== true ||
    result?.web_boundary_present !== true ||
    result?.directory_web_boundary_present !== true ||
    result?.mobile_boundary_present !== true ||
    result?.directory_mobile_boundary_present !== true ||
    result?.workspace_bootstrap_boundary_present !== true ||
    result?.workspace_bootstrap_receipts_present !== true ||
    result?.workspace_bootstrap_trigger_present !== true ||
    result?.mobile_exchange_result_present !== true ||
    result?.mobile_denial_boundary_present !== true ||
    result?.mobile_exchange_boundary_present !== true ||
    result?.issuers_canonical !== true
  ) {
    throw new Error("Multi-tenant login database verification failed");
  }

  console.log("Multi-tenant login database migration and mobile registry: PASS");
} catch {
  console.error("Multi-tenant login database migration and mobile registry: FAILED");
  process.exitCode = 1;
} finally {
  let closeTimer;
  await Promise.race([
    client.end().catch(() => undefined),
    new Promise((resolve) => {
      closeTimer = setTimeout(resolve, 5_000);
    }),
  ]);
  clearTimeout(closeTimer);
  if (client.connection?.stream && !client.connection.stream.destroyed) {
    client.connection.stream.destroy();
  }
}
