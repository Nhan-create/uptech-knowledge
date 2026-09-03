import assert from "node:assert/strict";
import test from "node:test";

import * as googleDirectoryCronRoute from "../src/app/api/internal/cron/google-directory/route.ts";
import {
  createGoogleDirectoryCronGet,
  dynamic,
  maxDuration,
  runtime,
  type GoogleDirectoryCronDependencies,
} from "../src/app/api/internal/cron/google-directory/route.ts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const CRON_SECRET = "directory-cron-secret-with-at-least-32-chars";

test("cron exports only the approved GET method and Vercel runtime contract", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(dynamic, "force-dynamic");
  assert.equal(maxDuration, 240);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(Object.hasOwn(googleDirectoryCronRoute, method), false, method);
  }
});

function request(authorization?: string): Request {
  return new Request("https://knowledge.uptech.vn/api/internal/cron/google-directory", {
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
      "x-uptech-request-id": REQUEST_ID,
    },
  });
}

function dependencies(input?: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly runNext?: (...arguments_: never[]) => Promise<{ readonly kind: "idle" | "processed" }>;
  readonly close?: () => Promise<void>;
  readonly now?: () => number;
  readonly events?: unknown[];
  readonly onConstruct?: () => void;
}): GoogleDirectoryCronDependencies {
  return {
    environment: input?.environment ?? {
      VERCEL_ENV: "production",
      CRON_SECRET,
    },
    createWorker() {
      input?.onConstruct?.();
      return {
        runNext: input?.runNext ?? (async () => ({ kind: "idle" as const })),
        close: input?.close ?? (async () => undefined),
      };
    },
    log(event) {
      input?.events?.push(event);
    },
    now: input?.now ?? Date.now,
  };
}

test("cron rejects non-production, missing, weak, and mismatched credentials before worker construction", async () => {
  const environments = [
    { VERCEL_ENV: "preview", CRON_SECRET },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "production", CRON_SECRET: "too-short" },
    { VERCEL_ENV: "production", CRON_SECRET },
  ];
  const headers = [
    `Bearer ${CRON_SECRET}`,
    "Bearer undefined",
    "Bearer too-short",
    "Bearer wrong-directory-cron-secret-with-at-least-32-chars",
  ];

  for (let index = 0; index < environments.length; index += 1) {
    let constructions = 0;
    const response = await createGoogleDirectoryCronGet(dependencies({
      environment: environments[index],
      onConstruct: () => {
        constructions += 1;
      },
    }))(request(headers[index]));

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(constructions, 0);
    assert.equal(await response.text(), "");
  }
});

test("authorized cron drains processed jobs until idle and closes its worker once", async () => {
  let runCount = 0;
  let closeCount = 0;
  const events: unknown[] = [];
  const response = await createGoogleDirectoryCronGet(dependencies({
    events,
    async runNext(...arguments_) {
      assert.equal(arguments_.length, 0);
      runCount += 1;
      return { kind: runCount < 3 ? "processed" : "idle" };
    },
    async close() {
      closeCount += 1;
    },
  }))(request(`Bearer ${CRON_SECRET}`));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), null);
  assert.equal(await response.text(), "");
  assert.equal(runCount, 3);
  assert.equal(closeCount, 1);
  assert.deepEqual(events, [{
    event: "UPTECH_DIRECTORY_CRON_V1",
    request_id: REQUEST_ID,
    outcome: "PROCESSED",
  }]);
  assert.equal(JSON.stringify(events).includes("workspace"), false);
  assert.equal(JSON.stringify(events).includes("job"), false);
});

test("authorized cron caps a continuously busy drain at ten jobs", async () => {
  let runCount = 0;
  let closeCount = 0;
  const response = await createGoogleDirectoryCronGet(dependencies({
    async runNext() {
      runCount += 1;
      if (runCount > 10) throw new Error("cron drain exceeded its hard cap");
      return { kind: "processed" };
    },
    async close() {
      closeCount += 1;
    },
  }))(request(`Bearer ${CRON_SECRET}`));

  assert.equal(response.status, 204);
  assert.equal(runCount, 10);
  assert.equal(closeCount, 1);
});

test("authorized cron stops starting jobs when its execution budget is exhausted", async () => {
  let runCount = 0;
  let clockRead = 0;
  const clock = [0, 1_000, 210_000];
  const response = await createGoogleDirectoryCronGet(dependencies({
    now() {
      const value = clock[clockRead];
      clockRead += 1;
      if (value === undefined) throw new Error("execution budget was not enforced");
      return value;
    },
    async runNext() {
      runCount += 1;
      return { kind: "processed" };
    },
  }))(request(`Bearer ${CRON_SECRET}`));

  assert.equal(response.status, 204);
  assert.equal(runCount, 2);
});

test("cron fails closed without details and closes after a worker failure", async () => {
  const sensitiveFailure = new Error(`provider leaked ${CRON_SECRET} workspace-a job-a`);
  let closeCount = 0;
  const events: unknown[] = [];
  const response = await createGoogleDirectoryCronGet(dependencies({
    events,
    async runNext() {
      throw sensitiveFailure;
    },
    async close() {
      closeCount += 1;
    },
  }))(request(`Bearer ${CRON_SECRET}`));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(closeCount, 1);
  assert.equal(await response.text(), "");
  assert.deepEqual(events, [{
    event: "UPTECH_DIRECTORY_CRON_V1",
    request_id: REQUEST_ID,
    outcome: "FAILED",
  }]);
});
