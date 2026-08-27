import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const guardPath = join(repoRoot, "scripts", "production-deploy-contract.mjs");
const publicRoutes = ["san-pham", "nguyen-tac", "nang-luc", "quy-trinh"];

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

test("the checked-out main source satisfies the production contract", () => {
  const result = runGuard(repoRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
