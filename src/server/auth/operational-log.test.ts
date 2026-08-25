import assert from "node:assert/strict";
import test from "node:test";

import { authOperationalEvent } from "./operational-log.ts";

test("auth operational evidence contains only fixed redacted correlation fields", () => {
  const event = authOperationalEvent({
    requestId: "00000000-0000-4000-8000-000000000123",
    operation: "GOOGLE_LOGIN_CALLBACK",
    outcome: "NORMAL",
  });

  assert.deepEqual(event, {
    event: "UPTECH_AUTH_OPERATION_V1",
    request_id: "00000000-0000-4000-8000-000000000123",
    operation: "GOOGLE_LOGIN_CALLBACK",
    outcome: "NORMAL",
  });
  assert.equal(Object.keys(event).length, 4);
  assert.equal(Object.isFrozen(event), true);
});
