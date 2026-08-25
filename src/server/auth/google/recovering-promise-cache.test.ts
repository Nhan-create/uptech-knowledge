import assert from "node:assert/strict";
import test from "node:test";

import { createRecoveringPromiseCache } from "./recovering-promise-cache.ts";

test("a transient rejection is evicted and the same key recovers", async () => {
  const cache = createRecoveringPromiseCache<string>();
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("temporary network failure");
    return "recovered";
  };

  await assert.rejects(cache.get("google-config", load), TypeError);
  assert.equal(await cache.get("google-config", load), "recovered");
  assert.equal(await cache.get("google-config", load), "recovered");
  assert.equal(attempts, 2);
});

test("concurrent loads are single-flight and an old rejection cannot evict a new key", async () => {
  const cache = createRecoveringPromiseCache<string>();
  let rejectOld!: (error: Error) => void;
  const old = cache.get(
    "old",
    () =>
      new Promise<string>((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  const current = cache.get("current", async () => "current-value");
  await Promise.resolve();
  rejectOld(new Error("old failed"));

  await assert.rejects(old, /old failed/u);
  assert.equal(await current, "current-value");
  assert.equal(
    await cache.get("current", async () => "must-not-reload"),
    "current-value",
  );
});
