# Task 8D1 implementation report

## Scope

- Replaced the login-page's presence-only authority model with a closed, server-authenticated render/redirect model.
- Reused browser-authority inspection, Web route authority, the recovery registry, runtime database configuration, and the existing CSRF derivation.
- Kept the existing page compatibility exports until Task 8D3 wires the new model; no UI, route-handler, SQL, Mobile, or registry file changed.

## TDD evidence

- RED: `node --experimental-strip-types --test src/server/auth/login-page-authority.test.ts` failed because `resolveLoginPageModel` did not exist.
- GREEN: the same focused command passed **8/8 tests**.
- Coverage includes all uppercase recovery states, every required legacy mapping, all three exact onboarding families, fixed Web role destinations, wrong-family denial, malformed/duplicate/simultaneous/expired/revoked authority, canonical-cookie authentication failure, runtime/database uncertainty, and serialized non-leakage.

## Verification

- `node --experimental-strip-types --test src/server/auth/login-page-authority.test.ts`: PASS (8 tests, 0 failures).
- `npm run typecheck`: PASS.
- `git diff --check`: PASS (line-ending notices only).

## Commit

- Implementation commit: `0e790e4` (`feat(auth): resolve login recovery server-side`).

## Independent-review fix round 1

- Added a non-breaking detailed Directory/Web route decision so production distinguishes definitive loss of current authority from infrastructure uncertainty; the established `resolveWebRouteAuthority` public behavior remains compatible.
- Definitively non-current Web authority now renders `SESSION_REVOKED`, emits the shared canonical Web-cookie clear, and exposes fixed login recovery actions. DB/config uncertainty renders `PROVIDER_UNAVAILABLE` without clearing possibly-valid authority.
- `provider_rejected` now uses generic `INTERNAL_ERROR` because its emitter is normal OIDC cancellation, not Directory consent. `active_authority` uses `SESSION_REVOKED` only as a display fallback; current routable authority redirects first.
- All three onboarding operation families are matched explicitly; inconsistent/future families lose authority and CSRF.
- RED: new detailed-boundary tests failed on missing exports; revised login-model tests then failed on all four reviewed behavior gaps.
- GREEN: `node --experimental-strip-types --test src/server/auth/directory-authority.test.ts src/server/auth/web-route-authority.test.ts src/server/auth/login-page-authority.test.ts` passed **29/29 tests**.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS (line-ending notices only).
