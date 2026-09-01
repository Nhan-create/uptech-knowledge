import assert from "node:assert/strict";
import test from "node:test";

import { inspectBrowserAuthority } from "./browser-authority.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { WebSessionAuthenticationError } from "./web-session.ts";
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
const SESSION_PEPPER = new Uint8Array(32).fill(0x31);

function credential(): string {
  return issueSessionCredential().raw_token;
}

test("a valid normal credential is active Web authority", async () => {
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${credential()}` }),
    {} as never,
    {
      sessionPepper: SESSION_PEPPER,
      authenticateSession: async () => NORMAL as never,
      authenticateWebSession: async () => ({}) as never,
    },
  );
  assert.deepEqual(result, {
    active: true,
    activeKind: "WEB_SESSION",
    staleCookieHeaders: [],
  });
});

test("legacy onboarding authority is classified and retired when no route exists", async () => {
  const result = await inspectBrowserAuthority(
    new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${credential()}` }),
    {} as never,
    {
      sessionPepper: SESSION_PEPPER,
      authenticateSession: async () => ONBOARDING as never,
      authenticateWebSession: async () => ({}) as never,
    },
  );
  assert.equal(result.active, true);
  assert.equal(result.activeKind, "ONBOARDING");
  assert.equal(result.staleCookieHeaders.length, 1);
  assert.match(result.staleCookieHeaders[0], new RegExp(`^${ONBOARDING_COOKIE_NAME}=;`));
});

test("expired, revoked, garbage, duplicate, and wrong-kind cookies are recoverable", async () => {
  const stale = credential();
  const cases: readonly Readonly<{
    cookie: string;
    authenticate: () => Promise<Readonly<{
      kind?: string;
      clientType?: string;
      tokenKind?: string;
    }> | null>;
    cleared: string;
  }>[] = [
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
      authenticate: async () => NORMAL,
      cleared: ONBOARDING_COOKIE_NAME,
    },
  ];
  for (const scenario of cases) {
    const result = await inspectBrowserAuthority(
      new Headers({ cookie: scenario.cookie }),
      {} as never,
      {
        sessionPepper: SESSION_PEPPER,
        authenticateSession: scenario.authenticate as never,
        authenticateWebSession: async () => {
          const context = await scenario.authenticate();
          if (
            context?.kind === "session" &&
            context.clientType === "WEB" &&
            context.tokenKind === "WEB_SESSION"
          ) {
            return {} as never;
          }
          throw new WebSessionAuthenticationError("stale Web authority");
        },
      },
    );
    assert.equal(result.active, false);
    assert.equal(result.activeKind, null);
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
      {
        sessionPepper: SESSION_PEPPER,
        authenticateSession: async () => {
          throw new Error("database unavailable");
        },
        authenticateWebSession: async () => {
          throw new Error("database unavailable");
        },
      },
    ),
    /database unavailable/u,
  );
});
