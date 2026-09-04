# Task 8D3-B2-B fix round 2 evidence

- Start: `e2f6cab`.
- Scope: direct stream-reader regression evidence only; production helper behavior is unchanged.
- RED mutation probe: temporarily retaining the reader lock caused 5 focused failures across normal success, overflow, malformed UTF-8, invalid JSON, and errored-stream paths; the helper was restored before GREEN.
- GREEN: `node --experimental-strip-types --test src/components/auth/login-recovery-local.test.ts` — 14/14 passed.
- GREEN: `npm run typecheck` — passed.
- GREEN: focused ESLint was not required because the production helper has no final diff.
- GREEN: `git diff --check` — passed.
- Coverage: oversized single-chunk input returns `null`, invokes stream cancellation, and releases the reader lock.
- Coverage: malformed UTF-8 that would otherwise decode into valid JSON fails closed; valid UTF-8 with invalid JSON also fails closed.
- Coverage: body locks are released after normal success, single- and multi-chunk overflow, malformed UTF-8, invalid JSON, and an errored stream; exact-bound and multi-chunk-overflow coverage remains intact.
