# Task 8D1 implementation report

## Scope

- Replaced the login-page's presence-only authority model with a closed, server-authenticated render/redirect model.
- Reused browser-authority inspection, Web route authority, the recovery registry, runtime database configuration, and the existing CSRF derivation.
- Kept the existing page compatibility exports until Task 8D3 wires the new model; no UI, route, SQL, Mobile, or registry file changed.

## TDD evidence

- RED: `node --experimental-strip-types --test src/server/auth/login-page-authority.test.ts` failed because `resolveLoginPageModel` did not exist.
- GREEN: the same focused command passed **8/8 tests**.
- Coverage includes all uppercase recovery states, every required legacy mapping, all three exact onboarding families, fixed Web role destinations, wrong-family denial, malformed/duplicate/simultaneous/expired/revoked authority, canonical-cookie authentication failure, runtime/database uncertainty, and serialized non-leakage.

## Verification

- `node --experimental-strip-types --test src/server/auth/login-page-authority.test.ts`: PASS (8 tests, 0 failures).
- `npm run typecheck`: PASS.
- `git diff --check`: PASS (line-ending notices only).

## Commit

- Pending at report creation; populated by the task commit recorded in Git history.
