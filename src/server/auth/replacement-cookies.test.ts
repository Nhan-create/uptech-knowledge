import assert from "node:assert/strict";
import test from "node:test";

import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { replacementCookieHeaders } from "./replacement-cookies.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "../onboarding/google-workspace/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

function clear(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

test("validated authority clears precede one nonempty replacement", () => {
  for (const name of [WEB_SESSION_COOKIE_NAME, ONBOARDING_COOKIE_NAME]) {
    const replacement = name === ONBOARDING_COOKIE_NAME
      ? `${name}=new-authority; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60`
      : `${name}=new-authority; Path=/; HttpOnly; Secure; SameSite=Lax`;
    const sequence = replacementCookieHeaders([clear(WEB_SESSION_COOKIE_NAME), clear(ONBOARDING_COOKIE_NAME), clear(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME)], replacement);

    assert.deepEqual(sequence, [clear(WEB_SESSION_COOKIE_NAME), clear(ONBOARDING_COOKIE_NAME), clear(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME), replacement]);
    assert.equal(sequence.at(-1), replacement);
    assert.equal(Object.isFrozen(sequence), true);
  }
});

test("rejects malformed, late, injected, or mutable authority cookie inputs", () => {
  const replacement = `${WEB_SESSION_COOKIE_NAME}=new-authority; Path=/; HttpOnly; Secure; SameSite=Lax`;
  assert.throws(() => replacementCookieHeaders(["not-a-clear"], replacement), TypeError);
  assert.throws(() => replacementCookieHeaders([`${WEB_SESSION_COOKIE_NAME}=; Max-Age=0`], replacement), TypeError);
  assert.throws(() => replacementCookieHeaders([clear(WEB_SESSION_COOKIE_NAME)], `${WEB_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`), TypeError);
  assert.throws(() => replacementCookieHeaders([clear(WEB_SESSION_COOKIE_NAME)], `${WEB_SESSION_COOKIE_NAME}=new-authority; Max-Age=-1`), TypeError);
  assert.throws(() => replacementCookieHeaders([], `${WEB_SESSION_COOKIE_NAME}=new-authority; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`), TypeError);
  assert.throws(() => replacementCookieHeaders([], `${WEB_SESSION_COOKIE_NAME}=new\r\nSet-Cookie: injected`), TypeError);
  assert.throws(() => replacementCookieHeaders([], ""), TypeError);

  const stale = [clear(WEB_SESSION_COOKIE_NAME)];
  const sequence = replacementCookieHeaders(stale, replacement);
  stale.push(clear(ONBOARDING_COOKIE_NAME));
  assert.deepEqual(sequence, [clear(WEB_SESSION_COOKIE_NAME), replacement]);
  assert.throws(() => (sequence as string[]).push(clear(ONBOARDING_COOKIE_NAME)), TypeError);
});
