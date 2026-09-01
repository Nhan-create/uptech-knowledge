import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLoginPageError,
  resolveLoginPageAuthority,
  type LoginPageAuthorityDependencies,
} from "./login-page-authority.ts";
import { WebSessionAuthenticationError } from "./web-session.ts";

const headers = new Headers({ cookie: "__Host-uptech_session=opaque" });
const pepper = new Uint8Array(32).fill(0x41);

function dependencies(
  authenticate: LoginPageAuthorityDependencies["authenticate"],
): LoginPageAuthorityDependencies {
  return {
    loadConfig: () => ({ databaseUrl: "postgres://runtime@unknown.example/uptech", sessionPepper: pepper }),
    getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) as never,
    authenticate,
  };
}

test("login page redirects a valid Web authority to the authenticated destination", async () => {
  const decision = await resolveLoginPageAuthority(
    headers,
    true,
    dependencies(async () => ({}) as never),
  );
  assert.equal(decision, "HOME");
});

test("login page renders login for no cookie or stale Web authority", async () => {
  let calls = 0;
  const deps = dependencies(async () => {
    calls += 1;
    throw new WebSessionAuthenticationError("stale");
  });

  assert.equal(await resolveLoginPageAuthority(headers, false, deps), "LOGIN");
  assert.equal(calls, 0);
  assert.equal(await resolveLoginPageAuthority(headers, true, deps), "LOGIN");
  assert.equal(calls, 1);
});

test("login page maps database or configuration uncertainty to a safe unavailable state", async () => {
  const decision = await resolveLoginPageAuthority(
    headers,
    true,
    dependencies(async () => {
      throw new Error("database unavailable");
    }),
  );
  assert.equal(decision, "UNAVAILABLE");
});

test("runtime uncertainty takes precedence over a query-provided login error", () => {
  assert.equal(
    resolveLoginPageError("provider_rejected", "UNAVAILABLE"),
    "temporarily_unavailable",
  );
  assert.equal(resolveLoginPageError("provider_rejected", "LOGIN"), "provider_rejected");
  assert.equal(resolveLoginPageError(undefined, "LOGIN"), undefined);
});
