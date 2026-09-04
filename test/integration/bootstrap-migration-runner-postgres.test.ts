import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

const disposablePrefix = "uptech_phase1_test";

function disposableDatabaseUrl(): URL {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (!value) throw new Error("UPTECH_TEST_DATABASE_URL is required");
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("migration runner integration requires loopback PostgreSQL");
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database.startsWith(disposablePrefix)) {
    throw new Error("migration runner integration requires a disposable database");
  }
  return parsed;
}

function executableSql(source: string): string {
  return source.split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

test("production runner applies 0009 once and verifies the same database on rerun", async () => {
  const sourceUrl = disposableDatabaseUrl();
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const childDatabase = `${disposablePrefix}_runner_${randomUUID().replaceAll("-", "")}`;
  const migrationLogin = `uptech_runner_${randomUUID().replaceAll("-", "")}`;
  const migrationPassword = randomBytes(32).toString("base64url");
  assert.match(childDatabase, /^uptech_phase1_test_runner_[a-f0-9]{32}$/u);
  assert.match(migrationLogin, /^uptech_runner_[a-f0-9]{32}$/u);
  assert.match(migrationPassword, /^[A-Za-z0-9_-]{43}$/u);
  const childUrl = new URL(sourceUrl);
  childUrl.pathname = `/${childDatabase}`;
  childUrl.username = migrationLogin;
  childUrl.password = migrationPassword;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  let child: pg.Client | undefined;
  let databaseCreated = false;
  let loginCreated = false;

  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${migrationLogin} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${migrationPassword}' IN ROLE uptech_migration_owner`);
    loginCreated = true;
    await admin.query(`CREATE DATABASE ${childDatabase} OWNER uptech_migration_owner`);
    databaseCreated = true;
    child = new pg.Client({ connectionString: childUrl.href });
    await child.connect();
    await child.query("SET ROLE uptech_migration_owner; CREATE SCHEMA uptech AUTHORIZATION uptech_migration_owner; GRANT USAGE ON SCHEMA uptech TO uptech_api_runtime, uptech_worker_runtime; RESET ROLE");

    const migrationNames = [
      "0001_phase1_foundation.sql",
      "0002_google_auth_a1.sql",
      "0003_initial_owner_bootstrap_a2.sql",
      "0004_mobile_public_client_auth_a3.sql",
      "0005_mobile_session_direct_access_boundary_a3.sql",
      "0006_safe_google_access_states_a4.sql",
      "0007_enterprise_login.sql",
      "0008_google_directory_production.sql",
    ];
    for (const name of migrationNames) {
      const source = await readFile(`db/migrations/${name}`, "utf8");
      await child.query(executableSql(source));
    }
    await child.query(`SET ROLE uptech_migration_owner;
      INSERT INTO uptech.google_auth_environment_registry(
        environment_name, rate_limit_audit_hmac_key, is_active
      ) VALUES ('runner-test', decode(repeat('A5', 32), 'hex'), true);
      RESET ROLE`);

    const runnerEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
      UPTECH_APPLY_LOGIN_MIGRATION: "true",
      UPTECH_MIGRATION_DATABASE_URL_UNPOOLED: childUrl.href,
      UPTECH_ENVIRONMENT_ID: "runner-test",
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
      GOOGLE_CLIENT_ID: "runner-test.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "runner-test-only",
      UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "runner-test-kms-v1",
      UPTECH_ANDROID_APP_LINKS_SHA256: Array(32).fill("A5").join(":"),
    };
    delete runnerEnvironment.DATABASE_URL;
    delete runnerEnvironment.UPTECH_MIGRATION_POSTGRES_URL_NON_POOLING;

    for (let run = 0; run < 2; run += 1) {
      const caller: {
        exact_login: boolean;
        restricted: boolean;
        migration_member: boolean;
      } = (await child.query(`SELECT
        current_user = $1 AS exact_login,
        NOT rolcreatedb AND NOT rolcreaterole AND NOT rolsuper
          AND NOT rolreplication AND NOT rolbypassrls AS restricted,
        pg_has_role(current_user, 'uptech_migration_owner', 'MEMBER') AS migration_member
        FROM pg_roles WHERE rolname = current_user`, [migrationLogin])).rows[0];
      assert.deepEqual(caller, {
        exact_login: true,
        restricted: true,
        migration_member: true,
      });
      const result = spawnSync(process.execPath, ["scripts/apply-safe-google-access-states.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: runnerEnvironment,
        timeout: 120_000,
      });
      assert.equal(result.status, 0, "runner must succeed without exposing database diagnostics");
      assert.equal(result.stdout.trim(), "Multi-tenant login database migration and mobile registry: PASS");
      assert.equal(result.stderr.trim(), "");
    }

    const a4Source = executableSql(
      await readFile("db/verify/safe_google_access_states_a4.sql", "utf8"),
    );
    await child.query("SET ROLE uptech_migration_owner; GRANT SELECT ON uptech.mobile_handoffs TO uptech_api_runtime; RESET ROLE");
    try {
      await assert.rejects(
        child.query(a4Source),
        /A4 runtime role has direct pre-tenant authority-table access/u,
      );
    } finally {
      await child.query("ROLLBACK");
      await child.query("SET ROLE uptech_migration_owner; REVOKE SELECT ON uptech.mobile_handoffs FROM uptech_api_runtime; RESET ROLE");
    }
    await child.query(a4Source);

    const verified = (await child.query(`SELECT
      to_regprocedure('uptech.complete_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,text,text,text,text,uptech.google_workspace_verified_domain_v1[],text,text[],uuid)') IS NOT NULL AS bootstrap,
      to_regprocedure('uptech.complete_web_google_login_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)') IS NOT NULL AS web_v2,
      to_regprocedure('uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)') IS NOT NULL AS mobile_v2,
      (SELECT count(*)::int FROM uptech.mobile_google_configuration_registry WHERE environment_name = 'runner-test') AS mobile_rows,
      NOT bool_or(rolbypassrls) FILTER (WHERE rolname IN ('uptech_api_runtime', 'uptech_worker_runtime')) AS runtime_nobypassrls
      FROM pg_roles`)).rows[0];
    assert.deepEqual(verified, {
      bootstrap: true,
      web_v2: true,
      mobile_v2: true,
      mobile_rows: 1,
      runtime_nobypassrls: true,
    });
  } finally {
    await child?.end().catch(() => undefined);
    if (databaseCreated) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [childDatabase]);
      await admin.query(`DROP DATABASE ${childDatabase}`);
    }
    if (loginCreated) await admin.query(`DROP ROLE ${migrationLogin}`);
    const residue = (await admin.query(`SELECT
      EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS database_exists,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS login_exists`,
    [childDatabase, migrationLogin])).rows[0];
    assert.deepEqual(residue, { database_exists: false, login_exists: false });
    await admin.end();
  }
});
