# Task 8D3-B2-B fix round 1 evidence

- Start: `c6d6a05`
- Scope: bounded recovery response streaming and single-unit login action spacing only.
- RED: local helper test failed because `readBoundedRecoveryJson` did not exist; source gate failed because the renderer still used the unbounded response path and the Google button had no spacing opt-out.
- GREEN: `node --experimental-strip-types --test src/components/auth/login-recovery-local.test.ts` — 11/11 passed.
- GREEN: `node --test test/login-recovery-actions-source.test.mjs` — 3/3 passed.
- GREEN: `npm run typecheck` — passed.
- GREEN: focused ESLint on the three production files — passed with no findings.
- GREEN: `git diff --check` — passed.
- Behavior: fetch responses are read through a 2,048-byte ceiling, oversized streams are cancelled, reader/UTF-8/JSON failures return only `null`, and no raw/partial response is surfaced.
- Behavior: the standalone Google submit button still defaults to its original `mt-6`; recovery rendering opts out of that inner margin while retaining its wrapper's single `mt-6`.
