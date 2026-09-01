import assert from "node:assert/strict";
import test from "node:test";

import type { QueryResultRow } from "pg";

import {
  hashCredential,
  issueSessionCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";
import { deriveCsrfCredential } from "./google/crypto.ts";
import {
  authenticateWebSession,
  clearedWebSessionCookie,
  requireWebCsrf,
  revokeCurrentWebSession,
  WebSessionAuthenticationError,
  WebSessionIntegrityError,
  type AuthenticatedWebSession,
} from "./web-session.ts";

const SESSION_PEPPER = new Uint8Array(32).fill(0x6a);
const REQUEST_ID = "00000000-0000-4000-8000-000000000021";
const APP_ORIGIN = "https://tenant-a.example";

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length) {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

function authenticatedRow(csrfTokenHash: Uint8Array) {
  return {
    context_kind: "SESSION",
    identity_id: "00000000-0000-4000-8000-000000000031",
    workspace_id: "00000000-0000-4000-8000-000000000032",
    user_id: "00000000-0000-4000-8000-000000000033",
    membership_id: "00000000-0000-4000-8000-000000000034",
    session_id: "00000000-0000-4000-8000-000000000035",
    token_id: "00000000-0000-4000-8000-000000000036",
    client_type: "WEB",
    token_kind: "WEB_SESSION",
    workspace_role: "MEMBER",
    user_security_version: "1",
    identity_security_version: "2",
    workspace_security_version: "3",
    membership_authz_version: "4",
    session_security_version: "5",
    csrf_token_hash: Buffer.from(csrfTokenHash),
    context_expires_at: new Date("2026-08-25T05:00:00.000Z"),
  };
}

async function createAuthenticatedSession(): Promise<{
  readonly session: AuthenticatedWebSession;
  readonly rawCredential: string;
  readonly csrfCredential: string;
  readonly queryCalls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }>;
}> {
  const issued = issueSessionCredential();
  const csrfCredential = deriveCsrfCredential(
    issued.raw_token,
    SESSION_PEPPER,
  );
  const csrfHash = Buffer.from(hashCredential(csrfCredential), "hex");
  const queryCalls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  const pool = {
    async query(text: string, values: readonly unknown[] = []) {
      queryCalls.push({ text, values });
      return queryResult([authenticatedRow(csrfHash)]);
    },
  };
  const session = await authenticateWebSession(
    new Headers({
      cookie: `${WEB_SESSION_COOKIE_NAME}=${issued.raw_token}`,
    }),
    SESSION_PEPPER,
    pool as never,
  );
  return {
    session,
    rawCredential: issued.raw_token,
    csrfCredential,
    queryCalls,
  };
}

test("authenticates exactly one opaque web cookie and rechecks its CSRF binding", async () => {
  const result = await createAuthenticatedSession();

  assert.equal(result.session.rawCredential, result.rawCredential);
  assert.equal(result.session.csrfCredential, result.csrfCredential);
  assert.deepEqual(
    Buffer.from(result.session.credentialHash),
    Buffer.from(hashCredential(result.rawCredential), "hex"),
  );
  assert.equal(result.session.context.clientType, "WEB");
  assert.equal(result.session.context.tokenKind, "WEB_SESSION");
  assert.equal(result.session.context.workspaceRole, "MEMBER");
  assert.equal(result.queryCalls.length, 1);
  assert.equal(
    result.queryCalls[0].text,
    "SELECT * FROM uptech.authenticate_session($1::bytea)",
  );
  assert.equal(result.queryCalls[0].values.length, 1);
  assert.deepEqual(
    result.queryCalls[0].values[0],
    Buffer.from(hashCredential(result.rawCredential), "hex"),
  );
});

test("rejects missing, bearer, conflicting, onboarding, native, and CSRF-mismatched authority", async () => {
  const neverCalled = {
    async query() {
      throw new Error("database must not be called");
    },
  };
  const issued = issueSessionCredential();
  for (const headers of [
    new Headers(),
    new Headers({ authorization: "Bearer native-token" }),
    new Headers({
      authorization: "Bearer native-token",
      cookie: `${WEB_SESSION_COOKIE_NAME}=${issued.raw_token}`,
    }),
  ]) {
    await assert.rejects(
      authenticateWebSession(headers, SESSION_PEPPER, neverCalled as never),
      WebSessionAuthenticationError,
    );
  }

  const csrfCredential = deriveCsrfCredential(
    issued.raw_token,
    SESSION_PEPPER,
  );
  const validHash = Buffer.from(hashCredential(csrfCredential), "hex");
  const invalidAuthorityCases = [
    {
      ...authenticatedRow(validHash),
      context_kind: "ONBOARDING",
      workspace_id: null,
      membership_id: null,
      session_id: null,
      client_type: null,
      workspace_role: null,
      workspace_security_version: null,
      membership_authz_version: null,
      session_security_version: null,
      csrf_token_hash: null,
      allowed_operations: ["submit_or_read_access_request"],
    },
    {
      ...authenticatedRow(validHash),
      client_type: "NATIVE",
      token_kind: "NATIVE_ACCESS",
      csrf_token_hash: null,
    },
  ];
  for (const row of invalidAuthorityCases) {
    await assert.rejects(
      authenticateWebSession(
        new Headers({
          cookie: `${WEB_SESSION_COOKIE_NAME}=${issued.raw_token}`,
        }),
        SESSION_PEPPER,
        {
          query: async () => queryResult([row]),
        } as never,
      ),
      WebSessionAuthenticationError,
    );
  }

  await assert.rejects(
    authenticateWebSession(
      new Headers({
        cookie: `${WEB_SESSION_COOKIE_NAME}=${issued.raw_token}`,
      }),
      SESSION_PEPPER,
      {
        query: async () =>
          queryResult([authenticatedRow(Buffer.alloc(32, 0xff))]),
      } as never,
    ),
    (error: unknown) =>
      error instanceof WebSessionIntegrityError &&
      error instanceof WebSessionAuthenticationError,
  );
});

test("requires same-origin CSRF proof for cookie-authenticated mutations", async () => {
  const { session, csrfCredential } = await createAuthenticatedSession();
  const validRequest = new Request(`${APP_ORIGIN}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": csrfCredential,
    },
  });

  assert.doesNotThrow(() =>
    requireWebCsrf({ request: validRequest, appOrigin: APP_ORIGIN, session }),
  );

  for (const headers of [
    {
      origin: "https://tenant-b.example",
      "sec-fetch-site": "cross-site",
      "x-csrf-token": csrfCredential,
    },
    {
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "wrong-token",
    },
  ]) {
    const request = new Request(`${APP_ORIGIN}/api/v1/auth/logout`, {
      method: "POST",
      headers,
    });
    assert.throws(
      () =>
        requireWebCsrf({ request, appOrigin: APP_ORIGIN, session }),
      WebSessionAuthenticationError,
    );
  }
});

interface TransactionCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function transactionPool(sessionUpdateCount = 1) {
  const calls: TransactionCall[] = [];
  const releases: unknown[][] = [];
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (text.includes("matching_context_count")) {
        return queryResult([{ matching_context_count: 1 }]);
      }
      if (text.includes("UPDATE uptech.sessions")) {
        return queryResult([], sessionUpdateCount);
      }
      return queryResult([], 1);
    },
    release(...arguments_: unknown[]) {
      releases.push(arguments_);
    },
  };
  return {
    calls,
    releases,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test("logout revokes tokens and session in one revalidated transaction before commit", async () => {
  const { session } = await createAuthenticatedSession();
  const fake = transactionPool();

  await revokeCurrentWebSession(session, REQUEST_ID, fake.pool as never);

  assert.equal(fake.calls[0].text, "BEGIN");
  assert.match(fake.calls[1].text, /set_config\('app\.workspace_id'/u);
  assert.match(fake.calls[2].text, /uptech\.authenticate_session/u);
  assert.match(fake.calls[3].text, /INSERT INTO uptech\.audit_events/u);
  assert.match(fake.calls[3].text, /'AUTH_LOGOUT'/u);
  assert.match(fake.calls[4].text, /UPDATE uptech\.session_tokens/u);
  assert.match(fake.calls[4].text, /token_status = 'REVOKED'/u);
  assert.match(fake.calls[5].text, /UPDATE uptech\.sessions/u);
  assert.match(fake.calls[5].text, /status = 'REVOKED'/u);
  assert.equal(fake.calls[6].text, "COMMIT");
  assert.deepEqual(fake.releases, [[]]);
  assert.equal(
    fake.calls.some(({ text }) => text === "ROLLBACK"),
    false,
  );
});

test("logout rolls back every mutation when the active session cannot be revoked", async () => {
  const { session } = await createAuthenticatedSession();
  const fake = transactionPool(0);

  await assert.rejects(
    revokeCurrentWebSession(session, REQUEST_ID, fake.pool as never),
    WebSessionAuthenticationError,
  );

  assert.equal(fake.calls.at(-1)?.text, "ROLLBACK");
  assert.equal(
    fake.calls.some(({ text }) => text === "COMMIT"),
    false,
  );
  assert.deepEqual(fake.releases, [[]]);
});

test("clears only the exact secure host session cookie", () => {
  assert.equal(
    clearedWebSessionCookie(),
    `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  assert.doesNotMatch(clearedWebSessionCookie(), /Domain=/iu);
});
