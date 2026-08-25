import assert from "node:assert/strict";
import test from "node:test";

import {
  CSRF_TOKEN_BYTES,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_PREVIOUS_TOKEN_GRACE_MS,
  SESSION_ROTATION_INTERVAL_MS,
  WEB_SESSION_COOKIE_ATTRIBUTES,
  WEB_SESSION_COOKIE_NAME,
  credentialMatchesHash,
  evaluateSessionTiming,
  hashCredential,
  isPreviousTokenWithinGrace,
  issueCsrfCredential,
  issueSessionCredential,
  serializeWebSessionCookie,
} from "./session-security.ts";

test("issues independent 256-bit session and CSRF credentials with SHA-256 hashes", () => {
  const session = issueSessionCredential();
  const csrf = issueCsrfCredential();

  assert.equal(Buffer.from(session.raw_token, "base64url").length, 32);
  assert.equal(Buffer.from(csrf.raw_token, "base64url").length, CSRF_TOKEN_BYTES);
  assert.match(session.token_hash, /^[a-f0-9]{64}$/u);
  assert.match(csrf.token_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(session.raw_token, csrf.raw_token);
  assert.notEqual(session.token_hash, session.raw_token);
  assert.equal(hashCredential(session.raw_token), session.token_hash);
});

test("matches credential hashes and fails closed for malformed input", () => {
  const issued = issueSessionCredential();
  const other = issueSessionCredential();

  assert.equal(credentialMatchesHash(issued.raw_token, issued.token_hash), true);
  assert.equal(credentialMatchesHash(other.raw_token, issued.token_hash), false);
  assert.equal(credentialMatchesHash("not-a-token", issued.token_hash), false);
  assert.equal(credentialMatchesHash(issued.raw_token, "not-a-hash"), false);
  assert.throws(() => hashCredential("not-a-token"), TypeError);
});

test("serializes only the exact __Host session cookie attributes", () => {
  const issued = issueSessionCredential();
  assert.equal(WEB_SESSION_COOKIE_NAME, "__Host-uptech_session");
  assert.equal(
    WEB_SESSION_COOKIE_ATTRIBUTES,
    "Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  assert.equal(
    serializeWebSessionCookie(issued.raw_token),
    `${WEB_SESSION_COOKIE_NAME}=${issued.raw_token}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  assert.doesNotMatch(serializeWebSessionCookie(issued.raw_token), /Domain=/iu);
});

test("enforces idle, absolute, and rotation boundaries", () => {
  const now = 2_000_000_000_000;
  const valid = {
    created_at_ms: now - SESSION_ABSOLUTE_TIMEOUT_MS + 1,
    last_seen_at_ms: now - SESSION_IDLE_TIMEOUT_MS + 1,
    rotated_at_ms: now - SESSION_ROTATION_INTERVAL_MS + 1,
  };

  assert.deepEqual(evaluateSessionTiming(valid, now), {
    allowed: true,
    should_rotate: false,
  });
  assert.deepEqual(
    evaluateSessionTiming(
      { ...valid, rotated_at_ms: now - SESSION_ROTATION_INTERVAL_MS },
      now,
    ),
    { allowed: true, should_rotate: true },
  );
  assert.deepEqual(
    evaluateSessionTiming(
      { ...valid, last_seen_at_ms: now - SESSION_IDLE_TIMEOUT_MS },
      now,
    ),
    { allowed: false, reason: "idle_timeout" },
  );
  assert.deepEqual(
    evaluateSessionTiming(
      { ...valid, created_at_ms: now - SESSION_ABSOLUTE_TIMEOUT_MS },
      now,
    ),
    { allowed: false, reason: "absolute_timeout" },
  );
});

test("fails closed on invalid timestamps and bounds previous-token grace", () => {
  const now = 2_000_000_000_000;
  assert.deepEqual(
    evaluateSessionTiming(
      {
        created_at_ms: now + 1,
        last_seen_at_ms: now,
        rotated_at_ms: now,
      },
      now,
    ),
    { allowed: false, reason: "invalid_timestamps" },
  );

  assert.equal(
    isPreviousTokenWithinGrace(
      now - SESSION_PREVIOUS_TOKEN_GRACE_MS,
      now,
    ),
    true,
  );
  assert.equal(
    isPreviousTokenWithinGrace(
      now - SESSION_PREVIOUS_TOKEN_GRACE_MS - 1,
      now,
    ),
    false,
  );
  assert.equal(isPreviousTokenWithinGrace(now + 1, now), false);
});
