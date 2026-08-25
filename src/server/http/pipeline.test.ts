import assert from "node:assert/strict";
import test from "node:test";

import { createSafeProblem } from "./problem.ts";
import { TenantRateLimitUnavailableError } from "../rate-limit/core.ts";
import {
  CONTINUE_PIPELINE,
  REQUEST_PIPELINE_ORDER,
  type RequestPipelineHandlers,
  runRequestPipeline,
} from "./pipeline.ts";

test("represents the required fail-closed request pipeline order", () => {
  assert.deepEqual(REQUEST_PIPELINE_ORDER, [
    "enforce_method_content_type_body_size",
    "authenticate",
    "bind_workspace_membership",
    "enforce_web_csrf",
    "enforce_pre_auth_or_subject_rate_limit",
    "validate_structure_and_ids",
    "masked_lookup_and_authorize",
    "validate_semantics_and_business_rules",
    "execute_service_and_data_access",
  ]);

  assert.ok(
    REQUEST_PIPELINE_ORDER.indexOf("authenticate") <
      REQUEST_PIPELINE_ORDER.indexOf("validate_structure_and_ids"),
  );
  assert.ok(
    REQUEST_PIPELINE_ORDER.indexOf("masked_lookup_and_authorize") <
      REQUEST_PIPELINE_ORDER.indexOf("validate_semantics_and_business_rules"),
  );
});

function continuingHandlers(
  calls: string[],
): RequestPipelineHandlers<{ request_id: string }> {
  return Object.fromEntries(
    REQUEST_PIPELINE_ORDER.map((stage) => [
      stage,
      () => {
        calls.push(stage);
        return CONTINUE_PIPELINE;
      },
    ]),
  ) as unknown as RequestPipelineHandlers<{ request_id: string }>;
}

test("runs every named stage exactly once in the centralized order", async () => {
  const calls: string[] = [];
  const result = await runRequestPipeline(
    { request_id: "request-1" },
    continuingHandlers(calls),
  );

  assert.deepEqual(result, { completed: true });
  assert.deepEqual(calls, REQUEST_PIPELINE_ORDER);
  assert.equal(new Set(calls).size, REQUEST_PIPELINE_ORDER.length);
});

test("short-circuits on a returned denial problem", async () => {
  const calls: string[] = [];
  const denial = createSafeProblem("NOT_FOUND");
  const handlers: RequestPipelineHandlers<{ request_id: string }> = {
    ...continuingHandlers(calls),
    masked_lookup_and_authorize: () => {
      calls.push("masked_lookup_and_authorize");
      return { outcome: "STOP", problem: denial };
    },
  };

  const result = await runRequestPipeline(
    { request_id: "request-2" },
    handlers,
  );

  assert.deepEqual(result, {
    completed: false,
    stopped_at: "masked_lookup_and_authorize",
    problem: denial,
  });
  assert.deepEqual(calls, REQUEST_PIPELINE_ORDER.slice(0, 7));
});

test("maps thrown stage errors to a safe problem and stops", async () => {
  const calls: string[] = [];
  const handlers: RequestPipelineHandlers<{ request_id: string }> = {
    ...continuingHandlers(calls),
    authenticate: () => {
      calls.push("authenticate");
      throw new Error("database-password-that-must-not-leak");
    },
  };

  const result = await runRequestPipeline(
    { request_id: "request-3" },
    handlers,
  );

  assert.equal(result.completed, false);
  if (result.completed) {
    assert.fail("pipeline should have stopped");
  }
  assert.equal(result.stopped_at, "authenticate");
  assert.equal(result.problem.code, "INTERNAL_ERROR");
  assert.doesNotMatch(
    JSON.stringify(result.problem),
    /database-password-that-must-not-leak/u,
  );
  assert.deepEqual(calls, [
    "enforce_method_content_type_body_size",
    "authenticate",
  ]);
});

test("maps limiter uncertainty to a fixed non-leaking 503", async () => {
  const calls: string[] = [];
  const handlers: RequestPipelineHandlers<{ request_id: string }> = {
    ...continuingHandlers(calls),
    enforce_pre_auth_or_subject_rate_limit: () => {
      calls.push("enforce_pre_auth_or_subject_rate_limit");
      throw new TenantRateLimitUnavailableError();
    },
  };

  const result = await runRequestPipeline(
    { request_id: "request-rate-unavailable" },
    handlers,
  );

  assert.equal(result.completed, false);
  if (result.completed) {
    assert.fail("pipeline should have stopped");
  }
  assert.equal(result.stopped_at, "enforce_pre_auth_or_subject_rate_limit");
  assert.equal(result.problem.status, 503);
  assert.equal(result.problem.code, "PROVIDER_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result.problem), /rate-limit decision/u);
});
