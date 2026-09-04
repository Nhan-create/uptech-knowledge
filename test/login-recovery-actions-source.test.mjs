import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentPath = new URL("../src/components/auth/LoginRecoveryActions.tsx", import.meta.url);
const googleButtonPath = new URL("../src/components/auth/GoogleLoginSubmitButton.tsx", import.meta.url);

test("the recovery renderer exposes only the closed serializable view-model boundary", () => {
  assert.equal(existsSync(componentPath), true, "LoginRecoveryActions must exist");
  const source = readFileSync(componentPath, "utf8");
  const props = source.match(/export interface LoginRecoveryActionsProps\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? "";

  for (const field of ["actions", "csrfToken", "requestId", "state", "retryAfterSeconds", "locale"]) {
    assert.match(props, new RegExp(`readonly ${field}\\??:`), field);
  }
  for (const forbidden of ["rawError", "cookie", "header", "authority", "operation", "email", "domain", "tenant", "provider", "html", "url"]) {
    assert.doesNotMatch(props.toLowerCase(), new RegExp(forbidden.toLowerCase()), forbidden);
  }
  assert.match(source, /actions\.slice\(0, 2\)/u);
  assert.match(source, /RECOVERY_ACTION_DESCRIPTORS\[descriptor\.id\]/u);
});

test("the renderer uses reviewed transports and bounded local output without a request body or raw HTML sink", () => {
  assert.equal(existsSync(componentPath), true, "LoginRecoveryActions must exist");
  const source = readFileSync(componentPath, "utf8");

  for (const imported of [
    "resolveLoginRecoveryTransport",
    "parseLoginRecoveryFetchSuccess",
    "readBoundedRecoveryJson",
    "resolveRecoveryClipboardText",
    "buildRecoveryContactHref",
    "getLoginRecoveryFeedback",
  ]) assert.match(source, new RegExp(imported), imported);

  for (const branch of ["NATIVE_FORM", "FETCH", "LINK", "COPY", "CONTACT"]) {
    assert.match(source, new RegExp(`case \\"${branch}\\"`), branch);
  }
  assert.match(source, /fetch\(transport\.path,\s*\{[\s\S]*?method: transport\.method,[\s\S]*?credentials: transport\.credentials,[\s\S]*?cache: transport\.cache,[\s\S]*?headers: transport\.headers,[\s\S]*?\}\)/u);
  assert.doesNotMatch(source, /\bbody\s*:/u);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML|window\.open/u);
  assert.doesNotMatch(source, /response\.(?:text|json)\(/u);
  assert.match(source, /window\.location\.assign\(result\.destination\)/u);
});

test("the renderer pins global pending, browser-back reset, cooldown and selectable fallbacks", () => {
  assert.equal(existsSync(componentPath), true, "LoginRecoveryActions must exist");
  const source = readFileSync(componentPath, "utf8");

  assert.match(source, /actionStartedRef/u);
  assert.match(source, /addEventListener\("pageshow"/u);
  assert.match(source, /setInterval/u);
  assert.match(source, /aria-live="polite"/u);
  assert.match(source, /readOnly/u);
  assert.match(source, /contact@uptech\.vn/u);
  assert.match(source, /<GoogleLoginSubmitButton/u);
  const googleButtonSource = readFileSync(googleButtonPath, "utf8");
  assert.match(googleButtonSource, /data-testid="google-login-submit"/u);
  assert.match(googleButtonSource, /withTopMargin\s*=\s*true/u);
  assert.match(googleButtonSource, /withTopMargin\s*\?\s*"mt-6\s"\s*:\s*""/u);
  assert.match(source, /<GoogleLoginSubmitButton[\s\S]*?withTopMargin=\{false\}/u);
  assert.match(source, /<div className="mt-6 space-y-3">/u);
  assert.match(source, /type="hidden"/u);
});
