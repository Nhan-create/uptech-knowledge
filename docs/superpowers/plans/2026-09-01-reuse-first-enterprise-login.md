# Reuse-First Enterprise Login and Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or equivalent scoped implementation/review. This delivery has one implementation task only. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing Google Workspace tenant/Directory/membership/session/permission chain without changing Login UI or creating parallel authorities.

**Architecture:** Existing OIDC and PostgreSQL authorities stay canonical. Login and protected routes consume the latest fresh published tenant Directory generation; an additive extension to the existing Directory snapshot carries Finance, OU, setup-only Google admin signals, customer/credential references, and lifecycle revocation.

**Tech Stack:** PostgreSQL forced RLS/PLpgSQL, Next.js 16 App Router/TypeScript, Node test runner, Flutter.

**Spec:** `docs/superpowers/specs/2026-09-01-reuse-first-enterprise-login-design.md`

## Global Constraints

- One task and a hard 60-minute timebox; stop and report exact status at the deadline.
- Keep Web and Mobile Login UI unchanged.
- Reuse all named auth, tenant, connector/job, permission, audit, and RLS authorities.
- Keep Knowledge/Search/Documents/RAG denied; do not build those features.
- Do not add a secret authority. Stop with `SHARED CONTRACT GAP` if the existing `SecretAdapter` contract is insufficient.

---

### Task 1: Reconcile and complete enterprise login/permission

**Files:**

- Modify: `db/migrations/0007_enterprise_login.sql`
- Modify: `db/verify/enterprise_login.sql`
- Modify: `test/integration/enterprise-login-postgres.test.ts`
- Modify: `src/server/people-data/google-directory-transport.ts`
- Modify: `src/server/people-data/google-directory-http.ts`
- Modify: `src/server/people-data/directory-sync.ts`
- Modify: matching `src/server/people-data/*.test.ts`
- Modify: `src/server/auth/web-route-authority.ts` and test
- Modify only route/layout containment needed to apply the shared authority; preserve Login components byte-for-byte.

**Interfaces:**

- Directory transport returns complete users, groups/direct memberships, OUs, customer binding, department, and setup-only `isAdmin`/`isDelegatedAdmin` signals.
- Snapshot publish maps `ADMIN_GROUP -> ADMIN` and `DEPARTMENT -> MEMBER + SALES|HR|IT|FINANCE`; OWNER remains tenant bootstrap admin.
- Login/session authorization reads a fresh published generation and returns no authority for unknown/unmapped/suspended/deleted identities.
- Protected route resolution returns only `ALLOW|ADMIN|HOME|LOGIN` from server authority and current Directory state.

- [ ] **Step 1 - RED:** Add literal regression tests for Finance, OU/admin signals, fresh/stale generations, unknown/unmapped/suspended users, group removal revocation, OWNER/admin/member routing, cross-tenant and department denial. Run focused tests and confirm the expected contract failures.
- [ ] **Step 2 - GREEN (Directory):** Extend the existing snapshot/transport/sync/publish contract minimally. Persist customer binding, credential reference, OU and admin signals; never use admin signals as app role. Reuse the existing secret adapter and worker lease.
- [ ] **Step 3 - GREEN (login/session/routes):** Make normal session issuance and protected route authority depend on the current fresh Directory mapping while preserving OWNER bootstrap access and existing Web/Mobile flows. Unknown workspace and personal Gmail remain safe denial outcomes.
- [ ] **Step 4 - GREEN (RLS/permission):** Extend Finance and tenant/department isolation tests; keep every unbacked Knowledge/Search/RAG route denied. Verify affected session/token revocation and version bumps.
- [ ] **Step 5 - Review and verify once:** Review the diff, then run security, focused Directory/route tests, PostgreSQL/RLS if the disposable database exists, Flutter analyze/tests, typecheck, lint, and build. Report exact failures without claiming completion.
