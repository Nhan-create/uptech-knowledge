# Google Workspace Super Admin Tenant Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified Google Workspace Super Admin atomically create an unknown UPTECH tenant, publish its first Directory generation, then admit the Initial Owner and mapped employees through the existing login and permission authorities.

**Architecture:** Keep normal Google OIDC, User/Identity, Workspace/Membership/Session, SecretAdapter, connector/job, Directory generation, Permission Engine, audit, and RLS as the only authorities. Add one pre-tenant capability flow and additive PostgreSQL `0009` boundaries; all browser actions are selected from a closed recovery registry, all Google organization facts come from Admin SDK evidence, and no product session exists before a fresh first generation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Node test runner, PostgreSQL/PLpgSQL with forced RLS, Google Admin SDK Directory API, Google Cloud Secret Manager through the existing SecretAdapter, Vercel OIDC/WIF, Flutter/Dart.

**Spec:** `docs/superpowers/specs/2026-09-03-google-workspace-super-admin-tenant-bootstrap-design.md`

## Global Constraints

- Only the customer's Google Workspace account with Directory User `isAdmin === true` may create the first tenant; delegated-admin-only proof is denied.
- Google `sub` is identity authority, Google `customerId` is organization authority, and verified Admin SDK domains are locator authority. Never accept role, department, tenant, customer, or domain authority from a client.
- Normal employee login keeps `openid email profile`; pre-tenant Directory consent is separate and requires exactly OIDC three plus canonical Directory five scopes.
- Existing exact-four-scope connectors remain usable until reauthorization. Every bootstrap and new/re-authorized connector requires exact Directory five. Unknown, duplicate, or extra scopes deny.
- Refresh tokens remain server-only, enter PostgreSQL only as an opaque SecretReference, never enter Git/browser/mobile/logs, and use the existing Google Cloud Secret Manager adapter only.
- A committed bootstrap creates one `GOOGLE_GROUP_CONTROLLED` workspace and one Initial `OWNER`; Google admin flags never become later UPTECH role authority.
- No normal Web/Mobile session exists until a complete published generation is fresh and proves the subject active. Setup authority cannot read tenant data.
- Mapped employee admission may create `ADMIN` only from an explicit UPTECH `ADMIN_GROUP`; otherwise all matched Group/OU/Directory Department signals must converge on one department for `MEMBER`.
- Every denial has clear localized copy, a request ID, and one or two executable server-allowlisted actions. A capability-backed action is rendered only when that capability committed atomically.
- Preserve the current login card visual structure. Add state copy/actions and the minimal provisioning/help surfaces only; do not redesign Login UI.
- Do not build Admin/Employee Dashboard, Knowledge, Documents, Search, RAG, Drive, a support platform, or a second auth/tenant/session/permission/secret/worker authority.
- Never edit migrations `0001` through `0008`. All database changes go into additive `0009_google_workspace_tenant_bootstrap.sql`; after deployment it is immutable too.
- PostgreSQL integration runs only against a disposable database whose name starts with `uptech_phase1_test`; production receives migrations and one bounded smoke flow, never destructive tests.
- Preserve the user-owned untracked files `docs/superpowers/specs/2026-09-03-google-workspace-super-admin-tenant-bootstrap-design.vi.md`, `scripts/run-disposable-browser-login.mjs`, and `scripts/verify-disposable-enterprise-directory.mjs` unless the user separately authorizes changes.
- Repository boundary discovered during planning: `D:\uptech-knowledge\web` is the Git repository; adjacent `D:\uptech-knowledge\mobile` is not inside any Git worktree. Task 9 must not edit Mobile until that directory is attached to its authoritative repository. Web/server work remains independently committable; production release cannot claim Mobile delivery while the Mobile source is unversioned.

## File Structure

### New focused files

- `db/migrations/0009_google_workspace_tenant_bootstrap.sql` — additive types, relations, constraints, RLS, grants, bootstrap/status/access-request routines, and v2 login boundaries.
- `db/verify/google_workspace_tenant_bootstrap.sql` — catalog/privilege/RLS/function verifier for `0009`.
- `test/integration/google-workspace-bootstrap-postgres.test.ts` — disposable PostgreSQL bootstrap, race, JIT admission, freshness, revoke, and RLS tests.
- `src/server/onboarding/google-workspace/types.ts` — bootstrap domain evidence, public states, recovery action IDs, and result unions.
- `src/server/onboarding/google-workspace/crypto.ts` — sealed setup transaction cookie only.
- `src/server/onboarding/google-workspace/repository.ts` — typed calls to the narrow `0009` routines.
- `src/server/onboarding/google-workspace/service.ts` — Super Admin bootstrap orchestration and safe SecretAdapter lifecycle.
- `src/server/onboarding/google-workspace/runtime.ts` — approved production dependency wiring.
- `src/server/onboarding/google-workspace/http.ts` — request/cookie/redirect boundary shared by the new routes.
- `src/server/onboarding/google-workspace/*.test.ts` — unit/service/handler regressions beside each boundary.
- `src/server/auth/recovery-actions.ts` and `.test.ts` — closed state-to-action registry and capability-aware resolver.
- `src/components/auth/LoginRecoveryActions.tsx` — accessible renderer for server-selected actions without changing card layout.
- `src/app/setup/provisioning/page.tsx` — status-only setup surface.
- `src/app/help/enterprise-login/page.tsx` and `src/app/help/google-workspace/domain-verification/page.tsx` — bounded static recovery instructions.
- `src/app/api/v1/onboarding/google-workspace/{transactions,callback,status,sync-retry,finish}/route.ts` and `src/app/api/v1/onboarding/logout/route.ts` — thin route adapters.
- `src/app/api/v1/onboarding/access-requests/route.ts` and `current/route.ts` — restricted request submission/read routes.

### Existing files changed in place

- `src/server/people-data/google-directory-scopes.ts` — exact legacy-four/current-five classification.
- `src/server/people-data/google-directory-consent-provider.ts` and tests — domain proof, zero-group behavior, exact scope canonicalization, configurable approved callback path.
- `src/server/people-data/directory-consent.ts`, `directory-connection.ts`, and tests — five-scope reauthorization and unknown-commit secret safety.
- `src/server/people-data/directory-production.ts`, `directory-runtime.ts`, `google-directory-worker.ts`, and tests — supported four/five worker scope handling without fake backfill.
- `src/server/auth/google/{repository,service,runtime}.ts` and tests — persist onboarding results, consume v2 login states, and create JIT mapped memberships through PostgreSQL.
- `src/server/auth/browser-authority.ts`, `login-page-authority.ts`, `replacement-cookies.ts`, and tests — retain valid onboarding authority and resolve action-bearing login states.
- `src/server/http/problem.ts` and tests — allowlisted recovery action IDs in problem documents.
- `src/app/api/v1/auth/google/callback/route.ts`, `transactions/route.ts`, and route tests — set/replace onboarding cookie and keep normal session issuance isolated.
- `src/app/login/page.tsx`, `src/components/auth/GoogleWorkspaceLogin.tsx`, `test/login-ui.test.mjs`, and `test/login-auth-safety.test.mjs` — state copy/action rendering with unchanged visual shell.
- `src/server/auth/mobile/{protocol,google-repository,google-service,http}.ts` and tests — Web-only organization-setup handoff metadata, never Directory tokens.
- `../mobile/lib/features/auth/domain/auth_state.dart`, `../mobile/lib/features/auth/data/auth_api.dart`, `../mobile/lib/features/auth/presentation/login_screen.dart`, controller/repository files, and scoped tests — adjacent Mobile delivery tree; parse and execute server-approved recovery actions after its authoritative Git worktree is available.
- `scripts/apply-safe-google-access-states.mjs`, `scripts/run-google-workspace-bootstrap-browser.mjs`, `test/safe-google-access-states-deploy-contract.test.mjs`, `package.json`, and `vercel.json` — apply/verify `0009`, expose reproducible focused/browser commands, and schedule the existing zero-input cron.

## Spec Coverage Map

| Approved design area | Owning tasks |
|---|---|
| Existing authority reuse, trust boundaries, capability separation | Global constraints; Tasks 2, 3, 7 |
| Unknown-domain login and pre-tenant consent | Tasks 4, 5, 7 |
| Exact Super Admin/customer/domain proof | Tasks 1, 4 |
| Atomic tenant/Owner/connector/job/status creation and secret reconciliation | Tasks 2, 3, 4 |
| First-generation worker, status, retry, finish, reissue | Tasks 6, 10 |
| Known-tenant mapped employee admission, freshness, revoke, isolation | Task 7 |
| Clear denial reasons and executable Web/Mobile recovery actions | Tasks 6, 8, 9 |
| Additive `0009`, RLS, grants, disposable PostgreSQL verification | Tasks 2, 3, 6, 7, 11 |
| Production callback, migration-owner separation, cron, exact deployment, real smoke | Tasks 10, 11 |
| Non-goals and completion criteria | Global constraints; Task 11 |

---

### Task 1: Canonical Directory Five-Scope and Verified-Domain Evidence

**Files:**

- Create: `src/server/people-data/google-workspace-domains.ts`
- Create: `src/server/people-data/google-workspace-domains.test.ts`
- Modify: `src/server/people-data/google-directory-scopes.ts`
- Modify: `src/server/people-data/google-directory-consent-provider.ts`
- Modify: `src/server/people-data/google-directory-consent-provider.test.ts`
- Modify: `src/server/people-data/directory-consent.ts`
- Modify: `src/server/people-data/directory-connection.ts`
- Modify: `src/server/people-data/directory-connection.test.ts`
- Modify: `src/server/people-data/google-directory-worker.ts`
- Modify: `src/server/people-data/google-directory-worker.test.ts`

**Interfaces:**

- Produces: `GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES`, current five-scope `GOOGLE_DIRECTORY_READ_ONLY_SCOPES`, and `classifyGoogleDirectoryReadOnlyScopes(scopes): "LEGACY_FOUR" | "CURRENT_FIVE" | null`.
- Produces: `VerifiedGoogleWorkspaceDomain` with `normalizedDomain`, `kind`, `providerParentDomain`, and `verified: true`.
- Produces: `DirectoryConsentProviderGrant.verifiedDomains`; new consent/reauthorization requires current five, while worker token resolution accepts classified legacy four or current five.
- Preserves: post-tenant OWNER/ADMIN consent may use `isAdmin || isDelegatedAdmin`; only the bootstrap service in Task 4 requires `isAdmin === true`.

- [ ] **Step 1: Write failing exact-scope tests**

```ts
assert.equal(classifyGoogleDirectoryReadOnlyScopes(LEGACY_FOUR), "LEGACY_FOUR");
assert.equal(classifyGoogleDirectoryReadOnlyScopes(CURRENT_FIVE), "CURRENT_FIVE");
assert.equal(classifyGoogleDirectoryReadOnlyScopes([...CURRENT_FIVE, CURRENT_FIVE[0]]), null);
assert.equal(classifyGoogleDirectoryReadOnlyScopes([...CURRENT_FIVE, "https://www.googleapis.com/auth/drive.readonly"]), null);
assert.equal(hasExactGoogleDirectoryReadOnlyScopes(LEGACY_FOUR), false);
assert.equal(hasExactGoogleDirectoryReadOnlyScopes(CURRENT_FIVE), true);
```

- [ ] **Step 2: Run scope tests and confirm RED**

Run: `node --experimental-strip-types --test src/server/people-data/google-directory-consent-provider.test.ts src/server/people-data/google-directory-worker.test.ts`

Expected: FAIL because the domain scope, legacy/current classifier, and domain evidence do not exist.

- [ ] **Step 3: Implement exact scope constants and canonicalization**

```ts
export const GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
] as const);

export const GOOGLE_DIRECTORY_READ_ONLY_SCOPES = Object.freeze([
  ...GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES,
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
] as const);
```

Canonicalize only Google's `userinfo.email` and `userinfo.profile` aliases before exact eight-scope comparison; reject duplicates before and after normalization. Use `hasExactGoogleDirectoryReadOnlyScopes` for every new connector and the classifier only in worker reads of existing connectors.

- [ ] **Step 4: Write failing verified-domain and zero-group tests**

```ts
assert.deepEqual(evidence.verifiedDomains, [
  { normalizedDomain: "company-a.com", kind: "PRIMARY", providerParentDomain: null, verified: true },
  { normalizedDomain: "company-a.vn", kind: "SECONDARY", providerParentDomain: null, verified: true },
  { normalizedDomain: "staff.company-a.com", kind: "ALIAS", providerParentDomain: "company-a.com", verified: true },
]);
assert.equal(evidence.primaryDomain, "company-a.com");
assert.equal(memberRequests.length, 0);
```

Cover unverified domains, two primaries, `customerDomain` mismatch, alias under an unverified parent, conflicting duplicates, more than 1,000 names, one name over 253 ASCII bytes, and total normalized payload over 256 KiB.

- [ ] **Step 5: Implement bounded domain normalization and provider probes**

```ts
export type GoogleWorkspaceDomainKind = "PRIMARY" | "SECONDARY" | "ALIAS";

export interface VerifiedGoogleWorkspaceDomain {
  readonly normalizedDomain: string;
  readonly kind: GoogleWorkspaceDomainKind;
  readonly providerParentDomain: string | null;
  readonly verified: true;
}

export function normalizeVerifiedGoogleWorkspaceDomains(input: {
  readonly customerDomain: string;
  readonly domains: readonly Readonly<Record<string, unknown>>[];
}): readonly VerifiedGoogleWorkspaceDomain[];
```

Call `GET /admin/directory/v1/customer/{customerId}/domains`; derive aliases only from each verified Domain resource, sort by normalized domain/kind/parent, and require the OIDC `hd` in the resulting set. Probe member reads only when the group probe returns at least one group.

- [ ] **Step 6: Make reauthorization fail closed on unknown commit without deleting the candidate secret**

Change repository database failures to throw `DirectoryConnectionCommitUnknownError`; only a returned `{ outcome: "DENIED" }` is a proven rollback eligible for candidate-secret destruction. On an unknown outcome retain the labeled candidate, emit one redacted operational event, return outward denial, and never log the reference.

```ts
await assert.rejects(() => connectGoogleDirectory(input), DirectoryConnectionDeniedError);
assert.deepEqual(secretAdapter.destroyedReferences, []);
assert.deepEqual(reportedEvents, [{ event: "DIRECTORY_CONNECTION_COMMIT_UNKNOWN", request_id: REQUEST_ID }]);
```

- [ ] **Step 7: Run focused Directory tests and commit**

Run: `node --experimental-strip-types --test src/server/people-data/google-workspace-domains.test.ts src/server/people-data/google-directory-consent-provider.test.ts src/server/people-data/directory-connection.test.ts src/server/people-data/google-directory-worker.test.ts`

Expected: PASS.

```bash
git add src/server/people-data/google-workspace-domains.ts src/server/people-data/google-workspace-domains.test.ts src/server/people-data/google-directory-scopes.ts src/server/people-data/google-directory-consent-provider.ts src/server/people-data/google-directory-consent-provider.test.ts src/server/people-data/directory-consent.ts src/server/people-data/directory-connection.ts src/server/people-data/directory-connection.test.ts src/server/people-data/google-directory-worker.ts src/server/people-data/google-directory-worker.test.ts
git commit -m "feat: verify Google Workspace customer domains"
```

### Task 2: Additive `0009` Schema, Capability Shapes, and RLS

**Files:**

- Create: `db/migrations/0009_google_workspace_tenant_bootstrap.sql`
- Create: `db/verify/google_workspace_tenant_bootstrap.sql`
- Create: `test/integration/google-workspace-bootstrap-postgres.test.ts`

**Interfaces:**

- Produces: domain/attempt/access-request relations and constraints consumed by every later database routine.
- Produces: versioned public state/result types; does not alter `google_login_access_state_v1` meanings.
- Produces: forced-RLS tenant request storage and globally inaccessible pre-tenant coordination storage.

- [ ] **Step 1: Write the disposable schema test before the migration**

The test must refuse any URL whose database name does not start with `uptech_phase1_test`, run `0001` through `0009`, and assert catalog state under migration owner, API runtime, and worker runtime.

```ts
test("0009 adds bootstrap state without widening runtime table access", async () => {
  assert.equal(await relationHasForcedRls("workspace_access_requests"), true);
  assert.equal(await tablePrivilege("uptech_api_runtime", "google_workspace_bootstrap_attempts", "SELECT"), false);
  assert.equal(await tablePrivilege("uptech_worker_runtime", "google_workspace_bootstrap_receipts", "SELECT"), false);
  assert.equal(await typeExists("uptech.google_login_access_state_v2"), true);
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run: `node --experimental-strip-types --test test/integration/google-workspace-bootstrap-postgres.test.ts`

Expected: FAIL because migration `0009` and its objects do not exist.

- [ ] **Step 3: Add the exact versioned types and table shapes**

Create these public database types without changing earlier types:

```sql
CREATE TYPE uptech.google_workspace_domain_kind_v1 AS ENUM ('PRIMARY','SECONDARY','ALIAS');
CREATE TYPE uptech.google_workspace_bootstrap_attempt_state_v1 AS ENUM ('PREPARED','COMMITTED','ABORTED');
CREATE TYPE uptech.workspace_access_request_status_v1 AS ENUM ('PENDING','FULFILLED','CANCELLED');
CREATE TYPE uptech.google_login_access_state_v2 AS ENUM (
  'UNKNOWN_WORKSPACE','USER_NOT_PROVISIONED','ACCESS_MAPPING_CONFLICT',
  'USER_SUSPENDED','USER_REMOVED','DIRECTORY_SYNC_PENDING',
  'DIRECTORY_STALE','DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE',
  'WORKSPACE_SUSPENDED'
);
CREATE TYPE uptech.google_workspace_verified_domain_v1 AS (
  normalized_domain text,
  domain_kind uptech.google_workspace_domain_kind_v1,
  provider_parent_domain text
);
```

Add `onboarding_sessions.resource_workspace_id uuid`, locator customer/kind/parent provenance, `(workspace_id, google_customer_id)` workspace uniqueness, connector-authorizing Identity FK, one-live-SYNC_WORKER index, and `ORG_UNIT` mapping support. Create `google_workspace_bootstrap_attempts`, `google_workspace_bootstrap_receipts`, and `workspace_access_requests` with the exact state, uniqueness, retention, and tenant-binding rules from sections 8 and 14 of the spec.

- [ ] **Step 4: Add exact capability and locator constraints**

Enforce these predicates in PostgreSQL, not only TypeScript:

```sql
CHECK (
  (allowed_operations <@ ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE']::text[] AND resource_workspace_id IS NULL)
  OR
  (allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[] AND resource_workspace_id IS NOT NULL)
  OR
  (allowed_operations <@ ARRAY['DIRECTORY_BOOTSTRAP_STATUS_READ','DIRECTORY_BOOTSTRAP_SYNC_RETRY']::text[] AND resource_workspace_id IS NOT NULL)
)
```

Also require claim/access capability expiry at most 30 minutes, status expiry at most 24 hours, no mixed operation families, paired locator customer/kind, one primary per workspace/customer, null parent for primary/secondary, verified same-customer parent for alias, and deterministic input bounds.

- [ ] **Step 5: Lock down RLS, privileges, and verifier assertions**

Enable and force RLS on `workspace_access_requests`; add migration-owner policy and only narrow routine access for API. Keep attempt/receipt tables inaccessible to normal roles. For every new `SECURITY DEFINER` routine, set `search_path=pg_catalog, uptech`, revoke from `PUBLIC`, API, and worker first, then grant only the intended role.

`db/verify/google_workspace_tenant_bootstrap.sql` must fail when any required object, constraint, forced-RLS flag, policy, partial unique index, definer/search path, or exact grant is missing, and end with `ROLLBACK`.

- [ ] **Step 6: Run schema integration and verifier, then commit**

Run: `node --experimental-strip-types --test test/integration/google-workspace-bootstrap-postgres.test.ts`

Run: `psql $env:UPTECH_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f db/verify/google_workspace_tenant_bootstrap.sql`

Expected: both PASS against the disposable database; API/worker direct reads and writes are denied.

```bash
git add db/migrations/0009_google_workspace_tenant_bootstrap.sql db/verify/google_workspace_tenant_bootstrap.sql test/integration/google-workspace-bootstrap-postgres.test.ts
git commit -m "feat: add tenant bootstrap database boundaries"
```

### Task 3: Atomic Prepare, Complete, Reconcile, and Secret-Safe Bootstrap Repository

**Files:**

- Modify: `db/migrations/0009_google_workspace_tenant_bootstrap.sql`
- Modify: `db/verify/google_workspace_tenant_bootstrap.sql`
- Modify: `test/integration/google-workspace-bootstrap-postgres.test.ts`
- Create: `src/server/onboarding/google-workspace/types.ts`
- Create: `src/server/onboarding/google-workspace/repository.ts`
- Create: `src/server/onboarding/google-workspace/repository.test.ts`

**Interfaces:**

- Produces: `GoogleWorkspaceBootstrapRepository.prepare`, `.complete`, `.reconcile`, and `.abort`.
- Produces: an immutable committed receipt and initial status capability; raw credentials remain application memory only.
- Guarantees: the same advisory lock and ten-minute attempt deadline serialize completion/reconciliation; only locked `ABORTED` plus absence of connector/receipt can return `NOT_COMMITTED`.

- [ ] **Step 1: Add failing integration tests for prepare and state transitions**

```ts
assert.deepEqual(await prepareBootstrap(validPrepare), { outcome: "PREPARED" });
assert.deepEqual(await prepareBootstrap(validPrepare), { outcome: "PREPARED" });
assert.equal(await countRows("workspaces", CANDIDATE_WORKSPACE_ID), 0);
assert.equal(await prepareBootstrap({ ...validPrepare, statusTokenHash: hash32(7) }).then(row => row.outcome), "DENIED");
```

Assert only `PREPARED -> COMMITTED` and `PREPARED -> ABORTED`, a second live attempt for the source is denied, and prepare creates no Workspace/Membership/Connector/Session.

- [ ] **Step 2: Define and implement the four SQL entrypoints**

Use these exact signatures and versioned composite results:

```sql
uptech.prepare_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid, uptech.google_auth_hash32_v1, uuid
)
uptech.complete_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1,
  text, text, text, text, uptech.google_workspace_verified_domain_v1[],
  text, text[], uuid
)
uptech.reconcile_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1, text, uuid
)
uptech.abort_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid
)
```

The prepare and complete routines call `pg_advisory_xact_lock(hashtextextended('google-workspace-bootstrap:' || attempt_id::text, 0))` before reading attempt state. Complete revalidates source identity/sub/`hd`, exact current five scopes, normalized bounded domains, customer/domain uniqueness, and candidate status-hash collision before inserting one ACTIVE `GOOGLE_GROUP_CONTROLLED` workspace, all verified locators, one OWNER membership, one active Directory connector, one SYNC_WORKER, one queued DIRECTORY_SYNC job, the 24-hour status capability, SYSTEM/platform audits, receipt, and COMMITTED transition.

- [ ] **Step 3: Add race and ambiguous-commit tests**

Run two completions for the same customer/domain and assert exactly one workspace. Hold the completion lock in one connection, start reconcile in another, then prove reconcile waits and returns `COMMITTED`. Create an expired PREPARED attempt, reconcile it to `ABORTED`, then prove a delayed completion returns `DENIED` and `NOT_COMMITTED` is returned only when no connector uses the candidate reference.

```ts
assert.equal(committedCount, 1);
assert.equal(reconciled.outcome, "COMMITTED");
assert.equal(delayedCompletion.outcome, "DENIED");
assert.equal(await countCandidateCredentialReferences(), 0);
```

- [ ] **Step 4: Implement the typed PostgreSQL repository**

```ts
export interface GoogleWorkspaceBootstrapRepository {
  prepare(input: BootstrapPrepareInput): Promise<{ readonly outcome: "PREPARED" | "DENIED" }>;
  complete(input: BootstrapCompleteInput): Promise<
    | { readonly outcome: "PROVISIONING"; readonly statusExpiresAt: Date }
    | { readonly outcome: "DENIED" }
  >;
  reconcile(input: BootstrapReconcileInput): Promise<{ readonly outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN" }>;
  abort(input: BootstrapAbortInput): Promise<{ readonly outcome: "ABORTED" | "UNKNOWN" }>;
}

export interface BootstrapCompleteInput {
  readonly attemptId: string;
  readonly sourceTokenHash: Uint8Array;
  readonly statusTokenHash: Uint8Array;
  readonly customerId: string;
  readonly customerDomain: string;
  readonly providerSubject: string;
  readonly hostedDomain: string;
  readonly verifiedDomains: readonly VerifiedGoogleWorkspaceDomain[];
  readonly credentialReference: SecretReference;
  readonly authorizedScopes: readonly string[];
  readonly requestId: string;
}
```

Strictly parse one database row; the versioned committed result includes only `PROVISIONING` and the non-secret database-authored status expiry. Treat query/shape failures as `BootstrapCommitUnknownError`, not `DENIED`. Never include SecretReference in an error message.

- [ ] **Step 5: Run repository and PostgreSQL tests, verify catalog, and commit**

Run: `node --experimental-strip-types --test src/server/onboarding/google-workspace/repository.test.ts test/integration/google-workspace-bootstrap-postgres.test.ts`

Run: `psql $env:UPTECH_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f db/verify/google_workspace_tenant_bootstrap.sql`

Expected: PASS, including concurrency and privilege denial.

```bash
git add db/migrations/0009_google_workspace_tenant_bootstrap.sql db/verify/google_workspace_tenant_bootstrap.sql test/integration/google-workspace-bootstrap-postgres.test.ts src/server/onboarding/google-workspace/types.ts src/server/onboarding/google-workspace/repository.ts src/server/onboarding/google-workspace/repository.test.ts
git commit -m "feat: create tenants from verified Workspace proof"
```

### Task 4: Pre-Tenant Consent Cookie and Super Admin Bootstrap Service

**Files:**

- Create: `src/server/onboarding/google-workspace/crypto.ts`
- Create: `src/server/onboarding/google-workspace/crypto.test.ts`
- Create: `src/server/onboarding/google-workspace/service.ts`
- Create: `src/server/onboarding/google-workspace/service.test.ts`
- Create: `src/server/onboarding/google-workspace/runtime.ts`
- Create: `src/server/onboarding/google-workspace/runtime.test.ts`
- Modify: `src/server/people-data/google-directory-consent-provider.ts`
- Modify: `src/server/people-data/google-directory-consent-provider.test.ts`

**Interfaces:**

- Consumes: Task 1 current-five provider evidence and Task 3 repository.
- Produces: `GoogleWorkspaceBootstrapService.initiate` and `.callback`.
- Produces: sealed `GoogleWorkspaceSetupCookiePayload`; it carries transaction binding, never refresh/access/status/onboarding credentials.
- Guarantees: employee and delegated-admin-only proof never reach SecretAdapter; raw refresh/status bytes are zeroed after their required operation.

- [ ] **Step 1: Write failing cookie round-trip and rejection tests**

```ts
const payload: GoogleWorkspaceSetupCookiePayload = {
  attemptId: ATTEMPT_ID,
  candidateWorkspaceId: WORKSPACE_ID,
  identityId: IDENTITY_ID,
  providerSubject: "google-sub-1",
  normalizedEmail: "admin@company-a.com",
  hostedDomain: "company-a.com",
  state: STATE,
  nonce: NONCE,
  pkceVerifier: PKCE,
  expiresAt: new Date("2026-09-03T01:10:00.000Z"),
};
assert.deepEqual(openGoogleWorkspaceSetupCookie(sealGoogleWorkspaceSetupCookie(payload, key), { ...key, now }), payload);
assert.equal(openGoogleWorkspaceSetupCookie(tampered, { ...key, now }), null);
```

Also reject wrong environment/key version, non-v4 UUIDs, invalid domain/email/proof, duplicate/malformed cookie, expiry beyond ten minutes, and expired payload.

- [ ] **Step 2: Implement the dedicated setup cookie boundary**

Use AES-256-GCM with fresh 12-byte nonce and associated data:

```ts
`${environmentId}\x1fGOOGLE_WORKSPACE_TENANT_BOOTSTRAP_V1\x1f${keyVersion}`
```

Export only:

```ts
export const GOOGLE_WORKSPACE_SETUP_COOKIE_NAME = "__Host-uptech_workspace_setup_tx";
export function sealGoogleWorkspaceSetupCookie(value: GoogleWorkspaceSetupCookiePayload, key: SetupCookieKey): string;
export function openGoogleWorkspaceSetupCookie(value: unknown, key: SetupCookieOpenKey): GoogleWorkspaceSetupCookiePayload | null;
```

- [ ] **Step 3: Write service RED tests for identity/Admin/customer binding**

Assert that callback rejects before secret creation for personal/no-`hd`, mismatched `sub`, email or `hd`, inactive user, `isAdmin=false`, delegated-only admin, customer/user mismatch, `hd` absent from verified domains, incomplete probes, non-current-five scopes, and missing refresh token.

```ts
await assert.rejects(() => service.callback(DELEGATED_ONLY), errorWithCode("DELEGATED_ADMIN_UNSUPPORTED"));
assert.equal(secretAdapter.createCalls.length, 0);
assert.equal(repository.completeCalls.length, 0);
```

- [ ] **Step 4: Implement initiation and successful callback orchestration**

```ts
export interface GoogleWorkspaceBootstrapService {
  initiate(input: { readonly onboardingCredential: string; readonly requestId: string }): Promise<{
    readonly authorizationUrl: URL;
    readonly transactionCookie: string;
  }>;
  callback(input: {
    readonly onboardingCredential: string;
    readonly callbackSearch: string;
    readonly transactionCookie: string;
    readonly requestId: string;
  }): Promise<{
    readonly outcome: "PROVISIONING";
    readonly statusCredential: string;
    readonly statusExpiresAt: Date;
  }>;
}
```

Initiation authenticates exactly `FIRST_DOMAIN_CLAIM_RESERVE`, creates state/nonce/PKCE, attempt/candidate workspace UUIDs, and seals the verified identity binding. Callback reopens it, exchanges once, requires the exact same `sub`/email/`hd`, `isAdmin === true`, customer ID equality, verified domain membership, complete probes, and current five scopes.

- [ ] **Step 5: Implement prepared-attempt and SecretAdapter lifecycle**

Generate a distinct raw status credential/hash, confirm PREPARED, then create the refresh-token secret with:

```ts
{
  workspaceId: transaction.candidateWorkspaceId,
  serviceIdentity: "GOOGLE_DIRECTORY_BOOTSTRAP_V1",
  purpose: "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN",
  requestId,
  bootstrapAttemptId: transaction.attemptId,
}
```

On confirmed PROVISIONING keep the new secret and return the raw status credential. On proven `NOT_COMMITTED`, destroy only the candidate. On `COMMITTED`, keep it. On `UNKNOWN`, retain it, return fail-closed, and emit only `{ event, request_id, outcome }`. If secret creation fails, abort PREPARED and consume no source authority.

- [ ] **Step 6: Add process-loss and secret-cleanup regressions**

```ts
assert.equal(await callbackWithLostCommitResponse(), "PROVIDER_UNAVAILABLE");
assert.deepEqual(secretAdapter.destroyCalls, []);
assert.equal(await repository.reconcile(RECONCILE_INPUT).then(value => value.outcome), "COMMITTED");
assert.equal(refreshToken.every(byte => byte === 0), true);
```

Also prove a definitive ABORTED/NOT_COMMITTED outcome destroys the candidate, destroy failure is redacted, and a successful completion never destroys the new reference.

- [ ] **Step 7: Wire production dependencies and run tests**

`runtime.ts` must reuse `loadGoogleLoginRuntimeConfig`, `getRuntimeDatabasePool`, `loadApprovedSecretAdapter`, the current Directory provider with callback path `/api/v1/onboarding/google-workspace/callback`, and the existing zero-input production worker. It must not accept a tenant/customer/connector/job ID from environment or request data.

Run: `node --experimental-strip-types --test src/server/onboarding/google-workspace/crypto.test.ts src/server/onboarding/google-workspace/service.test.ts src/server/onboarding/google-workspace/runtime.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/onboarding/google-workspace/crypto.ts src/server/onboarding/google-workspace/crypto.test.ts src/server/onboarding/google-workspace/service.ts src/server/onboarding/google-workspace/service.test.ts src/server/onboarding/google-workspace/runtime.ts src/server/onboarding/google-workspace/runtime.test.ts src/server/people-data/google-directory-consent-provider.ts src/server/people-data/google-directory-consent-provider.test.ts
git commit -m "feat: bootstrap tenants with Super Admin proof"
```

### Task 5: Pre-Tenant Start and Callback HTTP Routes

**Files:**

- Create: `src/server/onboarding/google-workspace/http.ts`
- Create: `src/server/onboarding/google-workspace/http.test.ts`
- Create: `src/app/api/v1/onboarding/google-workspace/transactions/route.ts`
- Create: `src/app/api/v1/onboarding/google-workspace/callback/route.ts`
- Modify: `test/google-login-route-safety.test.ts`
- Modify: `src/security/route-containment.test.mjs`

**Interfaces:**

- Consumes: Task 4 runtime/service and existing `__Host-uptech_onboarding` credential.
- Produces: same-origin setup POST and Google callback GET.
- Produces: only 303 allowlisted redirects or no-store safe problem responses; callback never creates a normal session.

- [ ] **Step 1: Write route tests before route files**

```ts
assert.equal(startResponse.status, 303);
assert.equal(startResponse.headers.get("location"), GOOGLE_AUTHORIZATION_URL);
assert.match(startResponse.headers.get("set-cookie") ?? "", /__Host-uptech_workspace_setup_tx=/u);

assert.equal(callbackResponse.status, 303);
assert.equal(new URL(callbackResponse.headers.get("location")!).pathname, "/setup/provisioning");
assert.match(callbackResponse.headers.get("set-cookie") ?? "", /__Host-uptech_onboarding=/u);
assert.doesNotMatch(callbackResponse.headers.get("set-cookie") ?? "", /uptech_session=/u);
```

Cover missing/duplicate cookies, wrong Origin/Sec-Fetch-Site, absent CSRF, simultaneous normal session, arbitrary callback query, unapproved authorization origin, replay, and response header leakage.

- [ ] **Step 2: Implement strict cookie and origin helpers**

`http.ts` must parse exactly one onboarding cookie and one setup transaction cookie, bound values to 4,500 bytes, use the existing session pepper for derived CSRF, and emit:

```ts
Cache-Control: no-store, max-age=0
Pragma: no-cache
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Only `https://accounts.google.com/o/oauth2/v2/auth` is a valid authorization redirect. Only the configured exact app origin may receive callback redirects.

- [ ] **Step 3: Implement start and callback handlers**

```ts
export function createGoogleWorkspaceBootstrapPost(deps: BootstrapHttpDependencies): (request: Request) => Promise<Response>;
export function createGoogleWorkspaceBootstrapCallbackGet(deps: BootstrapHttpDependencies): (request: Request) => Promise<Response>;
```

The POST requires `FIRST_DOMAIN_CLAIM_RESERVE`; the callback clears the setup transaction cookie on every terminal path. Success replaces the source onboarding cookie with the status credential only after confirmed/reconciled commit and redirects to `/setup/provisioning`. Failure uses the fixed shape `/login?error=PROVIDER_UNAVAILABLE&request_id=550e8400-e29b-41d4-a716-446655440000`, substituting only another allowlisted code and the current server-generated UUID; it includes no provider text.

- [ ] **Step 4: Keep App Router files as thin dependency adapters**

```ts
import { createGoogleWorkspaceBootstrapPost } from "@/server/onboarding/google-workspace/http";
import { googleWorkspaceBootstrapHttpDependencies } from "@/server/onboarding/google-workspace/runtime";

export const POST = createGoogleWorkspaceBootstrapPost(googleWorkspaceBootstrapHttpDependencies);
```

Use the equivalent callback factory for GET; export no tenant-selecting request schema.

- [ ] **Step 5: Run route/security tests and commit**

Run: `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./test/next-alias-loader.mjs --test src/server/onboarding/google-workspace/http.test.ts test/google-login-route-safety.test.ts`

Run: `node --test src/security/route-containment.test.mjs`

Expected: PASS.

```bash
git add src/server/onboarding/google-workspace/http.ts src/server/onboarding/google-workspace/http.test.ts src/app/api/v1/onboarding/google-workspace/transactions/route.ts src/app/api/v1/onboarding/google-workspace/callback/route.ts test/google-login-route-safety.test.ts src/security/route-containment.test.mjs
git commit -m "feat: add Workspace bootstrap callback routes"
```

### Task 6: Provisioning Status, Retry, Finish, Logout, and Access Requests

**Files:**

- Modify: `db/migrations/0009_google_workspace_tenant_bootstrap.sql`
- Modify: `db/verify/google_workspace_tenant_bootstrap.sql`
- Modify: `test/integration/google-workspace-bootstrap-postgres.test.ts`
- Modify: `src/server/onboarding/google-workspace/repository.ts`
- Modify: `src/server/onboarding/google-workspace/repository.test.ts`
- Modify: `src/server/onboarding/google-workspace/http.ts`
- Modify: `src/server/onboarding/google-workspace/http.test.ts`
- Create: `src/app/api/v1/onboarding/google-workspace/status/route.ts`
- Create: `src/app/api/v1/onboarding/google-workspace/sync-retry/route.ts`
- Create: `src/app/api/v1/onboarding/google-workspace/finish/route.ts`
- Create: `src/app/api/v1/onboarding/logout/route.ts`
- Create: `src/app/api/v1/onboarding/access-requests/route.ts`
- Create: `src/app/api/v1/onboarding/access-requests/current/route.ts`

**Interfaces:**

- Produces: status state `DIRECTORY_BOOTSTRAP_SYNC_PENDING | READY | DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE | DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED | ONBOARDING_EXPIRED`.
- Produces: capability-bound retry/finish/logout and access-request submission/read.
- Guarantees: no endpoint accepts workspace/connector/job/role/department/reason/recipient authority from JSON, query, or form fields.

- [ ] **Step 1: Write failing SQL tests for status and retry semantics**

Assert queued and unexpired LEASED jobs are pending, expired lease below attempt limit is retryable, exhausted attempts require support, READY requires one complete fresh published generation for the bound connector/customer, and an expired credential returns only `ONBOARDING_EXPIRED` without tenant fields.

```ts
assert.deepEqual(await readStatus(STATUS_HASH), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
assert.deepEqual(await retryStatus(STATUS_HASH), { outcome: "REQUEUED" });
assert.equal(await countJobsForOtherWorkspace(), 1);
```

- [ ] **Step 2: Add the narrow status/access SQL routines**

Create and grant only these signatures:

```sql
uptech.read_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1, uuid)
uptech.retry_google_workspace_bootstrap_sync_v1(uptech.google_auth_hash32_v1, uuid)
uptech.finish_google_workspace_bootstrap_v1(uptech.google_auth_hash32_v1, uuid)
uptech.reissue_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1, uptech.google_verified_claims_assertion_v1, uptech.google_auth_hash32_v1, uuid)
uptech.revoke_onboarding_capability_v1(uptech.google_auth_hash32_v1, uuid)
uptech.submit_workspace_access_request_v1(uptech.google_auth_hash32_v1, uuid)
uptech.read_workspace_access_request_v1(uptech.google_auth_hash32_v1, uuid)
```

The first reissue argument is the hash of a freshly reserved normal Google login transaction; the routine consumes that transaction and verifies its server-issued claims assertion. It is not a status credential and the routine is not directly callable from a browser. Retry may requeue only the same expired lease below its existing maximum. Reissue requires fresh OIDC `(issuer, sub, hd)`, receipt Initial Owner identity/workspace, connector authorized identity, and no usable first generation; it revokes older active status rows and stores only the new hash. Access submission uses only capability `resource_workspace_id` and server-held reason class, creates one live deduplicated PENDING request, and never grants membership.

- [ ] **Step 3: Write handler tests for every forbidden input and state**

For each route, send body keys such as `workspace_id`, `connector_id`, `job_id`, `role`, and `department`; assert 400 or 403 and zero repository mutation. Prove wrong-family, duplicate, expired, revoked, and cross-workspace cookies deny. Prove logout revokes the hash and clears both onboarding/setup cookies.

- [ ] **Step 4: Implement the route factories and thin route adapters**

```ts
export function createBootstrapStatusGet(deps: BootstrapStatusDependencies): (request: Request) => Promise<Response>;
export function createBootstrapSyncRetryPost(deps: BootstrapStatusDependencies): (request: Request) => Promise<Response>;
export function createBootstrapFinishPost(deps: BootstrapStatusDependencies): (request: Request) => Promise<Response>;
export function createOnboardingLogoutPost(deps: BootstrapStatusDependencies): (request: Request) => Promise<Response>;
export function createAccessRequestPost(deps: AccessRequestDependencies): (request: Request) => Promise<Response>;
export function createCurrentAccessRequestGet(deps: AccessRequestDependencies): (request: Request) => Promise<Response>;
```

All JSON/problem responses are no-store. `finish` consumes READY status and initiates a fresh normal OIDC transaction; it does not convert the status credential into a session.

- [ ] **Step 5: Verify PostgreSQL, routes, and worker isolation**

Run: `node --experimental-strip-types --test src/server/onboarding/google-workspace/repository.test.ts test/integration/google-workspace-bootstrap-postgres.test.ts`

Run: `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./test/next-alias-loader.mjs --test src/server/onboarding/google-workspace/http.test.ts`

Run: `psql $env:UPTECH_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f db/verify/google_workspace_tenant_bootstrap.sql`

Expected: PASS, including Tenant A cannot read/requeue/submit against Tenant B.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0009_google_workspace_tenant_bootstrap.sql db/verify/google_workspace_tenant_bootstrap.sql test/integration/google-workspace-bootstrap-postgres.test.ts src/server/onboarding/google-workspace/repository.ts src/server/onboarding/google-workspace/repository.test.ts src/server/onboarding/google-workspace/http.ts src/server/onboarding/google-workspace/http.test.ts src/app/api/v1/onboarding/google-workspace/status/route.ts src/app/api/v1/onboarding/google-workspace/sync-retry/route.ts src/app/api/v1/onboarding/google-workspace/finish/route.ts src/app/api/v1/onboarding/logout/route.ts src/app/api/v1/onboarding/access-requests/route.ts src/app/api/v1/onboarding/access-requests/current/route.ts
git commit -m "feat: add tenant provisioning recovery endpoints"
```

### Task 7: V2 Google Login Completion and Mapped Employee Admission

**Files:**

- Modify: `db/migrations/0009_google_workspace_tenant_bootstrap.sql`
- Modify: `db/verify/google_workspace_tenant_bootstrap.sql`
- Modify: `test/integration/google-workspace-bootstrap-postgres.test.ts`
- Modify: `src/server/auth/google/repository.ts`
- Modify: `src/server/auth/google/repository.test.ts`
- Modify: `src/server/auth/google/service.ts`
- Modify: `src/server/auth/google/service.test.ts`
- Modify: `src/server/auth/google/service.access-state.test.ts`
- Modify: `src/server/auth/google/runtime.ts`
- Modify: `src/app/api/v1/auth/google/callback/route.ts`
- Modify: `test/google-login-route-safety.test.ts`

**Interfaces:**

- Consumes: current fresh published Directory generation, verified locators, mappings, and existing session creation authority.
- Produces: `complete_web_google_login_directory_v2` and a strictly parsed TypeScript result carrying public state plus committed onboarding operations.
- Produces: persisted unknown-organization capability and known-tenant access-request capability; neither is a product session.
- Produces: atomic JIT `ADMIN`/`MEMBER` admission for a new mapped employee; never `OWNER`.

- [ ] **Step 1: Write database RED tests for persisted unknown organization**

```ts
const result = await completeWebGoogleLoginV2(UNKNOWN_DOMAIN_CLAIMS);
assert.equal(result.outcome, "ONBOARDING");
assert.equal(result.access_state, "UNKNOWN_WORKSPACE");
assert.deepEqual(result.allowed_operations, [
  "FIRST_DOMAIN_CLAIM_READ",
  "FIRST_DOMAIN_CLAIM_RESERVE",
  "FIRST_DOMAIN_CLAIM_COMPLETE",
]);
assert.equal(await countActiveSessionsForSubject("unknown-sub"), 0);
assert.equal(await countOnboardingRowsForSubject("unknown-sub"), 1);
```

Prove personal/no-`hd` creates no onboarding row, and unknown flow upserts Identity by `(GOOGLE, https://accounts.google.com, sub)` while email/`hd` remain mutable metadata.

- [ ] **Step 2: Write mapping evaluator and JIT admission RED tests**

Cover these exact outcomes:

```text
ADMIN_GROUP match                         -> ADMIN, department NULL
multiple member signals, same department -> MEMBER, that department
two distinct member departments          -> ACCESS_MAPPING_CONFLICT + request capability
fresh active profile, no mapping          -> USER_NOT_PROVISIONED + request capability
never-observed subject                    -> USER_NOT_PROVISIONED
explicit DELETED/prior-present-now-absent -> USER_REMOVED
suspended                                 -> USER_SUSPENDED
no first generation                       -> DIRECTORY_SYNC_PENDING
expired generation                        -> DIRECTORY_STALE[_ACCESS_REQUEST_AVAILABLE]
```

Assert admission inserts/reactivates Membership and creates Session/SessionToken in one transaction. Assert Tenant A claims, mappings, and locators cannot create authority in Tenant B.

- [ ] **Step 3: Implement the versioned PostgreSQL evaluator and Web completion**

Add:

```sql
uptech.evaluate_google_directory_mapping_v1(uuid, uuid, text)
uptech.complete_web_google_login_directory_v2(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
)
uptech.complete_mobile_google_callback_directory_v2(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uuid
)
```

The evaluator joins the latest fresh published generation, profile Google subject, direct groups, stable OU ID resolved from the profile's OU path, and normalized Directory department. `ADMIN_GROUP` wins and yields null department; without it, every matched member mapping must converge on one department. Both completion routines lock User/Identity first, resolve tenant only from verified `hd`, preserve existing INVITE_ONLY behavior, and use the same JIT evaluator. Web creates no session on denial and commits the matching restricted capability before returning any capability-backed action state; Mobile emits only its existing denial handoff and no onboarding credential.

- [ ] **Step 4: Update repository types and strict row parsing**

```ts
export type GoogleLoginAccessState =
  | "UNKNOWN_WORKSPACE"
  | "USER_NOT_PROVISIONED"
  | "ACCESS_MAPPING_CONFLICT"
  | "USER_SUSPENDED"
  | "USER_REMOVED"
  | "DIRECTORY_SYNC_PENDING"
  | "DIRECTORY_STALE"
  | "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE"
  | "WORKSPACE_SUSPENDED";

export type GoogleLoginCompletionResult =
  | { readonly outcome: "NORMAL"; readonly route: "/admin" | "/home" }
  | { readonly outcome: "ONBOARDING"; readonly accessState: GoogleLoginAccessState; readonly allowedOperations: readonly string[]; readonly expiresAt: Date }
  | { readonly outcome: "DENIED"; readonly accessState: GoogleLoginAccessState };
```

Map each state to exactly the operation family specified by the migration and reject malformed rows. Do not infer route from client input; route comes from committed Membership role.

- [ ] **Step 5: Return usable onboarding results from the Google login service**

Remove the code that converts database `ONBOARDING` to `ACCESS_DENIED`. Continue generating raw session/CSRF/onboarding credentials before completion, but return only the credential corresponding to the committed outcome and zero/discard the others.

```ts
assert.equal(result.outcome, "ONBOARDING");
assert.equal(result.accessState, "UNKNOWN_WORKSPACE");
assert.equal(isCanonicalProof(result.onboardingCredential), true);
assert.equal(result.allowedOperations.includes("ACCESS_REQUEST_SUBMIT"), false);
```

- [ ] **Step 6: Set the correct browser cookie and route**

In the callback route, NORMAL sets only the normal session/CSRF cookies and redirects to the server-returned `/admin` or `/home`. ONBOARDING sets only `__Host-uptech_onboarding`, clears stale normal/setup cookies, and redirects to `/login` with allowlisted error code and request ID. DENIED sets no authority cookie.

- [ ] **Step 7: Prove freshness, revoke, logout, and isolation**

Extend integration tests for removed/suspended user, removed group, stale generation, session version bump, logout old-token denial, Member-to-Admin API denial, Sales-to-HR denial, HR-to-Sales denial, and Tenant-A-to-Tenant-B denial. Reuse existing permission and logout entrypoints; do not add bypasses.

- [ ] **Step 8: Run focused login/PostgreSQL tests and commit**

Run: `node --experimental-strip-types --test src/server/auth/google/repository.test.ts src/server/auth/google/service.test.ts src/server/auth/google/service.access-state.test.ts test/integration/google-workspace-bootstrap-postgres.test.ts`

Run: `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./test/next-alias-loader.mjs --test test/google-login-route-safety.test.ts`

Expected: PASS.

```bash
git add db/migrations/0009_google_workspace_tenant_bootstrap.sql db/verify/google_workspace_tenant_bootstrap.sql test/integration/google-workspace-bootstrap-postgres.test.ts src/server/auth/google/repository.ts src/server/auth/google/repository.test.ts src/server/auth/google/service.ts src/server/auth/google/service.test.ts src/server/auth/google/service.access-state.test.ts src/server/auth/google/runtime.ts src/app/api/v1/auth/google/callback/route.ts test/google-login-route-safety.test.ts
git commit -m "feat: admit mapped Workspace identities"
```

### Task 8: Capability-Aware Recovery Registry and Minimal Web Surfaces

**Files:**

- Create: `src/server/auth/recovery-actions.ts`
- Create: `src/server/auth/recovery-actions.test.ts`
- Modify: `src/server/http/problem.ts`
- Modify: `src/server/http/problem.test.ts`
- Modify: `src/server/auth/browser-authority.ts`
- Modify: `src/server/auth/browser-authority.test.ts`
- Modify: `src/server/auth/login-page-authority.ts`
- Modify: `src/server/auth/login-page-authority.test.ts`
- Modify: `src/server/auth/replacement-cookies.ts`
- Modify: `src/server/auth/replacement-cookies.test.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/auth/GoogleWorkspaceLogin.tsx`
- Create: `src/components/auth/LoginRecoveryActions.tsx`
- Create: `src/app/setup/provisioning/page.tsx`
- Create: `src/app/help/enterprise-login/page.tsx`
- Create: `src/app/help/google-workspace/domain-verification/page.tsx`
- Modify: `test/login-ui.test.mjs`
- Modify: `test/login-auth-safety.test.mjs`

**Interfaces:**

- Consumes: public state plus actual authenticated onboarding operation family.
- Produces: closed `RecoveryActionId`, fixed descriptors, localized copy, and action-bearing `ProblemDocument`.
- Produces: existing login card with state-specific buttons and a separate provisioning-only page.
- Guarantees: no URL/method/role/workspace action comes from query parameters or provider messages.

- [ ] **Step 1: Write exhaustive registry RED tests**

```ts
for (const state of ALL_PUBLIC_LOGIN_STATES) {
  const resolved = resolveRecoveryActions({ state, authority });
  assert.ok(resolved.length >= 1 && resolved.length <= 2);
  assert.ok(resolved.every(action => RECOVERY_ACTION_IDS.has(action.id)));
}
assert.deepEqual(resolveRecoveryActions({ state: "UNKNOWN_WORKSPACE", authority: firstClaim }), [
  action("START_ORGANIZATION_SETUP"),
  action("SWITCH_GOOGLE_ACCOUNT"),
]);
assert.equal(resolveRecoveryActions({ state: "USER_NOT_PROVISIONED", authority: null }).some(action => action.id === "SUBMIT_ACCESS_REQUEST"), false);
```

Add a table-driven test for every state/action pair in section 12 of the spec, including base versus `_ACCESS_REQUEST_AVAILABLE` variants and bootstrap versus employee sync-pending variants.

- [ ] **Step 2: Implement the closed registry**

```ts
export type RecoveryActionId =
  | "START_NORMAL_LOGIN"
  | "START_NORMAL_LOGIN_AFTER_COOLDOWN"
  | "SWITCH_GOOGLE_ACCOUNT"
  | "START_ORGANIZATION_SETUP"
  | "RESTART_DIRECTORY_CONSENT"
  | "CHECK_BOOTSTRAP_STATUS"
  | "RETRY_DIRECTORY_SYNC"
  | "FINISH_BOOTSTRAP"
  | "EXIT_ONBOARDING"
  | "SUBMIT_ACCESS_REQUEST"
  | "OPEN_ENTERPRISE_LOGIN_HELP"
  | "OPEN_DOMAIN_VERIFICATION_HELP"
  | "COPY_SUPER_ADMIN_INSTRUCTIONS"
  | "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"
  | "CONTACT_UPTECH"
  | "COPY_REQUEST_ID";
```

Descriptors contain fixed `method`, `path`, and localized label. Capability-backed IDs require an exact operation-family match; otherwise select the safe base variant. `CONTACT_UPTECH` fixes recipient `contact@uptech.vn` and permits only public code/request ID in the body.

- [ ] **Step 3: Extend safe problems without trusting redirect action IDs**

```ts
export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly request_id: string;
  readonly recovery_actions: readonly RecoveryActionId[];
}
```

The login page accepts only allowlisted error code/request UUID from query, authenticates the onboarding cookie server-side, and resolves actions again. Ignore every `action`, `returnUrl`, domain, email, tenant, or workspace query value.

- [ ] **Step 4: Stop retiring valid onboarding cookies**

Update `inspectBrowserAuthority` so a valid onboarding context returns `activeKind: "ONBOARDING"` without a clearing header. Clear duplicate, malformed, expired, revoked, wrong-family, and simultaneous normal/onboarding cookies. The normal login transaction POST must reject an active onboarding authority unless the fixed action is switch/logout.

- [ ] **Step 5: Implement UI actions without changing the visual shell**

Keep the existing background, logo, card width, typography scale, header, privacy disclosure, and spacing classes. Replace the single hard-coded action form with `LoginRecoveryActions`, which renders fixed POST forms/links/clipboard actions in the existing button styles. Include request ID, loading/disabled states, double-submit protection, clipboard selectable fallback, and mail-handler fallback.

```tsx
<LoginRecoveryActions
  actions={actions}
  csrfToken={csrfToken}
  requestId={requestId}
  locale={locale}
/>
```

- [ ] **Step 6: Add the provisioning and static help pages**

`/setup/provisioning` authenticates only status onboarding authority, renders `DIRECTORY_BOOTSTRAP_SYNC_PENDING`, retryable/support-required, or READY, and exposes only check/retry/finish/logout actions. It contains no Admin/Home navigation or Directory records. Help pages contain fixed account/domain steps and exact allowlisted links; they accept no dynamic HTML or destination.

- [ ] **Step 7: Run UI/security tests and commit**

Run: `npm run test:login-ui`

Run: `node --experimental-strip-types --test src/server/auth/recovery-actions.test.ts src/server/http/problem.test.ts src/server/auth/browser-authority.test.ts src/server/auth/login-page-authority.test.ts src/server/auth/replacement-cookies.test.ts`

Expected: PASS and login shell snapshot/safety assertions remain unchanged outside state copy/actions.

```bash
git add src/server/auth/recovery-actions.ts src/server/auth/recovery-actions.test.ts src/server/http/problem.ts src/server/http/problem.test.ts src/server/auth/browser-authority.ts src/server/auth/browser-authority.test.ts src/server/auth/login-page-authority.ts src/server/auth/login-page-authority.test.ts src/server/auth/replacement-cookies.ts src/server/auth/replacement-cookies.test.ts src/app/login/page.tsx src/components/auth/GoogleWorkspaceLogin.tsx src/components/auth/LoginRecoveryActions.tsx src/app/setup/provisioning/page.tsx src/app/help/enterprise-login/page.tsx src/app/help/google-workspace/domain-verification/page.tsx test/login-ui.test.mjs test/login-auth-safety.test.mjs
git commit -m "feat: add actionable enterprise login denials"
```

### Task 9: Mobile Web-Setup Handoff and Recovery Actions

**Files:**

- Modify: `src/server/auth/mobile/protocol.ts`
- Modify: `src/server/auth/mobile/protocol.test.ts`
- Modify: `src/server/auth/mobile/google-repository.ts`
- Modify: `src/server/auth/mobile/google-repository.test.ts`
- Modify: `src/server/auth/mobile/google-service.ts`
- Modify: `src/server/auth/mobile/google-service.test.ts`
- Modify: `src/server/auth/mobile/http.ts`
- Modify: `src/server/auth/mobile/http.test.ts`
- Modify after repository preflight: `../mobile/lib/features/auth/domain/auth_state.dart`
- Modify after repository preflight: `../mobile/lib/features/auth/data/auth_api.dart`
- Modify after repository preflight: `../mobile/lib/features/auth/application/auth_controller.dart`
- Modify after repository preflight: `../mobile/lib/features/auth/presentation/login_screen.dart`
- Modify after repository preflight: `../mobile/test/a3_auth_controller_test.dart`
- Modify after repository preflight: `../mobile/test/a3_login_screen_test.dart`
- Modify after repository preflight: `../mobile/test/a3_system_browser_channel_test.dart`
- Modify after repository preflight: `../mobile/test/api_error_test.dart`

**Interfaces:**

- Consumes: server-selected public state/recovery action IDs.
- Produces: strict mobile DTO/state with allowlisted `web_setup_url` for unknown Workspace only.
- Guarantees: mobile receives no Directory OAuth code/token, onboarding credential, customer ID, tenant ID, domain list, role, or department.

- [ ] **Step 1: Resolve the Mobile source-control boundary before editing**

Run:

```powershell
$mobileRepo = git -C ..\mobile rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($mobileRepo)) { throw 'Authoritative Mobile Git repository is required before Mobile edits.' }
git -C $mobileRepo status --short --branch
```

Expected: both commands identify the authoritative Mobile repository and a reviewable working tree. At planning time this preflight fails because `D:\uptech-knowledge\mobile` has no `.git` and is outside the Web repository. If it still fails during implementation, stop only the Mobile portion, request the authoritative Mobile repository location/linkage once, and continue the independently versioned Web/server tasks. Do not initialize a new repository, move Mobile into Web, or edit an unversioned release tree by assumption.

- [ ] **Step 2: Write strict DTO and controller RED tests**

```dart
expect(result.category, AccessStateCategory.unknownWorkspace);
expect(result.recoveryActions, const [
  RecoveryActionId.openWorkspaceSetupInBrowser,
  RecoveryActionId.switchGoogleAccount,
]);
expect(result.webSetupUri, Uri.parse('https://uptech-knowledge-sigma.vercel.app/login?intent=workspace_setup'));
```

Reject HTTP setup URLs, wrong hosts/ports/paths, credentials/fragments, unknown action IDs, duplicate actions, extra JSON keys, and any response containing Directory or tenant authority fields.

- [ ] **Step 3: Extend the server mobile problem contract**

Switch the mobile repository to `complete_mobile_google_callback_directory_v2`. For mobile unknown workspace, return fixed actions `OPEN_WORKSPACE_SETUP_IN_BROWSER` and `SWITCH_GOOGLE_ACCOUNT` plus a URL built from configured `appOrigin` and exact `/login?intent=workspace_setup`. Do not transfer Web onboarding authority; the system browser performs a new normal Google login.

```ts
{
  code: "UNKNOWN_WORKSPACE",
  request_id: requestId,
  recovery_actions: ["OPEN_WORKSPACE_SETUP_IN_BROWSER", "SWITCH_GOOGLE_ACCOUNT"],
  web_setup_url: new URL("/login?intent=workspace_setup", appOrigin).href,
}
```

- [ ] **Step 4: Implement Dart action parsing and execution**

Add `RecoveryActionId` as a closed enum and store the parsed actions/optional setup URI in `AuthAccessDenied`. `auth_controller.dart` opens the approved URI through the existing system-browser channel, while switch/retry clears only transient auth state and starts a fresh mobile OIDC transaction.

- [ ] **Step 5: Keep the mobile visual layout and add reason-specific buttons**

Retain the current `AuthAccessStateScreen` structure, typography, spacing, and support fallback. Render only server-approved actions. Unknown organization shows **Thiết lập tổ chức bằng trình duyệt** and **Đăng nhập bằng tài khoản khác**; mapping conflict, stale data, suspended/removed user, rate limit, and provider failure use the exact copy/action classes from the spec. Super Admin/delegated-admin consent outcomes remain Web-only because Mobile never receives Directory consent authority.

- [ ] **Step 6: Run scoped server and Flutter tests, then commit in their owning repositories**

Run: `node --experimental-strip-types --test src/server/auth/mobile/protocol.test.ts src/server/auth/mobile/google-repository.test.ts src/server/auth/mobile/google-service.test.ts src/server/auth/mobile/http.test.ts`

Run from the authoritative Mobile repository: `flutter test test/a3_auth_controller_test.dart test/a3_login_screen_test.dart test/a3_system_browser_channel_test.dart test/api_error_test.dart`

Expected: PASS.

```powershell
git add src/server/auth/mobile/protocol.ts src/server/auth/mobile/protocol.test.ts src/server/auth/mobile/google-repository.ts src/server/auth/mobile/google-repository.test.ts src/server/auth/mobile/google-service.ts src/server/auth/mobile/google-service.test.ts src/server/auth/mobile/http.ts src/server/auth/mobile/http.test.ts
git commit -m "feat: add mobile Workspace setup handoff"

$mobileRepo = git -C ..\mobile rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($mobileRepo)) { throw 'Authoritative Mobile Git repository is required before Mobile commit.' }
git -C $mobileRepo add lib/features/auth/domain/auth_state.dart lib/features/auth/data/auth_api.dart lib/features/auth/application/auth_controller.dart lib/features/auth/presentation/login_screen.dart test/a3_auth_controller_test.dart test/a3_login_screen_test.dart test/a3_system_browser_channel_test.dart test/api_error_test.dart
git -C $mobileRepo commit -m "feat: add Workspace setup recovery actions"
```

Record both commit SHAs for the release report.

### Task 10: Migration Deployment Contract, Reproducible Browser Harness, and Existing Zero-Input Cron

**Files:**

- Modify: `scripts/apply-safe-google-access-states.mjs`
- Create: `scripts/run-google-workspace-bootstrap-browser.mjs`
- Modify: `test/safe-google-access-states-deploy-contract.test.mjs`
- Modify: `test/production-deploy-contract.test.mjs`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `vercel.json`
- Create: `docs/operations/google-workspace-tenant-bootstrap-production-runbook.md`

**Interfaces:**

- Consumes: immutable migration `0009`, its verifier, and existing `/api/internal/cron/google-directory` zero-input worker route.
- Produces: idempotent production migration detection/application, a disposable browser-login harness, and a Vercel schedule that provides no tenant/job authority.
- Guarantees: migration-owner URL is migration-only; runtime remains non-superuser/NOBYPASSRLS.

- [ ] **Step 1: Write deployment-contract RED tests**

```js
assert.match(script, /0009_google_workspace_tenant_bootstrap\.sql/u);
assert.match(script, /google_workspace_tenant_bootstrap\.sql/u);
assert.deepEqual(vercel.crons, [{ path: "/api/internal/cron/google-directory", schedule: "* * * * *" }]);
assert.equal(source.includes("/api/v1/onboarding/google-workspace/callback"), true);
```

Also assert the migration script skips `0009` only when a definitive bootstrap routine/catalog marker exists, holds one release advisory lock, runs the new verifier, never reads `DATABASE_URL` as migration-owner fallback, and does not print connection strings or environment values.

- [ ] **Step 2: Extend the approved migration runner**

Read `0009` and `db/verify/google_workspace_tenant_bootstrap.sql`, add a preflight marker for `uptech.complete_google_workspace_bootstrap_v1`, apply `0009` once under `uptech_migration_owner`, run both enterprise and bootstrap verifiers, and preserve the existing transaction timeouts/rollback behavior.

Expose the focused local commands:

```json
"test:postgres:bootstrap": "node --experimental-strip-types --test test/integration/google-workspace-bootstrap-postgres.test.ts",
"test:browser:bootstrap": "node scripts/run-google-workspace-bootstrap-browser.mjs"
```

- [ ] **Step 3: Schedule only the existing cron route**

Add to `vercel.json` without changing the existing Git deployment policy or headers:

```json
"crons": [
  {
    "path": "/api/internal/cron/google-directory",
    "schedule": "* * * * *"
  }
]
```

The route continues to require `CRON_SECRET`, use production-only checks, and call the zero-input worker. No request field may select tenant, connector, job, or lease.

- [ ] **Step 4: Add the reproducible disposable browser harness**

Create `scripts/run-google-workspace-bootstrap-browser.mjs` using the existing disposable-login harness conventions: require `UPTECH_TEST_DATABASE_URL` plus Google client metadata from environment, reject a database whose name does not start with `uptech_phase1_test`, create a temporary `NOBYPASSRLS` runtime login, start the built Next server behind the existing trusted-header test proxy, set `LOGIN_TEST_BASE_URL`, run the tracked login UI/auth-safety files, and always terminate the server/proxy plus drop the temporary role in `finally`.

The harness must not print environment values and must not import or modify the user-owned untracked `scripts/run-disposable-browser-login.mjs`. Add deployment-contract assertions that the tracked harness contains the disposable-database guard, runtime `NOBYPASSRLS`, bounded child cleanup, and only the tracked test paths.

- [ ] **Step 5: Update non-secret metadata documentation**

Keep the existing GCP/WIF/Secret Manager environment names. Add the exact bootstrap callback alongside the post-tenant callback in `.env.example` comments:

```text
https://uptech-knowledge-sigma.vercel.app/api/v1/onboarding/google-workspace/callback
```

Do not add any actual ID, token, secret, database URL, or service-account credential.

Write `docs/operations/google-workspace-tenant-bootstrap-production-runbook.md` with the exact migration-owner separation, callback registration, exact-commit deployment check, Super Admin consent, zero-input worker trigger, READY/login/logout smoke, old-session denial, rollback boundary, and redacted-log inspection used in Task 11.

- [ ] **Step 6: Run deployment-contract tests and commit**

Run: `npm run test:deploy-contract`

Run: `node --experimental-strip-types --experimental-loader ./test/next-alias-loader.mjs --test test/google-directory-cron-route.test.ts`

Expected: PASS.

```bash
git add scripts/apply-safe-google-access-states.mjs scripts/run-google-workspace-bootstrap-browser.mjs test/safe-google-access-states-deploy-contract.test.mjs test/production-deploy-contract.test.mjs .env.example package.json vercel.json docs/operations/google-workspace-tenant-bootstrap-production-runbook.md
git commit -m "chore: ship tenant bootstrap migration and cron"
```

### Task 11: Full Verification, Exact-Commit Release, and Real Workspace Smoke

**Files:**

- Verify only: all Web/server files committed by Tasks 1–10 and the separately recorded Mobile commit from Task 9
- Follow: `docs/operations/google-workspace-tenant-bootstrap-production-runbook.md`
- Do not modify: the Login visual shell, migrations `0001`–`0008`, production data outside migration `0009`, or user-owned untracked files

**Interfaces:**

- Consumes: complete implementation and approved external GCP/Vercel/Google Workspace access.
- Produces: one pushed Web `main` commit chain, one recorded Mobile commit in its authoritative repository, one safely applied production migration, one exact production deployment, and one bounded real login/logout smoke.
- Exit rule: any failure returns to the owning task for one root-cause fix and focused re-verification; never declare PASS from an unrun gate.

- [ ] **Step 1: Review the scoped diff and secret hygiene**

Run:

```powershell
git status --short --branch
git diff origin/main...HEAD --check
git diff origin/main...HEAD --name-only
rg -n --hidden -g '!node_modules' -g '!.next' -g '!*.test.*' -g '!docs/**' '(postgres(?:ql)?://|ya29\.|-----BEGIN [A-Z ]+PRIVATE KEY-----|client_secret\s*[=:]\s*[^r])' .
```

Then resolve the Mobile repository as in Task 9 and run the same status/diff review there. Expected: only scoped source/test/migration/docs changes in each owning repository; no `.env`, database URL, OAuth token/code, private key, refresh token, SecretReference, temporary artifact, or unrelated feature file. The three pre-existing Web user-owned untracked files remain unstaged.

- [ ] **Step 2: Run disposable PostgreSQL and verifier gates**

With `UPTECH_TEST_DATABASE_URL` set outside Git to a database named `uptech_phase1_test*`, run:

```powershell
npm run test:postgres:bootstrap
npm run test:postgres:enterprise
psql $env:UPTECH_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f db/verify/google_workspace_tenant_bootstrap.sql
```

Expected: PASS for migrations `0001`–`0009`, atomic bootstrap, locked reconciliation, cross-tenant/RLS, mapping, freshness, revoke, and logout. Never substitute `DATABASE_URL` or a production URL.

- [ ] **Step 3: Run server, route, UI, and build gates once**

```powershell
npm run test:security
npm run test:login-routes
npm run test:login-ui
npm run test:deploy-contract
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0. The login UI safety tests confirm the original shell/media/layout remains and only state copy/actions changed.

- [ ] **Step 4: Run Mobile gates once**

From the authoritative Mobile repository resolved in Task 9:

```powershell
flutter analyze
flutter test
flutter build apk --release
```

Expected: analyze/test/build exit 0 and no Directory/onboarding credential is present in app state, logs, deep links, or the APK configuration. Record the Mobile full commit SHA alongside the Web SHA.

- [ ] **Step 5: Run one browser-backed login/onboarding verification**

With the disposable database and Google client metadata set outside Git, run the tracked harness:

```powershell
npm run test:browser:bootstrap
```

Expected: the harness starts the built app with a temporary `NOBYPASSRLS` role, runs all tracked browser-backed login tests with `LOGIN_TEST_BASE_URL`, and cleans up its server/proxy/role. Personal account denial, unknown Workspace setup button, capability-aware reasons/actions, callback, provisioning states, and account-switch/logout controls render without redirect loops.

- [ ] **Step 6: Confirm exact commit and push main**

```powershell
git status --short --branch
git log -1 --format='%H'
git push origin main
```

Expected: all scoped Web changes are committed, only the known user-owned untracked files remain, and Web `origin/main` resolves to the recorded full SHA. Confirm the separately recorded Mobile commit is pushed to its configured release branch before claiming Mobile delivery.

- [ ] **Step 7: Verify production metadata without exposing values**

In GCP/Vercel/Google consoles, follow the runbook and confirm:

```text
Admin SDK Directory API: enabled
Secret Manager API: enabled
IAM Credentials API: enabled
Vercel OIDC -> dedicated keyless service account: active
Secret Manager IAM: least privilege
UPTECH_GCP_SECRET_MANAGER_PROJECT_ID: present in Production
UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER: present in Production
UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL: present in Production
CRON_SECRET: present in Production
Bootstrap callback URI: exact and registered
```

Do not copy any value, token, database URL, private key, password, or MFA response into chat, Git, terminal output, or logs.

- [ ] **Step 8: Apply production migration exactly once**

Provide the migration-owner credential only to the approved migration process, run `npm run migrate:login:production`, and verify `uptech.complete_google_workspace_bootstrap_v1` plus the new verifier. Immediately remove migration-owner credential access from the runtime/build environment and confirm the runtime role remains ordinary non-superuser `NOBYPASSRLS`.

Expected: `0009` applied once; no destructive suite ran against production; no old migration was edited or replayed.

- [ ] **Step 9: Deploy the exact pushed commit**

Create a staged Production deployment from the clean pushed `main` SHA with custom-domain assignment disabled. Verify deployment metadata reports that exact SHA, the production deploy contract passes, `/san-pham`, `/nguyen-tac`, `/nang-luc`, and `/quy-trinh` respond correctly, and the login background video/poster load. Only then promote that exact staged deployment to the production domain. Never run `vercel --prod`/`vercel deploy --prod`, and do not promote a build from another branch, dirty directory, or different commit.

- [ ] **Step 10: Run one real Super Admin bootstrap smoke**

Using an approved test customer organization not already registered:

```text
/login
-> Google Workspace Super Admin account
-> UNKNOWN_WORKSPACE with setup action
-> separate Directory consent
-> same sub + isAdmin=true + exact customer/domains verified
-> provisioning-only page
-> existing cron/zero-input worker invocation
-> READY after first complete published generation
-> fresh normal Google login
-> exact tenant Initial OWNER
-> /admin
```

Also confirm a delegated-only/employee setup attempt is denied with the correct reason/action, and a mapped employee enters `/home` with only their configured department.

- [ ] **Step 11: Logout, deny the old session, and inspect redacted logs**

Logout the real Workspace account, then replay the old session credential only through the normal session endpoint and require `401 SESSION_REVOKED` or `401 SESSION_EXPIRED`. Inspect Vercel/GCP logs by request ID and confirm they contain no OAuth code, access/refresh token, cookie, PKCE verifier, database URL, secret value, or SecretReference.

- [ ] **Step 12: Report the release result without an empty commit**

If all gates pass, report exact commit SHA, migration/deployment IDs that are non-secret, bootstrap generation readiness, Owner/Admin/Member routes, logout denial, UI unchanged, and remaining blockers `NONE`. If any gate fails, report the exact failing command/state and root cause; make the smallest scoped fix in its owning task, commit it, rerun only the affected gate plus final build/smoke, and update the deployed exact SHA. Do not create an empty “verification” commit.
