# Reuse-First Enterprise Login and Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or equivalent scoped implementation/review. This delivery has one implementation task only.

**Goal:** Complete tenant-scoped Google Directory mapping, route guards, permission enforcement, and lifecycle revocation by extending the existing authorities without changing Login UI.

**Architecture:** Existing OIDC, domain resolution, identity, membership, session, connector/job, audit, Web, and Mobile authorities remain unchanged. A lean additive Directory snapshot/mapping contract feeds the existing membership/session versions and default-deny permission engine; server route guards enforce MEMBER versus OWNER/ADMIN.

**Tech Stack:** PostgreSQL forced RLS/PLpgSQL, Next.js 16 App Router/TypeScript, Node test runner, Flutter A3 auth client.

**Spec:** `docs/superpowers/specs/2026-09-01-reuse-first-enterprise-login-design.md`

## Global Constraints

- Hard 60-minute delivery; stop at the deadline and report exact status.
- Keep Web and Mobile Login UI byte-for-byte unchanged.
- Reuse `users`, `identities`, `workspaces`, `workspace_domain_locators`, `workspace_memberships`, `sessions`, `session_tokens`, `connectors`, `sync_jobs`, `audit_events`, existing Google OIDC, and existing Web/Mobile auth flows.
- Do not create `enterprise_login_transactions`, `enterprise_discovery_rate_buckets`, `people_data_connections`, per-tenant OIDC authority, setup authority, or platform-admin authority.
- Configured tenant admin group maps to existing `ADMIN`; Google Admin status never grants `ADMIN`.
- Tenant mapping produces `MEMBER + SALES|HR|IT` for employee departments.
- Permission runs server-side before data/retrieval and PostgreSQL RLS remains mandatory.
- Do not build a dashboard, Search, Documents, RAG, full Drive connector, or Directory UI.

---

### Task 1: Reconcile and complete enterprise login/permission

**Files:**

- Replace/refactor: `db/migrations/0007_enterprise_login.sql`
- Replace/refactor: `db/verify/enterprise_login.sql`
- Modify: `test/integration/enterprise-login-postgres.test.ts`
- Keep/reuse: `src/server/domain/knowledge-access.ts` and its tests
- Create: `src/server/people-data/google-directory.ts`
- Create: `src/server/people-data/repository.ts`
- Create: `src/server/people-data/service.ts`
- Create: matching `src/server/people-data/*.test.ts` files
- Create: `src/server/auth/route-authority.ts`
- Create: `src/server/auth/route-authority.test.ts`
- Modify: `src/app/home/page.tsx`
- Modify: `src/app/(admin)/admin/layout.tsx`
- Modify: `src/security/route-containment.mjs` and its test
- Modify only the concrete active legacy consumer identified in `mobile/lib/features/workspace/application/workspace_selection_controller.dart` if it can be moved to the existing A3 authority without changing presentation or protocol

**Interfaces:**

- Directory publish consumes an existing DIRECTORY connector/job lease plus a complete generation, profiles, groups, and direct group edges.
- Tenant mapping rows express either `ADMIN_GROUP -> ADMIN` or `DEPARTMENT -> MEMBER + SALES|HR|IT`.
- Publish updates the existing membership role/status/version and revokes existing sessions/tokens for suspended, deleted, unmapped, or removed-required-group users.
- `authenticateWebRoute(requestHeaders, requiredPlane)` returns the existing authenticated session context or a fixed redirect/deny result; it never accepts tenant or role input from the browser.
- Permission context is loaded from current server authority before protected adapters run.

- [ ] **Step 1: Write failing database tests**

  Add literal two-tenant personas for tenant admin, Sales, HR, IT, suspended, removed-group, and unknown user. Prove missing Directory relations/routines fail before migration changes. Test cross-tenant RLS, Sales-to-HR deny, HR-to-Sales deny, member-to-admin deny, lifecycle session revoke, and stale generation deny.

- [ ] **Step 2: Implement the lean additive migration**

  Remove the conflicting enterprise transaction, discovery limiter, per-tenant OIDC, people connection, setup, and operator authorities. Reuse existing connector/job/member/session tables. Add only mapping/snapshot relations, FORCE RLS policies, exact grants, fixed-search-path routines, lifecycle revocation, and redacted audit events.

- [ ] **Step 3: Verify database RED then GREEN**

  Run `npm run test:postgres:enterprise` against a disposable `uptech_phase1_test*` database. The pre-migration run must fail for the expected missing contract; the post-migration run must pass with zero failures.

- [ ] **Step 4: Write failing route and permission tests**

  Test MEMBER `/home`, OWNER/ADMIN `/admin`, MEMBER admin denial, invalid session denial, exact admin route containment, backend permission before adapter invocation, Sales/HR isolation, and cross-tenant denial.

- [ ] **Step 5: Implement route guards and permission integration**

  Reuse `authenticateWebSession`, the existing request transaction, and the default-deny permission engine. Change only server route/layout code and containment. Do not modify Login UI or create dashboards.

- [ ] **Step 6: Implement minimal Directory adapter/service**

  Add a read-only Google Directory transport boundary and sync orchestration that writes through existing connector/job authority and the new publish contract. Unit tests use a bounded fake transport and assert lifecycle/mapping outputs, never Google Admin-to-ADMIN inference.

- [ ] **Step 7: Remove active duplicate Mobile authority if present**

  Migrate any active consumer of the legacy session/refresh stack to the existing A3 repository/controller. Keep login presentation and protocol unchanged. Run focused Flutter auth/router tests.

- [ ] **Step 8: Duplication gate and one final verification pass**

  Confirm one User, Identity, Workspace, Membership, Session, connector/job, audit, tenant resolver, permission engine, and Web/Mobile auth authority. Then run exactly once: security, login routes, PostgreSQL integration, tenant/department/route guard tests, Flutter analyze/tests, typecheck, lint, and build. Report failures without rerunning the final pass.
