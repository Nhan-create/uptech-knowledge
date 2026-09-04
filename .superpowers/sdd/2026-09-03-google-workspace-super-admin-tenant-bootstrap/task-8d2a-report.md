# Task 8D2-A implementation report

## Scope

- Added one private bounded mutating-POST envelope parser for the existing Directory-consent initiation endpoint.
- Preserved the exact legacy empty-body/custom-header request while accepting one exact native URL-encoded CSRF form.
- Reused the same onboarding cookie, CSRF derivation, admission, service, approved Google redirect, and setup-cookie authority.
- No UI, other endpoint, SQL, Mobile, provisioning/help, registry, or normal-login transaction file changed.

## TDD evidence

- RED: the focused test command failed **3/28 tests** because native form navigation was rejected, canonical-but-wrong form CSRF was not processed through the new mode, and an oversized stream was not cancelled.
- GREEN: the same focused command passed **28/28 tests**.
- The hostile-envelope table covers wrong method, query/hash, authorization and body metadata, mixed CSRF modes, malformed/reordered/duplicate/unknown fields, exact content type, encoded/NUL/invalid UTF-8 input, proof shape, canonical/equal content length, and caller-supplied authority selectors.
- The streaming regression observes cancellation as soon as the explicit cap is exceeded.

## Verification

- `node --experimental-strip-types --test src/server/onboarding/google-workspace/http.test.ts`: PASS (28 tests, 0 failures).
- `npm run typecheck`: PASS.
- `git diff --check`: PASS (line-ending notices only).

## Commit

- Pending at report creation; populated by the task commit recorded in Git history.
