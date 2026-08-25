import assert from "node:assert/strict";
import test from "node:test";

import { replacementCookieHeaders } from "./replacement-cookies.ts";

test("a replacement credential is always emitted after stale clears", () => {
  for (const name of [
    "__Host-uptech_session",
    "__Host-uptech_onboarding",
  ]) {
    const clearing = `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
    const replacement = `${name}=new-authority; Path=/; HttpOnly; Secure; SameSite=Lax`;
    const sequence = replacementCookieHeaders([clearing], replacement);

    assert.deepEqual(sequence, [clearing, replacement]);
    assert.equal(sequence.at(-1), replacement);
  }
});

test("replacement cookie sequences cannot be empty or mutated", () => {
  assert.throws(() => replacementCookieHeaders([], ""), TypeError);
  const sequence = replacementCookieHeaders([], "credential=value");
  assert.throws(() => (sequence as string[]).push("late-clear"), TypeError);
});
