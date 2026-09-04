# Task 8D2-D fix round 2 report

- Scope: test-only boundary pin in `src/server/onboarding/google-workspace/http.test.ts`; no production, transport, route, or UI edits.
- Mutation RED: temporarily placed canonical `Content-Length: 0` in the hostile table; focused HTTP run failed as expected because sync-retry returned `200` instead of expected `400` (37 pass, 1 fail).
- GREEN: restored the target boundary as `Content-Length: 1` on a request whose `body` is asserted `null`. The shared table exercises both sync-retry and access-request handlers, asserts `400 VALIDATION_FAILED`, zero repository calls, and safe response headers.
- Focused HTTP: PASS, 38/38.
- Typecheck: PASS.
- `git diff --check`: PASS (line-ending conversion warnings only).
