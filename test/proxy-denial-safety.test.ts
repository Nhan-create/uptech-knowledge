import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("next/server.js", {
  namedExports: {
    NextResponse: {
      next: () => new Response(null),
      json: (body: unknown, init: ResponseInit) => new Response(JSON.stringify(body), init),
    },
  },
});

const { proxy } = await import("../src/proxy.ts");

test("generic proxy denial suppresses referrers for suffixed bootstrap ingress", () => {
  const response = proxy({
    nextUrl: new URL("https://knowledge.uptech.example/api/v1/onboarding/google-workspace/transactions/suffix"),
    method: "POST",
    headers: new Headers(),
  } as never);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
