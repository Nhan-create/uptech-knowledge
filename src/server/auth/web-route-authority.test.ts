import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWebRouteAuthority,
  type WebRouteAuthorityDependencies,
} from "./web-route-authority.ts";
import { WebSessionAuthenticationError } from "./web-session.ts";

const dependencies = (workspaceRole: "OWNER" | "ADMIN" | "MEMBER") =>
  ({
    loadConfig: () => ({
      databaseUrl: "postgresql://runtime@tenant-a.example/test",
      sessionPepper: new Uint8Array(32),
    }),
    getPool: () => ({}) as never,
    authenticate: async () =>
      ({ context: { workspaceRole } }) as never,
  }) satisfies WebRouteAuthorityDependencies;

test("MEMBER is allowed at /home", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=member" }),
      "HOME",
      dependencies("MEMBER"),
    ),
    "ALLOW",
  );
});

test("OWNER and ADMIN are allowed at /admin", async () => {
  for (const workspaceRole of ["OWNER", "ADMIN"] as const) {
    assert.equal(
      await resolveWebRouteAuthority(
        new Headers({ cookie: "__Host-uptech_session=admin" }),
        "ADMIN",
        dependencies(workspaceRole),
      ),
      "ALLOW",
      workspaceRole,
    );
  }
});

test("MEMBER is redirected from /admin to /home", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=member" }),
      "ADMIN",
      dependencies("MEMBER"),
    ),
    "HOME",
  );
});

test("an invalid web session is denied to login", async () => {
  const invalidSessionDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("MEMBER"),
    authenticate: async () => {
      throw new WebSessionAuthenticationError("invalid");
    },
  };

  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=invalid" }),
      "HOME",
      invalidSessionDependencies,
    ),
    "LOGIN",
  );
});

test("unrecognized session roles fail closed to login", async () => {
  const malformedSessionDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("MEMBER"),
    authenticate: async () =>
      ({ context: { workspaceRole: "PLATFORM_ADMIN" } }) as never,
  };

  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=invalid-role" }),
      "ADMIN",
      malformedSessionDependencies,
    ),
    "LOGIN",
  );
});
