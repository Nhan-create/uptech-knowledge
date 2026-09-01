import assert from "node:assert/strict";
import test from "node:test";

import { issueCsrfCredential, issueSessionCredential } from "../sessions/session-security.ts";
import {
  classifyRequestCredential,
  verifyWebCsrf,
} from "./request-security.ts";

test("rejects requests that combine the session cookie with Bearer", () => {
  const session = issueSessionCredential();
  const result = classifyRequestCredential(
    new Headers({
      authorization: "Bearer native-access-token",
      cookie: `other=value; __Host-uptech_session=${session.raw_token}`,
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    reason: "conflicting_credentials",
  });
});

test("classifies exactly one credential and fails closed on malformed headers", () => {
  const session = issueSessionCredential();
  assert.deepEqual(
    classifyRequestCredential(
      new Headers({ cookie: `__Host-uptech_session=${session.raw_token}` }),
    ),
    { ok: true, kind: "cookie", credential: session.raw_token },
  );
  assert.deepEqual(
    classifyRequestCredential(new Headers({ authorization: "Bearer native" })),
    { ok: true, kind: "bearer", credential: "native" },
  );
  assert.deepEqual(classifyRequestCredential(new Headers()), {
    ok: true,
    kind: "none",
  });
  assert.deepEqual(
    classifyRequestCredential(new Headers({ authorization: "Basic abc" })),
    { ok: false, reason: "malformed_authorization" },
  );
  assert.deepEqual(
    classifyRequestCredential(
      new Headers({
        cookie: `__Host-uptech_session=${session.raw_token}; __Host-uptech_session=duplicate`,
      }),
    ),
    { ok: false, reason: "malformed_session_cookie" },
  );
});

test("requires exact Origin, same-site fetch metadata, and session-bound CSRF hash", () => {
  const csrf = issueCsrfCredential();
  const allowed = verifyWebCsrf({
    method: "POST",
    credential_kind: "cookie",
    headers: new Headers({
      origin: "https://tenant-a.example",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": csrf.raw_token,
    }),
    allowed_origin: "https://tenant-a.example",
    expected_csrf_hash: csrf.token_hash,
  });
  assert.deepEqual(allowed, { allowed: true });

  assert.deepEqual(
    verifyWebCsrf({
      method: "POST",
      credential_kind: "cookie",
      headers: new Headers({
        origin: "https://tenant-a.example/",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": csrf.raw_token,
      }),
      allowed_origin: "https://tenant-a.example",
      expected_csrf_hash: csrf.token_hash,
    }),
    { allowed: false, reason: "origin_mismatch" },
  );
  assert.deepEqual(
    verifyWebCsrf({
      method: "DELETE",
      credential_kind: "cookie",
      headers: new Headers({
        origin: "https://tenant-a.example",
        "sec-fetch-site": "cross-site",
        "x-csrf-token": csrf.raw_token,
      }),
      allowed_origin: "https://tenant-a.example",
      expected_csrf_hash: csrf.token_hash,
    }),
    { allowed: false, reason: "cross_site_request" },
  );
  assert.deepEqual(
    verifyWebCsrf({
      method: "PATCH",
      credential_kind: "cookie",
      headers: new Headers({
        origin: "https://tenant-a.example",
        "x-csrf-token": issueCsrfCredential().raw_token,
      }),
      allowed_origin: "https://tenant-a.example",
      expected_csrf_hash: csrf.token_hash,
    }),
    { allowed: false, reason: "missing_or_invalid_token" },
  );
});

test("does not apply cookie CSRF checks to safe methods or Bearer auth", () => {
  const csrf = issueCsrfCredential();
  for (const [method, credentialKind] of [
    ["GET", "cookie"],
    ["HEAD", "cookie"],
    ["OPTIONS", "cookie"],
    ["POST", "bearer"],
  ] as const) {
    assert.deepEqual(
      verifyWebCsrf({
        method,
        credential_kind: credentialKind,
        headers: new Headers(),
        allowed_origin: "https://tenant-a.example",
        expected_csrf_hash: csrf.token_hash,
      }),
      { allowed: true },
    );
  }
});
