# Task 7BF-D report — final Directory TTL transition

## Result

GREEN for the scoped final-transition TTL correction.

## TDD evidence

- Added a deterministic database-side regression trigger that delays the controlled-login success-audit insert for two seconds after final Directory revalidation and candidate Membership/Session/Token writes, while the selected generation has one second of freshness remaining.
- Before the production change, the regression returned `NORMAL /home` from the expired generation and failed the required `DENIED` assertion.
- After the production change, the guarded OAuth final transition rejects the expired proof with the existing caught SQLSTATE `PGA01`. The caught subtransaction rolls back candidate Membership, Session, SessionToken, and success-audit writes; exactly one redacted platform denial audit and one redacted tenant denial audit persist.
- The test-only trigger/function is removed in `finally`.

## Implementation

- Extended the controlled-login `EXCHANGE_RESERVED -> COMPLETED` predicate to require the exact selected generation still be the same latest complete `PUBLISHED` generation and `fresh_until > observed_at` at the final `clock_timestamp()` sample.
- Preserved the 7BF-C workspace publisher/login serialization and all existing OIDC/reservation guards.
- No TypeScript, Mobile, UI, or unrelated deferred-Minor changes.

## Fresh verification

```text
UPTECH_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/uptech_phase1_test_local
node --experimental-strip-types --test --test-name-pattern="Directory mapping evaluator|atomically admits a mapped known-tenant administrator|expires after authority writes" test/integration/google-workspace-bootstrap-postgres.test.ts

3 tests, 3 pass, 0 fail
duration: 3.15s
```

```text
UPTECH_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/uptech_phase1_test_local
node --experimental-strip-types --test test/integration/google-workspace-bootstrap-postgres.test.ts

31 tests, 31 pass, 0 fail
duration: 8.90s
```

```text
node --experimental-strip-types --test --test-name-pattern="Task 2 standalone verifier" test/integration/google-workspace-bootstrap-postgres.test.ts

1 test, 1 pass, 0 fail
duration: 1.08s
```

`git diff --check` exited 0; only Git's existing LF-to-CRLF notices were emitted.
