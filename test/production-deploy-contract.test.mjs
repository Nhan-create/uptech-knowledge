import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const guardPath = join(repoRoot, "scripts", "production-deploy-contract.mjs");
const generatorPath = join(repoRoot, "scripts", "generate-mobile-association-artifacts.mjs");
const browserHarnessPath = join(repoRoot, "scripts", "run-google-workspace-bootstrap-browser.mjs");
const publicRoutes = ["san-pham", "nguyen-tac", "nang-luc", "quy-trinh"];
const androidFingerprint =
  "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0:01";
const cronSecret = "directory-cron-secret-with-at-least-32-chars";
const gcpDirectoryEnvironment = {
  UPTECH_GCP_SECRET_MANAGER_PROJECT_ID: "uptech-secrets-prod",
  UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER:
    "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
  UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL:
    "directory-runtime@uptech-secrets-prod.iam.gserviceaccount.com",
};
const directoryCron = {
  path: "/api/internal/cron/google-directory",
  schedule: "* * * * *",
};

async function writeFixtureFile(root, relativePath, contents = "fixture") {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function createValidProductionFixture() {
  const root = await mkdtemp(join(tmpdir(), "uptech-production-contract-"));

  await writeFixtureFile(
    root,
    "src/components/landing/PublicNav.tsx",
    `${publicRoutes.map((route) => `{ href: "/${route}" }`).join("\n")}\nhref={item.href}\nclassName="inline-flex border-0 bg-transparent p-0 shadow-none"`,
  );
  await writeFixtureFile(root, "src/app/page.tsx", "export default function Home() {}\n");
  await writeFixtureFile(
    root,
    "src/components/auth/GoogleWorkspaceLogin.tsx",
    '<video poster="/media/login-background-poster.jpg"><source src="/media/login-background.mp4" type="video/mp4" /></video>',
  );

  for (const route of publicRoutes) {
    await writeFixtureFile(root, `src/app/${route}/page.tsx`);
  }

  await writeFixtureFile(root, "public/media/login-background.mp4", "video-bytes");
  await writeFixtureFile(root, "public/media/login-background-poster.jpg", "poster-bytes");
  await writeFixtureFile(
    root,
    "src/app/api/internal/cron/google-directory/route.ts",
    "export async function GET() { return new Response(null); }\n",
  );
  await writeFixtureFile(root, "vercel.json", JSON.stringify({
    crons: [directoryCron],
  }));
  await writeFixtureFile(root, "public/.well-known/assetlinks.json", JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "vn.uptech.uptech_knowledge_mobile",
      sha256_cert_fingerprints: [androidFingerprint],
    },
  }]));

  return root;
}

function runGuard(root, overrides = {}) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DEPLOY_CONTRACT_ROOT: root,
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_SLUG: "uptech-knowledge",
      VERCEL_GIT_COMMIT_REF: "main",
      CRON_SECRET: cronSecret,
      ...gcpDirectoryEnvironment,
      UPTECH_ANDROID_APP_LINKS_SHA256: androidFingerprint,
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
      ...overrides,
    },
  });
}

function runAssociationGenerator(root, overrides = {}) {
  return spawnSync(process.execPath, [generatorPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      UPTECH_ASSOCIATION_OUTPUT_ROOT: root,
      VERCEL_ENV: "production",
      UPTECH_ANDROID_APP_LINKS_SHA256: androidFingerprint,
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false",
      ...overrides,
    },
  });
}

test("accepts only the approved main production surface", async () => {
  const fixtureRoot = await createValidProductionFixture();
  const result = runGuard(fixtureRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("fails closed when production Git provenance is absent or not main", async () => {
  const fixtureRoot = await createValidProductionFixture();

  for (const branch of ["", "feat/dashboard-production"]) {
    const result = runGuard(fixtureRoot, { VERCEL_GIT_COMMIT_REF: branch });

    assert.notEqual(result.status, 0, branch || "missing branch");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /production source branch must be main/,
      branch || "missing branch",
    );
  }
});

test("rejects legacy fragment navigation and a missing login video", async () => {
  const fixtureRoot = await createValidProductionFixture();

  await writeFixtureFile(
    fixtureRoot,
    "src/components/landing/PublicNav.tsx",
    '{ href: "#product" }\n{ href: "#trust" }',
  );
  await writeFixtureFile(
    fixtureRoot,
    "src/components/auth/GoogleWorkspaceLogin.tsx",
    "export function GoogleWorkspaceLogin() {}\n",
  );
  await writeFixtureFile(fixtureRoot, "public/media/login-background.mp4", "");

  const result = runGuard(fixtureRoot);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /dedicated public route links are incomplete/);
  assert.match(output, /legacy fragment navigation is forbidden/);
  assert.match(output, /login background video contract is incomplete/);
});

test("keeps Git pushes detached from production-domain promotion", async () => {
  const configuration = JSON.parse(
    await readFile(join(repoRoot, "vercel.json"), "utf8"),
  );

  assert.deepEqual(configuration.git?.deploymentEnabled, { "*": false });
  assert.deepEqual(configuration.crons, [directoryCron]);
  assert.deepEqual(configuration.headers, [
    {
      source: "/.well-known/apple-app-site-association",
      headers: [{ key: "Content-Type", value: "application/json" }],
    },
    {
      source: "/apple-app-site-association",
      headers: [{ key: "Content-Type", value: "application/json" }],
    },
  ]);
});

test("requires an exact production Google Directory cron and a strong cron secret", async () => {
  for (const cronSecretOverride of ["", "too-short", "contains whitespace despite length 1234567890"]) {
    const fixtureRoot = await createValidProductionFixture();
    const result = runGuard(fixtureRoot, { CRON_SECRET: cronSecretOverride });

    assert.notEqual(result.status, 0, cronSecretOverride || "missing secret");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Directory cron secret is missing or invalid/,
    );
  }

  for (const configuration of [
    {},
    { crons: [{ ...directoryCron, schedule: "0 0 * * *" }] },
    { crons: [{ ...directoryCron, path: `${directoryCron.path}/` }] },
  ]) {
    const fixtureRoot = await createValidProductionFixture();
    await writeFixtureFile(fixtureRoot, "vercel.json", JSON.stringify(configuration));
    const result = runGuard(fixtureRoot);

    assert.notEqual(result.status, 0, JSON.stringify(configuration));
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Directory cron deployment contract is incomplete/,
    );
  }
});

test("requires exact Google Cloud Directory workload identity metadata", async () => {
  for (const overrides of [
    { UPTECH_GCP_SECRET_MANAGER_PROJECT_ID: "" },
    { UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER: "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/vercel/providers/vercel" },
    { UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL: "service-account-key.json" },
  ]) {
    const fixtureRoot = await createValidProductionFixture();
    const result = runGuard(fixtureRoot, overrides);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Google Cloud Directory workload identity metadata is missing or invalid/,
    );
  }
});

test("requires the configured uppercase Android release fingerprint", async () => {
  const fixtureRoot = await createValidProductionFixture();

  const missingConfig = runGuard(fixtureRoot, { UPTECH_ANDROID_APP_LINKS_SHA256: "" });
  assert.notEqual(missingConfig.status, 0);
  assert.match(`${missingConfig.stdout}\n${missingConfig.stderr}`, /Android release fingerprint is missing or invalid/);

  const wrongFingerprint = runGuard(fixtureRoot, {
    UPTECH_ANDROID_APP_LINKS_SHA256:
      "01:F0:EF:DE:CD:BC:AB:9A:89:78:67:56:45:34:23:12:90:8F:7E:6D:5C:4B:3A:29:18:07:F6:E5:D4:C3:B2:A1",
  });
  assert.notEqual(wrongFingerprint.status, 0);
  assert.match(`${wrongFingerprint.stdout}\n${wrongFingerprint.stderr}`, /Android assetlinks association is incomplete/);
});

test("rejects malformed or broadened Android assetlinks associations", async () => {
  const fixtureRoot = await createValidProductionFixture();

  const invalidAssociations = [
    ["public/.well-known/assetlinks.json", ""],
    ["public/.well-known/assetlinks.json", "{}"],
    ["public/.well-known/assetlinks.json", JSON.stringify([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "com.example.uptech",
        sha256_cert_fingerprints: [androidFingerprint] },
    }])],
    ["public/.well-known/assetlinks.json", JSON.stringify([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "vn.uptech.uptech_knowledge_mobile",
        sha256_cert_fingerprints: [androidFingerprint.toLowerCase()] },
    }])],
  ];

  for (const [relativePath, contents] of invalidAssociations) {
    await writeFixtureFile(fixtureRoot, relativePath, contents);
    const result = runGuard(fixtureRoot);
    assert.notEqual(result.status, 0, relativePath);
    assert.match(`${result.stdout}\n${result.stderr}`, /Android assetlinks association is incomplete/);
    const replacementRoot = await createValidProductionFixture();
    const validContents = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(replacementRoot, relativePath), "utf8"));
    await writeFixtureFile(fixtureRoot, relativePath, validContents);
  }
});

test("requires iOS association only when explicitly enabled with a configured Team ID", async () => {
  const fixtureRoot = await createValidProductionFixture();

  const androidOnly = runGuard(fixtureRoot);
  assert.equal(androidOnly.status, 0, androidOnly.stderr || androidOnly.stdout);

  const missingTeam = runGuard(fixtureRoot, { UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true" });
  assert.notEqual(missingTeam.status, 0);
  assert.match(`${missingTeam.stdout}\n${missingTeam.stderr}`, /iOS Team ID is missing or invalid/);

  await writeFixtureFile(fixtureRoot, "public/apple-app-site-association", JSON.stringify({
    applinks: {
      apps: [],
      details: [{
        appID: "UPTECH1234.vn.uptech.uptechKnowledgeMobile",
        paths: ["/auth/mobile/callback"],
      }],
    },
  }));
  const missingWellKnown = runGuard(fixtureRoot, {
    UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true",
    UPTECH_IOS_TEAM_ID: "UPTECH1234",
  });
  assert.notEqual(missingWellKnown.status, 0);
  assert.match(
    `${missingWellKnown.stdout}\n${missingWellKnown.stderr}`,
    /iOS universal links association is incomplete/,
  );
  await writeFixtureFile(
    fixtureRoot,
    "public/.well-known/apple-app-site-association",
    await readFile(join(fixtureRoot, "public/apple-app-site-association"), "utf8"),
  );
  const enabled = runGuard(fixtureRoot, {
    UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true",
    UPTECH_IOS_TEAM_ID: "UPTECH1234",
  });
  assert.equal(enabled.status, 0, enabled.stderr || enabled.stdout);
});

test("production association steps reject a missing iOS release mode", async () => {
  const fixtureRoot = await createValidProductionFixture();
  for (const result of [
    runGuard(fixtureRoot, { UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "" }),
    runAssociationGenerator(fixtureRoot, {
      UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "",
    }),
  ]) {
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /UPTECH_IOS_UNIVERSAL_LINKS_ENABLED|iOS universal links flag/u,
    );
  }
});

test("rejects a stale Apple association when iOS universal links are disabled", async () => {
  const fixtureRoot = await createValidProductionFixture();
  await writeFixtureFile(fixtureRoot, "public/.well-known/apple-app-site-association", JSON.stringify({
    applinks: {
      apps: [],
      details: [{
        appID: "UPTECH1234.vn.uptech.uptechKnowledgeMobile",
        paths: ["/auth/mobile/callback"],
      }],
    },
  }));

  const result = runGuard(fixtureRoot, { UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /iOS universal links association must be absent when disabled/);
});

test("generator removes a stale Apple association when iOS universal links are disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "uptech-association-generator-disabled-ios-"));
  const stalePath = join(root, "public/.well-known/apple-app-site-association");
  await writeFixtureFile(root, "public/.well-known/apple-app-site-association", "stale");

  const result = runAssociationGenerator(root, { UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "false" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  await assert.rejects(
    import("node:fs/promises").then(({ readFile }) => readFile(stalePath, "utf8")),
    { code: "ENOENT" },
  );
});

test("generates the exact Android association from the configured release fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "uptech-association-generator-"));
  const result = runAssociationGenerator(root);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const assetLinks = await import("node:fs/promises").then(({ readFile }) =>
    readFile(join(root, "public/.well-known/assetlinks.json"), "utf8"));
  assert.deepEqual(JSON.parse(assetLinks), [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "vn.uptech.uptech_knowledge_mobile",
      sha256_cert_fingerprints: [androidFingerprint],
    },
  }]);
});

test("generates identical root and well-known Apple association documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "uptech-association-generator-ios-"));
  const result = runAssociationGenerator(root, {
    UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true",
    UPTECH_IOS_TEAM_ID: "UPTECH1234",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [rootAssociation, wellKnownAssociation] = await Promise.all([
    readFile(join(root, "public/apple-app-site-association"), "utf8"),
    readFile(join(root, "public/.well-known/apple-app-site-association"), "utf8"),
  ]);
  assert.equal(rootAssociation, wellKnownAssociation);
  assert.deepEqual(JSON.parse(rootAssociation), {
    applinks: {
      apps: [],
      details: [{
        appID: "UPTECH1234.vn.uptech.uptechKnowledgeMobile",
        paths: ["/auth/mobile/callback"],
      }],
    },
  });
});

test("generator rejects malformed Android and iOS production configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "uptech-association-generator-invalid-"));
  const invalidConfigurations = [
    [{ UPTECH_ANDROID_APP_LINKS_SHA256: "" }, /uppercase SHA-256 fingerprint/],
    [{ UPTECH_ANDROID_APP_LINKS_SHA256: androidFingerprint.toLowerCase() }, /uppercase SHA-256 fingerprint/],
    [{ UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "enabled" }, /must be true or false/],
    [{ UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true" }, /10-character uppercase Apple Team ID/],
    [{ UPTECH_IOS_UNIVERSAL_LINKS_ENABLED: "true", UPTECH_IOS_TEAM_ID: "invalid" }, /10-character uppercase Apple Team ID/],
  ];

  for (const [overrides, expectedError] of invalidConfigurations) {
    const result = runAssociationGenerator(root, overrides);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, expectedError);
  }
});

test("the checked-out source remains buildable outside production without association files", () => {
  const result = runGuard(repoRoot, { VERCEL_ENV: "preview" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("browser harness owns a disposable Chromium and NOBYPASSRLS acceptance boundary", async () => {
  const result = spawnSync(process.execPath, [browserHarnessPath, "--contract"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, UPTECH_TEST_DATABASE_URL: "" },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    browser: "chromium-cdp-websocket",
    build: "fresh-next-production-build",
    canonicalOrigin: "https://browser-login.test:<ephemeral>",
    childEnvironment: "explicit-allowlist",
    cleanup: ["browser", "next", "proxies", "runtime-role", "child-database", "profile"],
    credentialPostComparison: "sha256+bounded-shape",
    database: "uptech_phase1_test_browser_[A-Za-z0-9_]+",
    liveTests: [
      "test/login-ui.test.mjs",
      "test/login-auth-safety.test.mjs",
      "test/login-browser-interactions.test.mjs",
    ],
    migrations: ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"],
    provisioning: "hydrated-pending-retry-support-ready-double-submit",
    runtimeArtifact: "next-start-only",
    runtime: "session_user=ephemeral,current_user=uptech_api_runtime,NOBYPASSRLS",
    timeouts: "bounded-cdp-server-cleanup",
  });
  const harnessSource = await readFile(browserHarnessPath, "utf8");
  assert.doesNotMatch(harnessSource, /UPTECH_BROWSER_DEV|\bnextMode\b|["']dev["']/u);
});

test("browser harness rejects a remote database before any acceptance work", () => {
  const result = spawnSync(process.execPath, [browserHarnessPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, UPTECH_TEST_DATABASE_URL: "postgresql://test-user:test-password@db.example/uptech_phase1_test_remote" },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /refusing a non-loopback test database/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-password/);
});
