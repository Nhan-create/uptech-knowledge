import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseConfigurationError } from "./core.ts";
import { runtimePoolConfig } from "./runtime-pool.ts";

test("runtime PostgreSQL connections pin the exact API capability role", () => {
  const url = "postgresql://deployment_login@unknown.example/uptech";
  const config = runtimePoolConfig(url);

  assert.equal(config.connectionString, url);
  assert.equal(config.options, "-c role=uptech_api_runtime");
  assert.equal(config.max, 5);
  assert.equal(config.allowExitOnIdle, true);
  assert.equal(Object.isFrozen(config), true);
});

test("runtime PostgreSQL configuration rejects incomplete connection targets", () => {
  for (const url of [
    "",
    "not-a-url",
    "https://unknown.example/uptech",
    "postgresql:///uptech",
    "postgresql://unknown.example",
  ]) {
    assert.throws(() => runtimePoolConfig(url), DatabaseConfigurationError);
  }
});
