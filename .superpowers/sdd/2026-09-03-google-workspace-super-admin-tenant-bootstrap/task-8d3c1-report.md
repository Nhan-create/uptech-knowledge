# Task 8D3-C1 report

## Scope

- Added one pure, deeply immutable copy module for normal login and all 29 closed `RecoveryState` values in Vietnamese and English.
- Preserved the existing normal-login title, description, home labels, request-ID label, and redirecting label.
- Added a fail-closed resolver: `null` selects normal login; an invalid locale or forged/non-null state returns `null`.
- No React component, page, transport, endpoint, registry, SQL, Mobile, or style changes.

## TDD evidence

- RED: `node --experimental-strip-types --test src/components/auth/login-recovery-copy.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created production module.
- GREEN: the same focused command passed 6/6 tests.
- `npm run typecheck`: PASS (`next typegen` and `tsc --noEmit`).
- `git diff --check`: PASS.

## Contract evidence

- Both locale maps use an exhaustive `Readonly<Record<RecoveryState, LoginRecoverySurfaceCopy>>` compile-time contract.
- Vietnamese descriptions are direct literals from approved design section 12, including separate identical entries for `SESSION_REVOKED` and `SESSION_EXPIRED`.
- All published nested objects are frozen, JSON-serializable, bounded plain text, and contain no HTML, URL, account address, customer identifier, or provider error payload.
