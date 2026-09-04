# Task 8C2 report — guarded normal-login transaction intents

## Status

Completed and committed from base `ee6e95d`.

## RED / GREEN evidence

- RED: added `transaction rejects an unapproved form field before initiating OIDC` and ran `npm run test:login-routes`. The route incorrectly redirected to Google, proving the malformed form could start OIDC. Additional RED coverage then showed active Web/onboarding authority and stale-clear ordering failures.
- GREEN: implemented the closed form-intent parser, authority inspection and policy, shared constant-time onboarding CSRF credential check, and ordered transaction cookie output. The focused suite is green.

## Files changed

- `src/app/api/v1/auth/google/transactions/route.ts`
- `src/server/onboarding/google-workspace/http.ts`
- `test/google-login-route-safety.test.ts`

## Verification

- `npm run test:login-routes` — pass (37 tests)
- `npm run typecheck` — pass
- `git diff --check` — pass

## Self-review

- The parser accepts only the legacy empty request or canonical bounded form intents and rejects query/hash, authorization-header, duplicate/unknown, malformed, non-canonical, and cross-origin switch inputs before `initiate`.
- Active Web and onboarding authority retain valid cookies on denial. Active onboarding switch requires a single canonical inspected cookie, configured request/origin, exact `Sec-Fetch-Site`, and the reused constant-time CSRF credential comparison.
- Successful restart emits inspector stale clears first, then onboarding/setup clears as required, then exactly one login transaction cookie last. No normal session/onboarding replacement cookie is created.

## Concerns

- Focused tests emit pre-existing Node experimental/module-type warnings, but no test or typecheck failures remain.
