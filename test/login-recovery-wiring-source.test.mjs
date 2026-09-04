import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/components/auth/GoogleWorkspaceLogin.tsx", import.meta.url), "utf8");
const actionsSource = readFileSync(new URL("../src/components/auth/LoginRecoveryActions.tsx", import.meta.url), "utf8");

test("the login page passes untrusted query values only to the closed page view-model", () => {
  assert.match(pageSource, /import\s*\{\s*resolveLoginPageViewModel\s*\}\s*from\s*"@\/server\/auth\/login-page-authority"/u);
  assert.match(pageSource, /resolveLoginPageViewModel\(requestHeaders,\s*\{\s*error:\s*parameters\.error,\s*request_id:\s*parameters\.request_id,?\s*\}\)/u);
  assert.match(pageSource, /if \(model\.kind === "REDIRECT"\)\s*\{\s*redirect\(model\.destination\);\s*\}/u);
  assert.doesNotMatch(pageSource, /resolveLoginPageAuthority|resolveLoginPageError|WEB_SESSION_COOKIE_NAME|safeRequestId|CANONICAL_UUID|\[0-9a-f\]/u);
});

test("the login page sends exactly the six serializable render fields into the shell", () => {
  const invocation = pageSource.match(/<GoogleWorkspaceLogin(?<props>[\s\S]*?)\/>/u)?.groups?.props ?? "";
  for (const field of ["state", "actions", "csrfToken", "requestId", "retryAfterSeconds", "locale"]) {
    assert.match(invocation, new RegExp(`${field}=\\{(?:model\\.${field}|locale)\\}`), field);
  }
  for (const forbidden of ["error", "headers", "cookie", "authority", "operation", "destination", "stale"]) {
    assert.doesNotMatch(invocation.toLowerCase(), new RegExp(forbidden), forbidden);
  }
});

test("the login shell resolves fixed copy and renders the closed action surface exactly once", () => {
  assert.match(shellSource, /resolveLoginRecoveryCopy/u);
  assert.match(shellSource, /LOGIN_RECOVERY_COPY_BY_LOCALE/u);
  assert.equal((shellSource.match(/<LoginRecoveryActions\b/gu) ?? []).length, 1);
  for (const field of ["state", "actions", "csrfToken", "requestId", "retryAfterSeconds", "locale"]) {
    assert.match(shellSource, new RegExp(`readonly ${field}:`), field);
  }
  assert.match(shellSource, /resolvedCopy === null \? \[\] : actions/u);
  assert.match(shellSource, /resolveLoginRecoveryCopy\(locale, "INTERNAL_ERROR"\)/u);
  assert.doesNotMatch(shellSource, /Record<string, LoginState>|showAlternateAccountAction|showContactUptechAction|mailto:|<form\b|GoogleLoginSubmitButton|resolveLoginState|\berror\??:/u);
});

test("the recovery wiring preserves the approved login shell and privacy affordances", () => {
  for (const marker of [
    'id="main-content"',
    'data-testid="login-background-video"',
    'poster="/media/login-background-poster.jpg"',
    'brightness-[1.25]',
    'data-testid="login-video-brightness"',
    'data-testid="login-header-brand"',
    'data-testid="login-header-home"',
    'data-testid="login-card"',
    'width: "min(28rem, calc(100vw - 2rem))"',
    'data-testid="login-uptech-logo"',
    "UPTECH KNOWLEDGE",
    '<SecurityPrivacyDisclosure locale={locale} />',
  ]) assert.ok(shellSource.includes(marker), marker);
  assert.doesNotMatch(shellSource, /Google password|aria-describedby="login-description"/u);
});

test("ordinary login keeps the exact established Google button copy and spacing", () => {
  assert.match(actionsSource, /state === null\s*&&\s*action\.id === "START_NORMAL_LOGIN"/u);
  assert.match(actionsSource, /locale === "vi"\s*\?\s*"Tiếp tục với Google Workspace"\s*:\s*"Continue with Google Workspace"/u);
  assert.match(actionsSource, /locale === "vi"\s*\?\s*"Đang chuyển đến Google…"\s*:\s*"Redirecting to Google…"/u);
  assert.match(actionsSource, /<GoogleLoginSubmitButton[\s\S]*?withTopMargin=\{false\}/u);
  assert.match(actionsSource, /<div className="mt-6 space-y-3">/u);
});
