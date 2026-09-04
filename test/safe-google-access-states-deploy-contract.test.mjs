import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = await readFile(
  new URL("../scripts/apply-safe-google-access-states.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const deployScriptUrl = new URL(
  "../scripts/apply-safe-google-access-states.mjs",
  import.meta.url,
);
const deployScriptPath = fileURLToPath(deployScriptUrl);

test("production release requires an explicit one-shot flag before prebuild migration", () => {
  assert.equal(
    packageJson.scripts["migrate:login:production"],
    "node scripts/apply-safe-google-access-states.mjs",
  );
  assert.match(
    packageJson.scripts.prebuild,
    /^node scripts\/apply-safe-google-access-states\.mjs &&/u,
  );
  assert.match(script, /UPTECH_APPLY_LOGIN_MIGRATION/u);
  assert.match(script, /VERCEL_ENV === "production"/u);
  assert.match(script, /VERCEL_GIT_COMMIT_REF !== "main"/u);
  assert.match(script, /VERCEL_GIT_PROVIDER !== "github"/u);
  assert.match(script, /0008_google_directory_production\.sql/u);
  assert.match(script, /0009_google_workspace_tenant_bootstrap\.sql/u);
  assert.match(script, /verify\/enterprise_login\.sql/u);
  assert.match(script, /verify\/google_workspace_tenant_bootstrap\.sql/u);
  assert.match(script, /complete_google_workspace_bootstrap_v1/u);
  assert.match(script, /complete_web_google_login_directory_v2/u);
  assert.match(script, /complete_mobile_google_callback_directory_v2/u);
  assert.match(script, /google_workspace_bootstrap_receipts/u);
  assert.match(script, /google_workspace_bootstrap_receipts_committed_attempt/u);
  assert.match(script, /complete_web_google_login_directory_v1/u);
  assert.match(script, /pg_try_advisory_lock/u);
  assert.match(script, /UPTECH_ANDROID_APP_LINKS_SHA256/u);
  assert.match(script, /UPTECH_IOS_UNIVERSAL_LINKS_ENABLED/u);
  assert.match(script, /UPTECH_IOS_TEAM_ID/u);
  assert.match(script, /GOOGLE_MOBILE_CLIENT_ID/u);
  assert.match(script, /GOOGLE_CLIENT_ID/u);
  assert.match(script, /GOOGLE_MOBILE_ANDROID_V1/u);
  assert.match(script, /GOOGLE_MOBILE_IOS_V1/u);
  assert.match(script, /mobile_google_configuration_registry/u);
  assert.match(script, /mobile_handoff_exchange_result_v2/u);
  assert.match(script, /complete_mobile_google_denial_v1/u);
  assert.match(script, /exchange_mobile_handoff_v2/u);
  assert.match(script, /vn\.uptech\.uptech_knowledge_mobile/u);
  assert.match(script, /vn\.uptech\.uptechKnowledgeMobile/u);
  assert.doesNotMatch(script, /GOOGLE_WORKSPACE_DOMAIN/u);
  assert.doesNotMatch(script, /process\.env\.DATABASE_URL/u);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*(?:connectionString|migrationSource|verificationSource)/u);
});

test("bootstrap migration has a dedicated disposable PostgreSQL gate", () => {
  assert.equal(
    packageJson.scripts["test:postgres:bootstrap"],
    "node --experimental-strip-types --test test/integration/google-workspace-bootstrap-postgres.test.ts test/integration/bootstrap-migration-runner-postgres.test.ts",
  );
});

test("ordinary production app builds skip migration without privileged database configuration", () => {
  const result = spawnSync(process.execPath, [deployScriptPath], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /migration skipped without the explicit one-shot release flag/u);
  assert.doesNotMatch(output, /database URL|ENOTFOUND|ECONNREFUSED/u);
});

test("production prebuild rejects environment identifiers that runtime auth rejects", () => {
  const baseEnvironment = {
    ...process.env,
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
    UPTECH_APPLY_LOGIN_MIGRATION: "true",
    UPTECH_MIGRATION_DATABASE_URL_UNPOOLED: "postgres://migration@unknown.example/uptech",
    UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
    GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_ANDROID_APP_LINKS_SHA256: Array(32).fill("AA").join(":"),
  };

  for (const environmentId of [
    `p${"a".repeat(64)}`,
    ".production",
    "production.blue",
    "production:blue",
  ]) {
    const result = spawnSync(process.execPath, [deployScriptPath], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        UPTECH_ENVIRONMENT_ID: environmentId,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /registry environment is unavailable/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOTFOUND|ECONNREFUSED/u);
  }
});

test("production prebuild refuses an ambiguous pooled migration URL", () => {
  const result = spawnSync(process.execPath, [deployScriptPath], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
      UPTECH_APPLY_LOGIN_MIGRATION: "true",
      UPTECH_MIGRATION_DATABASE_URL: "postgres://migration@unknown.example/uptech",
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
      UPTECH_ENVIRONMENT_ID: "production",
      GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
      UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
      UPTECH_ANDROID_APP_LINKS_SHA256: Array(32).fill("AA").join(":"),
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /database URL is unavailable/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOTFOUND|ECONNREFUSED/u);
});

test("production migration rejects conflicting approved direct database targets", () => {
  const result = spawnSync(process.execPath, [deployScriptPath], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
      UPTECH_APPLY_LOGIN_MIGRATION: "true",
      UPTECH_MIGRATION_DATABASE_URL_UNPOOLED:
        "postgres://migration@tenant-a.example/uptech",
      UPTECH_MIGRATION_POSTGRES_URL_NON_POOLING:
        "postgres://migration@tenant-b.example/uptech",
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /direct database targets conflict/u);
  assert.doesNotMatch(output, /tenant-a|tenant-b|ENOTFOUND|ECONNREFUSED/u);
});

test("equivalent approved direct database targets pass conflict validation", () => {
  const result = spawnSync(process.execPath, [deployScriptPath], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
      UPTECH_APPLY_LOGIN_MIGRATION: "true",
      UPTECH_MIGRATION_DATABASE_URL_UNPOOLED:
        "postgres://migration@unknown.example/uptech?sslmode=require&connect_timeout=10",
      UPTECH_MIGRATION_POSTGRES_URL_NON_POOLING:
        "postgresql://migration@unknown.example:5432/uptech?connect_timeout=10&sslmode=require",
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(output, /direct database targets conflict/u);
  assert.match(output, /registry environment is unavailable/u);
  assert.doesNotMatch(output, /ENOTFOUND|ECONNREFUSED/u);
});

test("production migration rejects a partial mobile OAuth override before database access", () => {
  const baseEnvironment = {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
    UPTECH_APPLY_LOGIN_MIGRATION: "true",
    UPTECH_MIGRATION_DATABASE_URL_UNPOOLED: "postgres://migration@unknown.example/uptech",
    UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
    UPTECH_ENVIRONMENT_ID: "production",
    GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shared-server-only-secret",
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_ANDROID_APP_LINKS_SHA256: Array(32).fill("AA").join(":"),
  };

  for (const partialOverride of [
    { GOOGLE_MOBILE_CLIENT_ID: "mobile-web.apps.googleusercontent.com" },
    { GOOGLE_MOBILE_CLIENT_SECRET: "mobile-server-only-secret" },
  ]) {
    const result = spawnSync(process.execPath, [deployScriptPath], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...baseEnvironment, ...partialOverride },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(output, /mobile OAuth override is incomplete/u);
    assert.doesNotMatch(output, /ENOTFOUND|ECONNREFUSED/u);
  }
});
