import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const registryPath = `${repoRoot}db/deploy/mobile_google_auth_runtime_registry.sql`;

test("Android-only mobile registry deployment defaults iOS off and seeds it only when explicitly enabled", async () => {
  const source = await readFile(registryPath, "utf8");

  assert.match(source, /\\set runtime_ios_enabled false/);
  assert.doesNotMatch(source, /\\echo 'runtime_ios_bundle_id is required'/);
  assert.doesNotMatch(source, /\\echo 'runtime_ios_team_id is required'/);
  assert.match(source, /ios_enabled boolean/);
  assert.match(source, /NULLIF\(\$7::text,''\)::boolean/);
  assert.match(source, /WHERE x\.ios_enabled/);
  assert.match(source, /THEN 2 ELSE 1 END/);
  assert.match(source, /enabled iOS mobile registry exists while iOS is disabled/);
});
