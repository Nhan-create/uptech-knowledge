# Task 8D3-A fix round 1 report

- Start commit: `59f5d663c6a759540e6cda6cda1484390721c554`.
- RED: focused test failed 13/14 because `resolveLoginPageError` returned the hostile provider detail `access_denied: admin@example.com` unchanged.
- GREEN: the compatibility function now returns an input unchanged only when the shared closed `publicRecoveryState` mapping accepts it; non-string and hostile inputs return `undefined`. `UNAVAILABLE` still returns the fixed `temporarily_unavailable` key.
- Focused test: PASS, 14/14.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS (Git emitted only the repository's LF-to-CRLF working-copy notices).
- Scope: only the owned login authority implementation/test plus this evidence report.
