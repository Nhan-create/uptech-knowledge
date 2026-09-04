import assert from "node:assert/strict";
import test from "node:test";

import { inspectBrowserAuthority } from "./browser-authority.ts";
import {
  RECOVERY_OPERATION_FAMILIES,
  type RecoveryAuthority,
} from "./recovery-actions.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { WebSessionAuthenticationError } from "./web-session.ts";
import {
  issueSessionCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";

const SESSION_PEPPER = new Uint8Array(32).fill(0x31);
const FUTURE = new Date("2030-01-01T00:00:00.000Z");

function credential(): string {
  return issueSessionCredential().raw_token;
}

function onboardingContext(operations: readonly string[], contextExpiresAt = FUTURE) {
  return { kind: "onboarding" as const, identityId: "must-not-return", actorId: "must-not-return", allowedOperations: operations, contextExpiresAt };
}

function options(authenticateSession: (digest: Uint8Array) => Promise<unknown>, authenticateWebSession = async () => ({})) {
  return {
    sessionPepper: SESSION_PEPPER,
    authenticateSession: authenticateSession as never,
    authenticateWebSession: authenticateWebSession as never,
  };
}

test("a valid normal Web session retains only Web authority", async () => {
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${credential()}` }),
    {} as never,
    options(async () => null),
  );

  assert.deepEqual(result, {
    active: true,
    activeKind: "WEB_SESSION",
    onboardingAuthority: null,
    staleCookieHeaders: [],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.staleCookieHeaders), true);
});

for (const [family, operations] of Object.entries(RECOVERY_OPERATION_FAMILIES)) {
  test(`a valid ${family} onboarding session retains sanitized exact authority`, async () => {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
      {} as never,
      options(async () => onboardingContext(operations)),
    );
    const expected: RecoveryAuthority = {
      kind: "AUTHENTICATED_ONBOARDING",
      operations: [...operations],
    };

    assert.deepEqual(result, {
      active: true,
      activeKind: "ONBOARDING",
      onboardingAuthority: expected,
      staleCookieHeaders: [],
    });
    assert.equal(Object.isFrozen(result.onboardingAuthority), true);
    assert.equal(Object.isFrozen(result.onboardingAuthority?.operations), true);
    assert.notEqual(result.onboardingAuthority?.operations, operations);
  });
}

test("simultaneous authority names clear both names without invoking an authenticator", async () => {
  let calls = 0;
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${credential()}; ${ONBOARDING_COOKIE_NAME}=garbage` }),
    {} as never,
    options(async () => {
      calls += 1;
      return null;
    }, async () => {
      calls += 1;
      return {};
    }),
  );

  assert.deepEqual(result, {
    active: false,
    activeKind: null,
    onboardingAuthority: null,
    staleCookieHeaders: [
      `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `${ONBOARDING_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    ],
  });
  assert.equal(calls, 0);
});

test("ambiguous or malformed cookies clear without invoking an authenticator", async () => {
  for (const cookie of [
    `${WEB_SESSION_COOKIE_NAME}=${credential()}; ${WEB_SESSION_COOKIE_NAME}=${credential()}`,
    `${ONBOARDING_COOKIE_NAME}=${credential()}; ${ONBOARDING_COOKIE_NAME}=${credential()}`,
    `${WEB_SESSION_COOKIE_NAME}=garbage`,
    `${ONBOARDING_COOKIE_NAME}=`,
  ]) {
    let calls = 0;
    const result = await inspectBrowserAuthority(
      new Headers({ cookie }),
      {} as never,
      options(async () => {
        calls += 1;
        return null;
      }, async () => {
        calls += 1;
        return {};
      }),
    );
    assert.equal(result.active, false, cookie);
    assert.equal(result.activeKind, null, cookie);
    assert.equal(result.onboardingAuthority, null, cookie);
    assert.equal(result.staleCookieHeaders.length, 1, cookie);
    assert.equal(calls, 0, cookie);
  }
});

test("stale authenticated contexts clear their cookie", async () => {
  const cases = [
    ["null onboarding context", null],
    ["wrong context kind", { kind: "session" }],
    ["expired onboarding context", onboardingContext(RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN, new Date("2020-01-01T00:00:00.000Z"))],
    ["boundary expiry", onboardingContext(RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN, new Date(Date.now()))],
    ["invalid expiry", onboardingContext(RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN, new Date("invalid"))],
  ] as const;
  for (const [name, context] of cases) {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
      {} as never,
      options(async () => context),
    );
    assert.deepEqual(result, {
      active: false,
      activeKind: null,
      onboardingAuthority: null,
      staleCookieHeaders: [`${ONBOARDING_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
    }, name);
  }
});

test("malformed operation families clear onboarding authority", async () => {
  const expected = RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN;
  const malformed = [
    [],
    expected.slice(0, 1),
    [...expected, "ACCESS_REQUEST_READ"],
    [...expected].reverse(),
    [expected[0], expected[0], expected[2]],
    ["UNKNOWN_OPERATION"],
    ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT", "FIRST_DOMAIN_CLAIM_READ"],
  ] as const;
  for (const operations of malformed) {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
      {} as never,
      options(async () => onboardingContext(operations)),
    );
    assert.equal(result.active, false, JSON.stringify(operations));
    assert.equal(result.onboardingAuthority, null, JSON.stringify(operations));
    assert.equal(result.staleCookieHeaders.length, 1, JSON.stringify(operations));
  }
});

test("a missing onboarding operation family clears the cookie", async () => {
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
    {} as never,
    options(async () => ({ kind: "onboarding", contextExpiresAt: FUTURE })),
  );
  assert.deepEqual(result, {
    active: false,
    activeKind: null,
    onboardingAuthority: null,
    staleCookieHeaders: [`${ONBOARDING_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
  });
});

test("normal authentication failures clear only Web authority", async () => {
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${credential()}` }),
    {} as never,
    options(async () => null, async () => {
      throw new WebSessionAuthenticationError("revoked");
    }),
  );
  assert.deepEqual(result, {
    active: false,
    activeKind: null,
    onboardingAuthority: null,
    staleCookieHeaders: [`${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
  });
});

test("database uncertainty propagates without a clearing decision", async () => {
  await assert.rejects(
    inspectBrowserAuthority(
      new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
      {} as never,
      options(async () => {
        throw new Error("database unavailable");
      }),
    ),
    /database unavailable/u,
  );
});
