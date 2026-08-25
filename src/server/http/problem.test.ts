import assert from "node:assert/strict";
import test from "node:test";

import {
  PROBLEM_CONTENT_TYPE,
  createSafeProblem,
  problemResponse,
  requestIdFromHeaders,
  safeProblemFromUnknown,
} from "./problem.ts";

test("creates safe snake_case problem documents with request IDs", () => {
  const problem = createSafeProblem("NOT_FOUND");

  assert.deepEqual(Object.keys(problem), [
    "type",
    "title",
    "status",
    "code",
    "detail",
    "request_id",
  ]);
  assert.equal(problem.status, 404);
  assert.equal(problem.code, "NOT_FOUND");
  assert.match(problem.request_id, /^[0-9a-f-]{36}$/u);
  assert.equal("requestId" in problem, false);
});

test("preserves a validated operation request ID for audit correlation", () => {
  const requestId = "00000000-0000-4000-8000-000000000123";
  const problem = createSafeProblem("FORBIDDEN", requestId);
  assert.equal(problem.request_id, requestId);
  assert.throws(
    () => createSafeProblem("FORBIDDEN", "caller-controlled-text"),
    TypeError,
  );
});

test("uses only a boundary-injected UUID for request correlation", () => {
  const trusted = "00000000-0000-4000-8000-000000000123";
  assert.equal(
    requestIdFromHeaders(new Headers({ "x-uptech-request-id": trusted })),
    trusted,
  );
  assert.notEqual(
    requestIdFromHeaders(
      new Headers({ "x-uptech-request-id": "caller-controlled" }),
    ),
    "caller-controlled",
  );
});

test("maps unknown errors to a fixed non-leaking problem", () => {
  const secret = "database-password-that-must-not-leak";
  const problem = safeProblemFromUnknown(new Error(secret));
  const serialized = JSON.stringify(problem);

  assert.equal(problem.code, "INTERNAL_ERROR");
  assert.equal(problem.status, 500);
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
});

test("emits application/problem+json, no-store, and the matching request ID", async () => {
  const problem = createSafeProblem("UNAUTHENTICATED");
  const response = problemResponse(problem);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("content-type"), PROBLEM_CONTENT_TYPE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), problem.request_id);
  assert.deepEqual(await response.json(), problem);
});
