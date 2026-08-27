import assert from "node:assert/strict";
import { test } from "node:test";

import { mobileCallbackRedirect } from "./http.ts";

const requestId = "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21";
const appReturn = "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback";

test("mobile callback success redirects with only handoff and request ID", () => {
  const response = mobileCallbackRedirect(appReturn, requestId, {
    outcome: "HANDOFF",
    handoffCode: Buffer.alloc(32, 9).toString("base64url"),
  });
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(response.status, 303);
  assert.deepEqual([...location.searchParams.keys()].sort(), ["handoff", "request_id"]);
  assert.equal(location.searchParams.get("request_id"), requestId);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("mobile callback denial redirects with only a fixed safe category and request ID", () => {
  const response = mobileCallbackRedirect(appReturn, requestId, {
    outcome: "DENIED",
    category: "AUTH_ERROR",
  });
  const location = new URL(response.headers.get("location") ?? "");
  assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
  assert.equal(location.searchParams.get("error"), "AUTH_ERROR");
  assert.equal(location.href.includes("token"), false);
});
