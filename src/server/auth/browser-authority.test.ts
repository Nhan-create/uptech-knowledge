import assert from "node:assert/strict";
import test from "node:test";

import { inspectBrowserAuthority } from "./browser-authority.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import {
  issueSessionCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";

const NORMAL = Object.freeze({
  kind: "session",
  clientType: "WEB",
  tokenKind: "WEB_SESSION",
});
const ONBOARDING = Object.freeze({ kind: "onboarding" });

function credential(): string {
  return issueSessionCredential().raw_token;
}

test("valid normal and onboarding credentials are active authority", async () => {
  for (const [name, context] of [
    [WEB_SESSION_COOKIE_NAME, NORMAL],
    [ONBOARDING_COOKIE_NAME, ONBOARDING],
  ] as const) {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: `${name}=${credential()}` }),
      {} as never,
      async () => context as never,
    );
    assert.deepEqual(result, { active: true, staleCookieHeaders: [] });
  }
});

test("expired, revoked, garbage, duplicate, and wrong-kind cookies are recoverable", async () => {
  const stale = credential();
  const cases = [
    {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${stale}`,
      authenticate: async () => null,
      cleared: WEB_SESSION_COOKIE_NAME,
    },
    {
      cookie: `${ONBOARDING_COOKIE_NAME}=garbage`,
      authenticate: async () => {
        throw new Error("malformed credentials must not reach PostgreSQL");
      },
      cleared: ONBOARDING_COOKIE_NAME,
    },
    {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${stale}; ${WEB_SESSION_COOKIE_NAME}=${credential()}`,
      authenticate: async () => {
        throw new Error("ambiguous credentials must not reach PostgreSQL");
      },
      cleared: WEB_SESSION_COOKIE_NAME,
    },
    {
      cookie: `${ONBOARDING_COOKIE_NAME}=${stale}`,
      authenticate: async () => NORMAL as never,
      cleared: ONBOARDING_COOKIE_NAME,
    },
  ];
  for (const scenario of cases) {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: scenario.cookie }),
      {} as never,
      scenario.authenticate as never,
    );
    assert.equal(result.active, false);
    assert.equal(result.staleCookieHeaders.length, 1);
    assert.match(
      result.staleCookieHeaders[0],
      new RegExp(`^${scenario.cleared}=;`),
    );
  }
});

test("database uncertainty neither clears nor reclassifies authority", async () => {
  await assert.rejects(
    inspectBrowserAuthority(
      new Headers({
        cookie: `${WEB_SESSION_COOKIE_NAME}=${credential()}`,
      }),
      {} as never,
      async () => {
        throw new Error("database unavailable");
      },
    ),
    /database unavailable/u,
  );
});
