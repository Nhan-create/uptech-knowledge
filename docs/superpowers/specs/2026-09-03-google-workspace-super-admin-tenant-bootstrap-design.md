# Google Workspace Super Admin Tenant Bootstrap Design

**Status:** Chat design approved; written specification pending user review

**Date:** 2026-09-03
**Scope:** Google Workspace Super Admin bootstrap, first Directory synchronization, mapped employee admission, and recovery actions for this flow only

## 1. Outcome

An organization whose verified Google Workspace domain is not yet registered in UPTECH can be created safely by a Google Workspace **Super Administrator of that customer organization**.

The Google administrator is not an UPTECH platform administrator. Successful proof authorizes one exceptional operation only: create one UPTECH workspace and its first `OWNER`. All later `OWNER`, `ADMIN`, `MEMBER`, department, resource, and route authority remains UPTECH authority.

The completed flow is:

```text
Normal Google OIDC login
  -> no verified hosted domain (`hd`)              -> deny personal account
  -> known verified domain                         -> existing login flow
  -> unknown verified hosted domain                -> pre-tenant onboarding
       -> separate Google Directory consent
       -> same Google `sub` and `hd`
       -> Directory User `isAdmin = true`
       -> stable Google customer ID
       -> verified primary/secondary domains and aliases
       -> atomic workspace + Initial Owner + connector creation
       -> first Directory job
       -> provisioning-only status
       -> fresh generation published
       -> fresh normal login
       -> `/admin`
```

A mapped employee is admitted only when a fresh published Directory generation proves that the employee is active and exactly one unambiguous UPTECH mapping resolves their authority. An active Google Workspace account without a mapping is denied.

## 2. Explicit product decisions

1. A personal Google account without a server-verified `hd` claim cannot use enterprise login.
2. The first hosted-domain user does not automatically become an owner.
3. Only `isAdmin === true` proves Super Administrator eligibility for first-tenant creation.
4. `isDelegatedAdmin === true` with `isAdmin !== true` is insufficient in V1.
5. The normal login flow keeps `openid email profile`; Directory authorization is a separate consent transaction.
6. Google `sub`, not email, is the durable identity key.
7. Google `customerId`, not the current primary domain, is the durable organization key.
8. No domain is accepted from a browser form. Domains come only from verified Admin SDK results.
9. Every verified domain or alias claimed during bootstrap must belong to the same Google customer. Any conflict aborts the complete transaction.
10. New self-service workspaces use the existing database policy literal `GOOGLE_GROUP_CONTROLLED`, which is the compatibility representation of the product concept `DIRECTORY_CONTROLLED`. No second policy authority is introduced.
11. Before the first complete, fresh generation is published, no normal product session or dashboard access is issued.
12. After the first generation is ready, the creator must perform a fresh normal Google login. The setup callback never becomes a normal application session.
13. A mapped active Directory user may be admitted just in time as `MEMBER`, or as `ADMIN` only through an explicit UPTECH admin-group mapping. Google administrator flags never provide later UPTECH role authority.
14. No Dashboard, Search, Documents, RAG, Drive, or UPTECH platform-admin feature is part of this change.

## 3. Existing foundations to reuse

The implementation must extend, not replace, these existing authorities:

- `users` and `identities`, including global `(provider, issuer, provider_subject)` uniqueness;
- `onboarding_sessions` and its existing `FIRST_DOMAIN_CLAIM_*` and `ACCESS_REQUEST_*` operation names;
- `workspaces`, `workspace_domain_locators`, and the unique `google_customer_id` binding;
- `workspace_memberships` and roles `OWNER`, `ADMIN`, and `MEMBER`;
- `connectors`, one-live-Directory-connector invariant, and opaque `credential_reference`;
- `service_actors`, `sync_jobs`, worker leases/fences, staging, and atomic Directory generation publication;
- `people_profiles`, groups, group memberships, OU data, permission mappings, freshness, and revoke behavior;
- `SecretAdapter` and the registered Google Cloud Secret Manager adapter;
- existing audit relations, request IDs, session versioning, Permission Engine, and RLS boundaries;
- existing Web and Mobile Google OIDC verification.

The deployment-time `create_initial_owner_bootstrap_v1` routine is not the runtime solution. It assumes a pre-created `PENDING` workspace and a pre-verified locator, is intentionally unavailable to runtime roles, and does not prove Google Super Administrator authority. Its atomic mechanics may guide the new routine, but its authority must remain unchanged.

The current authenticated Directory-consent flow also remains separate. It requires an existing active tenant session and `OWNER` or `ADMIN`, so using it for an unknown tenant would create a circular dependency.

## 4. Current gaps

The additive implementation closes only these gaps:

1. The current `UNKNOWN_WORKSPACE` result is synthetic; it does not persist a usable pre-tenant onboarding capability and the Web callback deliberately discards it.
2. There is no consent transaction that can operate before a tenant exists.
3. The Directory provider does not call `domains.list` and its exact scope set omits `https://www.googleapis.com/auth/admin.directory.domain.readonly`.
4. No runtime routine can atomically consume Google Super Admin proof and create the workspace, verified locators, Initial Owner, connector, worker actor, and first job.
5. Directory publication updates existing memberships but does not admit a newly mapped employee at login.
6. Several Directory denials collapse to a generic result, preventing reason-specific recovery actions.
7. Existing onboarding operation names reserve access-request behavior, but no request persistence exists.
8. A setup creator has no narrow status-only authority while the first generation is pending.

Because `0008_google_directory_production.sql` has already been deployed, it is immutable. All database changes belong in an additive `0009_google_workspace_tenant_bootstrap.sql` migration and a matching verifier.

## 5. Trust and authority boundaries

### 5.1 Browser and mobile clients

Clients may choose an action and present opaque credentials. They never supply trusted values for:

- workspace or tenant ID;
- Google customer ID;
- hosted, primary, secondary, or alias domain;
- role or department;
- Google Super Admin status;
- connector or worker identity;
- secret reference;
- provider subject.

All action destinations are server-owned allowlisted routes. Arbitrary `returnUrl`, callback, or external redirect values are rejected.

### 5.2 Normal OIDC boundary

The existing server flow continues to validate state, nonce, PKCE, signature, issuer, audience/authorized party, expiry, issued-at, exact `email_verified`, `hd`, and `sub`.

An unknown hosted domain results in a persisted, hashed, expiring `onboarding_sessions` capability. The application server generates the raw random credential, stores only its hash through the database routine, and sends the raw value only as the cookie. This unknown-organization capability:

- is bound to the server-verified Google Identity/User;
- contains no workspace, membership, role, or product-session authority;
- exposes only `FIRST_DOMAIN_CLAIM_READ`, `FIRST_DOMAIN_CLAIM_RESERVE`, and `FIRST_DOMAIN_CLAIM_COMPLETE`;
- expires within the existing maximum of 30 minutes;
- is one-time for bootstrap completion;
- is stored in `__Host-uptech_onboarding` as a Secure, HttpOnly, SameSite cookie.

A known-tenant user who is denied for missing, conflicting, or stale Directory provisioning receives a different restricted capability only when the server atomically commits it and returns the matching access-request action variant. It is bound server-side to the resolved workspace through `resource_workspace_id`, exposes only `ACCESS_REQUEST_READ` and `ACCESS_REQUEST_SUBMIT`, expires within 30 minutes, and grants no tenant data, membership, session, role, or department authority. Without that committed capability the server returns a non-privileged fallback action set. The two operation families are never combined in one capability.

A post-bootstrap status capability is a third, disjoint form. The initial one is created only by the successful atomic bootstrap transaction; a replacement may be created only by the narrow fresh-OIDC reissuance routine in section 9. Both are bound to the new workspace and exact Initial Owner identity, expose only `DIRECTORY_BOOTSTRAP_STATUS_READ` and `DIRECTORY_BOOTSTRAP_SYNC_RETRY`, and may live for at most 24 hours.

### 5.3 Directory proof boundary

The server exchanges the separate consent code and constructs an in-memory, non-JSON-forgeable verified grant. Only that server-sealed grant reaches the bootstrap service. Raw browser JSON can never masquerade as Directory evidence.

### 5.4 Database boundary

A narrow `SECURITY DEFINER` completion routine revalidates the hashed onboarding capability and its Identity/User before creating any tenant state. Direct table privileges remain revoked from API and worker runtime roles. Tenant-owned new state uses forced RLS and narrow routines.

## 6. Pre-tenant bootstrap flow

### 6.1 Unknown workspace result

When normal OIDC verifies a hosted-domain account but no `VERIFIED` locator exists:

1. ensure the global User/Identity exists using `(GOOGLE, https://accounts.google.com, sub)`;
2. update email and `hd` only as mutable verified metadata;
3. have the application server generate a raw onboarding credential, pass only its hash to the transaction, and persist the active onboarding session;
4. commit the login transaction as `ONBOARDING`, not as a normal session;
5. return `UNKNOWN_WORKSPACE` and the existing first-domain-claim operations;
6. set only the onboarding cookie and redirect to the existing login card in unknown-organization state.

No workspace, membership, session, connector, or role is created here.

### 6.2 Start setup

The primary **Thiết lập tổ chức mới** button performs a same-origin POST to this dedicated endpoint:

```text
POST /api/v1/onboarding/google-workspace/transactions
```

The handler:

- authenticates exactly one onboarding cookie;
- requires `FIRST_DOMAIN_CLAIM_RESERVE`;
- rejects any simultaneous Web session or second onboarding authority;
- verifies the exact same-origin request and a CSRF value derived server-side from the opaque onboarding credential and the existing session pepper;
- applies existing rate limits;
- creates fresh state, nonce, and PKCE;
- seals a dedicated short-lived setup transaction cookie;
- binds the transaction to onboarding identity ID, Google `sub`, verified email, verified `hd`, and expiry;
- redirects only to the exact approved Google authorization origin.

### 6.3 Separate consent

The consent request uses:

```text
openid
email
profile
https://www.googleapis.com/auth/admin.directory.customer.readonly
https://www.googleapis.com/auth/admin.directory.domain.readonly
https://www.googleapis.com/auth/admin.directory.user.readonly
https://www.googleapis.com/auth/admin.directory.group.readonly
https://www.googleapis.com/auth/admin.directory.orgunit.readonly
```

It uses Authorization Code + PKCE, `access_type=offline`, a fresh consent/account-selection prompt, and exact-scope validation.

The successful OAuth response must contain exactly eight scopes in total after one narrow canonicalization: Google's `https://www.googleapis.com/auth/userinfo.email` and `https://www.googleapis.com/auth/userinfo.profile` response aliases normalize to `email` and `profile`; `openid` and all five Directory scope URIs must otherwise match literally. Duplicate values before or after canonicalization, missing values, and additional values fail validation. The connector persists only the exact five canonical Directory URIs; OIDC scopes are never stored as connector authority.

Scope compatibility is explicit:

- the existing four scopes remain the exact legacy Directory-sync set;
- the domain-readonly scope produces the exact five-scope bootstrap set;
- every new bootstrap and every new/re-authorized connector must grant the five-scope set;
- a connector that was already persisted with the exact legacy four-scope set remains valid for its existing sync until it is re-authorized;
- worker/database checks accept only the exact legacy set or exact five-scope set, require the original four scopes in both cases, and reject every unknown scope;
- bootstrap completion accepts only the exact five-scope set.

The migration must not claim or backfill a scope that Google did not grant.

The callback is separate from both employee login and post-tenant connector consent:

```text
GET /api/v1/onboarding/google-workspace/callback
```

### 6.4 Callback verification

The callback rejects unless all evidence is present and consistent:

1. state, nonce, PKCE, code shape, issuer, audience, time, and exact scopes are valid;
2. callback OIDC `sub`, normalized email, and `hd` match the onboarding transaction;
3. `users.get` for the consenting account returns the same immutable Google user ID as OIDC `sub`;
4. the Directory user is active, not suspended or archived;
5. `isAdmin === true`;
6. `customers/my_customer` returns a valid stable customer ID and primary domain;
7. the Directory User `customerId` equals the customer response ID;
8. `domains.list(customerId)` completes successfully;
9. exactly one primary domain exists and is positively verified;
10. a secondary domain is accepted only from a `Domain` resource with `verified=true`, and an alias is accepted only when returned by Google under such a verified Domain resource;
11. the original OIDC `hd` appears in that positively verified domain/alias set;
12. users, groups, and OU read probes complete successfully; group-member probing is required only when at least one group exists, so a successful zero-group organization is valid;
13. a refresh token is present and remains only in server memory until secret creation.

The normalized `customerDomain` returned by `customers/my_customer` must equal the sole verified `PRIMARY` result from `domains.list`. The provider returns a deterministically sorted, bounded list of:

```text
{
  normalizedDomain,
  kind: PRIMARY | SECONDARY | ALIAS,
  providerParentDomain: null | normalized verified parent domain,
  verified: true
}
```

`providerParentDomain` is null for primary/secondary `Domain` resources and required for aliases. The list contains at most 1,000 unique lower-case ASCII domains, each at most 253 characters, and at most 256 KiB of normalized domain plus provenance bytes in total. Normalization, sorting, and deduplication are repeated in PostgreSQL before insertion. Invalid names, duplicate names with conflicting kinds or parents, more than one primary, a primary inconsistent with `customerDomain`, a missing verified primary, or a response beyond either bound denies bootstrap. No user-entered domain is merged into that list.

## 7. Secret lifecycle and atomic completion

Google Secret Manager and PostgreSQL cannot participate in one physical transaction. A database connection can also disappear after PostgreSQL commits but before the application receives the success response. The service therefore treats an unknown commit outcome differently from a proven rollback.

Before writing either system, the application server generates:

- one stable bootstrap-attempt UUID sealed into the setup transaction;
- the candidate workspace UUID;
- a new raw status credential and its hash, distinct from the source first-domain-claim credential and every known credential hash.

It then uses this lifecycle:

1. Call a narrow database prepare routine before creating a provider secret. It acquires the attempt lock, validates the source capability, and inserts an idempotent `PREPARED` attempt bound to source/status hashes, candidate workspace, identity, and a ten-minute completion deadline. It creates no tenant authority and does not consume the source capability.
2. Create the refresh-token secret through the existing `SecretAdapter`, labeled with candidate workspace UUID, bootstrap-attempt UUID, service identity, purpose, and request ID.
3. Receive only an opaque `SecretReference`.
4. Call the database completion routine with bootstrap-attempt UUID, source onboarding credential hash, new status credential hash, server-verified identifiers/domains, opaque reference, exact five Directory scopes, and request ID.
5. Acquire the same transaction-scoped attempt lock, require the attempt to remain `PREPARED` and unexpired, then atomically commit all UPTECH state, the consumed source capability, the new status capability, a `COMMITTED` attempt transition, and a non-authoritative bootstrap receipt.
6. Only after a confirmed commit or a successful committed-attempt reconciliation, replace `__Host-uptech_onboarding` with the raw status credential and clear the setup transaction cookie.
7. Zero every access-token, refresh-token, and transient raw-credential buffer as soon as its required lifecycle action is complete.

The bootstrap-attempt UUID is idempotency and reconciliation identity, not browser authority. A consumed OAuth code and setup transaction never mint a second bootstrap attempt or a second candidate secret.

If the prepare response is lost, the service retries only the same prepare call with the same bindings; it does not create the provider secret until `PREPARED` is confirmed. A mismatched retry is denied.

If provider-secret creation fails, the service calls the narrow abort routine for the still-`PREPARED` attempt; no tenant state exists and the source capability remains unconsumed. If that abort cannot be confirmed, the attempt simply remains non-authoritative until its deadline and no retry may reuse it meanwhile.

Secret cleanup follows three explicit outcomes:

- **Confirmed committed:** keep the referenced secret, issue the already-created raw status credential cookie, and continue to provisioning.
- **Proven not committed:** a narrow reconciliation routine acquires the same attempt lock, thereby waiting for any transaction already completing that attempt. It may return `NOT_COMMITTED` only for an already `ABORTED` attempt, or after the ten-minute deadline when it atomically changes `PREPARED` to `ABORTED`, and only after proving there is no receipt and no connector reference for this attempt/reference. Any delayed completion then sees `ABORTED` and cannot commit. Only after that proof may the service destroy the candidate secret. A destroy failure creates a redacted orphan alert and grants no client authority.
- **Unknown outcome:** an unexpired `PREPARED` attempt, database unavailability, or insufficient reconciliation proof returns `UNKNOWN`. Do not issue a product or status authority, and do not destroy the candidate secret. Retry only the narrow reconciliation lookup. If the database remains unavailable, retain the labeled candidate secret for operational reconciliation and return a generic fail-closed response.

This rule prevents a post-commit network failure from destroying the only secret referenced by a committed connector. Neither tokens nor secret references are logged or returned to a client.

The raw status credential is never durably stored server-side. If a process loses it before a reconciled commit can set the cookie, reconciliation must not reconstruct or expose it; the exact Initial Owner uses the fresh-OIDC status reissuance rule in section 9.

There is no previous secret in initial bootstrap. Existing reauthorization keeps its established create-new, commit-new-reference, then destroy-old order, with the same unknown-commit rule before any new-secret cleanup.

## 8. Atomic database bootstrap

The additive migration introduces a narrow prepare routine and a narrow completion routine. The prepare routine runs before secret creation and, in one transaction:

1. acquires the transaction-scoped lock derived from the bootstrap-attempt UUID;
2. validates and locks the active source first-domain-claim capability, its Identity/User, and the server-generated candidate/status hashes;
3. rejects a second live attempt for the same source capability or any binding mismatch;
4. inserts or idempotently returns the exact same non-authoritative `PREPARED` attempt with a deadline no later than ten minutes;
5. creates no workspace, membership, connector, job, session, or product authority and does not consume the source capability.

The completion routine then, in one transaction:

1. acquire the transaction-scoped advisory/serialization lock derived from the bootstrap-attempt UUID before reading or mutating any attempt state;
2. require the attempt to be the exact bound `PREPARED` row and still inside its completion deadline using database time; `ABORTED`, `COMMITTED`, expired, or mismatched attempts cannot complete;
3. lock and validate the active source onboarding session by credential hash;
4. require exactly the `FIRST_DOMAIN_CLAIM_*` family, including `FIRST_DOMAIN_CLAIM_COMPLETE`, and bind the session to the active Google User/Identity;
5. require the prepared status credential hash to differ from the source hash and not collide with any existing onboarding/session credential hash;
6. confirm the server-supplied `sub` and `hd` equal the stored verified identity claims, then normalize, bound, sort, and deduplicate customer/domain claims again in deterministic order;
7. reject if the Google customer ID is already bound to a workspace;
8. reject if any verified domain/alias is already a locator for any workspace;
9. create one `ACTIVE` workspace using `GOOGLE_GROUP_CONTROLLED`;
10. bind the stable Google customer ID;
11. create `VERIFIED` locators for the complete verified domain/alias set, recording customer, kind, and alias-parent provenance on the existing locator authority;
12. create exactly one active `OWNER` membership for the consenting Identity's User;
13. create or select exactly one active Directory `SYNC_WORKER` service actor;
14. create one active Directory connector bound to the same workspace/customer, authorized identity, exact five Directory scopes, and opaque credential reference;
15. enqueue one deduplicated `DIRECTORY_SYNC` job;
16. consume the source onboarding session;
17. insert the new status-only onboarding capability linked to this workspace and Initial Owner identity, with only `DIRECTORY_BOOTSTRAP_STATUS_READ` and `DIRECTORY_BOOTSTRAP_SYNC_RETRY` and an expiry no later than 24 hours;
18. insert the immutable bootstrap receipt linking attempt, source capability, status capability, identity, workspace, and connector, then transition the exact attempt from `PREPARED` to `COMMITTED` in the same transaction;
19. append an identity-correlated platform audit event and a tenant `SYSTEM` audit event; no tenant `USER` event is legal because no product session exists yet;
20. return only a versioned `PROVISIONING`/committed receipt result. PostgreSQL never returns or generates the raw status credential.

Unique customer and domain constraints are the final concurrency authority. If two Super Admins race, at most one transaction commits. The loser receives the public `ORGANIZATION_ALREADY_REGISTERED` result without learning the workspace ID, owner, customer ID, or tenant details.

The routine creates no `sessions` or `session_tokens` rows.

A separate narrowly granted reconciliation routine accepts the attempt UUID, source onboarding credential hash, candidate status credential hash, and candidate opaque secret reference as server-only inputs. It first acquires the exact same transaction-scoped attempt lock, so it cannot observe state while a matching completion transaction holds the lock. An unexpired `PREPARED` attempt returns `UNKNOWN`; an expired `PREPARED` attempt is atomically changed to `ABORTED` before any negative result; `COMMITTED` requires the matching receipt; and a delayed completion can never move `ABORTED` back to `PREPARED` or `COMMITTED`. The routine returns only `COMMITTED`, `NOT_COMMITTED`, or `UNKNOWN`; it reveals no workspace, customer, connector, identity, or secret data and does not log its sensitive inputs. `NOT_COMMITTED` is returned only while holding that lock, only from `ABORTED`, and only when PostgreSQL can also prove that no receipt and no connector row references the candidate secret. The application may issue the already-generated raw status credential only when the committed receipt matches the attempt, source capability, status hash, and connector reference.

If the consumed source onboarding row has already passed its bounded operational-retention window and the routine can no longer authenticate the reconciliation proof, the result is `UNKNOWN`, never `NOT_COMMITTED`; automated cleanup must retain the labeled candidate secret for manual provider-side reconciliation rather than risk breaking a committed connector.

## 9. Provisioning-only state

After bootstrap, the browser is redirected to a minimal setup status surface, not a dashboard:

```text
GET  /setup/provisioning
GET  /api/v1/onboarding/google-workspace/status
POST /api/v1/onboarding/google-workspace/sync-retry
POST /api/v1/onboarding/google-workspace/finish
POST /api/v1/onboarding/logout
```

```text
Tổ chức đã được thiết lập
Danh bạ Google Workspace đang được đồng bộ.

[Kiểm tra trạng thái]
[Đăng xuất và quay lại sau]
```

The status endpoint first performs a credential-only lookup. An expired or consumed credential may return only `ONBOARDING_EXPIRED`, without reading or revealing workspace status. Only an active, unexpired status capability containing `DIRECTORY_BOOTSTRAP_STATUS_READ` may read the bound bootstrap state and return one of:

- `DIRECTORY_BOOTSTRAP_SYNC_PENDING`;
- `READY` when one complete, published, unexpired generation exists for the same customer-bound connector;
- `DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE`;
- `DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED`.

Invalid, unknown, wrong-family, or revoked credentials return the generic unauthorized contract rather than bootstrap state.

It never returns tenant IDs, customer IDs, Directory records, group names, worker details, or raw errors. These public states are derived from the existing job model rather than assuming a durable `FAILED` row: a queued or unexpired leased job is pending; an expired lease with attempts below the existing maximum is retryable; and an exhausted attempt budget requires support. A retry POST additionally requires `DIRECTORY_BOOTSTRAP_SYNC_RETRY` and calls one narrow routine that may requeue only the same expired Directory job under the existing attempt limit and fencing rules. It cannot select a job, connector, or workspace from request data.

After the workspace transaction commits, the server makes a best-effort zero-input invocation of the existing Directory worker. The durable queued job remains the source of truth if that invocation fails. The existing production cron route is scheduled to lease pending jobs and perform subsequent retries; neither the browser nor mobile client can select a workspace, connector, job, or lease.

When status becomes `READY`, the primary button posts to `finish`. That handler revalidates `READY`, consumes/revokes the status capability, clears its cookie, creates a fresh normal Google OIDC transaction, and redirects to Google. The status capability cannot become product authority.

First-domain-claim and access-request capabilities remain limited to 30 minutes. A status-only capability may live for at most 24 hours because the first full sync can outlast a login transaction. When the browser presents no usable status capability—because it expired, was revoked, or the raw value/cookie was lost after a committed bootstrap—and the first generation is still unavailable, a fresh normal Google OIDC login may invoke one narrow reissuance routine only when all of these server-side facts match: the Google `(issuer, sub)` Identity, the customer-bound workspace and verified `hd`, the immutable bootstrap receipt's Initial Owner identity, the connector's authorized identity, and the absence of a usable first generation. The application generates a new raw status credential and passes only its hash; the routine locks the receipt/workspace, revokes any older active status capability for that identity/bootstrap, and inserts the replacement atomically. The server sets the replacement cookie only after commit. The replacement contains no product operations and creates no session. If a fresh generation is already ready, the normal login flow proceeds normally instead of reissuing status authority.

Mobile displays the same public states and recovery actions. Organization setup opens the allowlisted UPTECH web origin in the system browser; Directory tokens and bootstrap authority are never returned to the mobile application.

## 10. Initial Owner behavior

The creator's explicit database membership is `OWNER` for this workspace only. The first generation must contain an active profile for the same `sub`; otherwise normal login remains denied.

The owner does not require a group/department mapping. Once a fresh generation confirms the Google account is active, normal login may create a normal session and route the owner to `/admin`.

After bootstrap:

- losing Google Super Admin status alone does not silently remove the UPTECH `OWNER` role;
- suspension, deletion, identity revocation, workspace suspension, or explicit UPTECH revocation still denies and revokes access;
- no other Google administrator automatically becomes an UPTECH owner or admin.

## 11. Mapped employee admission

For a known `GOOGLE_GROUP_CONTROLLED` workspace, login reads only the latest complete, published, unexpired generation. Live Google calls are not made on the employee login path.

Before checking Directory admission, the login transaction upserts and locks the global User/Identity by `(GOOGLE, https://accounts.google.com, sub)` and treats email and `hd` only as mutable verified metadata. This makes the immutable identity available for either successful admission or a restricted recovery capability without creating tenant authority.

If no active membership exists, the login completion routine may create one only when all conditions hold:

1. the server-verified OIDC `sub` resolves the current Directory profile in the same workspace/customer;
2. the profile lifecycle is `ACTIVE`;
3. the generation is complete, published, and fresh;
4. the identity's verified `hd` is a verified locator bound to that workspace/customer;
5. one versioned, diagnostic mapping evaluator produces one valid result:
   - one or more matched explicit `ADMIN_GROUP` mappings win with existing precedence and produce `ADMIN` with no effective department; ordinary department mappings do not downgrade or conflict with that explicit admin result; or
   - without an admin-group match, one or more Google Group, OU, or Directory Department signals all resolve to the same UPTECH department and produce `MEMBER` with exactly that effective department;
6. without admin-group precedence, no second distinct department target or incompatible tenant mapping exists.

The routine creates or reactivates the membership and creates the session in the same authorization transaction. It never creates `OWNER`, never reads role/department from the browser, and never infers authority from email text or Google `isAdmin`/`isDelegatedAdmin`.

When a known-tenant identity is denied for no mapping, a mapping conflict, or an employee-actionable stale Directory generation, the same transaction creates no membership or product session. Before returning any public state whose button is `SUBMIT_ACCESS_REQUEST`, it must atomically persist a 30-minute capability containing only `ACCESS_REQUEST_READ` and `ACCESS_REQUEST_SUBMIT`, with `resource_workspace_id` and a bounded reason class resolved by the server. No workspace identifier, reason, desired role, desired department, or recipient is accepted from the browser. If that capability cannot be committed, the server returns `INTERNAL_ERROR` with login and copy-request-ID actions; it may not render a dead submit button.

Outcomes are fail-closed:

- fresh profile but no mapping plus committed access-request capability -> `USER_NOT_PROVISIONED`;
- more than one department or incompatible mapping plus committed access-request capability -> `ACCESS_MAPPING_CONFLICT`;
- suspended profile -> `USER_SUSPENDED`;
- an explicitly `DELETED` profile, or a profile proven present in a prior complete generation and absent from the latest complete generation -> `USER_REMOVED`;
- a subject never observed in any complete generation -> `USER_NOT_PROVISIONED`, never `USER_REMOVED`;
- no first generation yet -> `DIRECTORY_SYNC_PENDING`;
- expired generation plus a committed employee access-request capability -> `DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE`;
- expired generation for an existing `OWNER`/`ADMIN`, or without a committed access-request capability -> base `DIRECTORY_STALE`.

Existing generation publication continues to revoke sessions and update/revoke existing membership authority when a user, group, or mapping disappears.

## 12. Recovery-action contract

Every denial surface in this scoped flow renders:

1. a clear user-level reason;
2. a primary button for the smallest safe next step;
3. a secondary handoff or neutral exit when useful;
4. a request ID;
5. no raw provider/SQL error or sensitive tenant metadata.

Buttons solve or hand off the cause; they never bypass authorization.

The server returns the public state and an ordered one-or-two-item list of action IDs selected from the closed registry below. The Web/Mobile renderer never infers a privileged action from copy alone and never renders an action absent from the server result. Any action requiring an onboarding capability is returned only in the same committed transaction that issued that exact capability; otherwise the server selects the non-privileged state variant. This makes every visible button executable with the authority actually present.

| Public state | Exact user-facing reason | Primary action | Secondary action |
|---|---|---|---|
| `PERSONAL_GOOGLE_ACCOUNT` | “UPTECH chỉ hỗ trợ tài khoản Google Workspace của doanh nghiệp.” | **Dùng tài khoản công ty** | Tìm hiểu tài khoản được hỗ trợ |
| `UNKNOWN_WORKSPACE` | “Tài khoản công ty đã được Google xác minh, nhưng tổ chức chưa được thiết lập trên UPTECH.” | **Thiết lập tổ chức mới** | Đăng nhập bằng tài khoản khác |
| `SUPER_ADMIN_REQUIRED` | “Tài khoản thuộc công ty nhưng không có quyền Google Workspace Super Admin để thiết lập tổ chức.” | **Dùng tài khoản Super Admin** | Sao chép hướng dẫn gửi Super Admin |
| `DELEGATED_ADMIN_UNSUPPORTED` | “Quyền quản trị được ủy quyền chưa đủ để thiết lập tổ chức trong phiên bản hiện tại.” | **Dùng tài khoản Super Admin** | Sao chép hướng dẫn thiết lập |
| `GOOGLE_CONSENT_CANCELLED` | “Bạn đã hủy cấp quyền đọc Google Directory nên UPTECH chưa thể xác minh tổ chức.” | **Cấp quyền lại** | Dùng tài khoản khác |
| `DIRECTORY_SCOPE_REQUIRED` | “UPTECH chưa được cấp đủ quyền chỉ-đọc cần thiết để xác minh tổ chức.” | **Cấp đủ quyền và thử lại** | Dùng tài khoản khác |
| `CONSENT_ACCOUNT_MISMATCH` | “Tài khoản cấp quyền khác với tài khoản bắt đầu thiết lập.” | **Bắt đầu lại bằng cùng tài khoản** | Chọn tài khoản khác |
| `DOMAIN_NOT_VERIFIED` | “Domain công ty chưa được xác minh trong Google Workspace.” | **Xem hướng dẫn xác minh domain** | Dùng tài khoản khác |
| `GOOGLE_ORGANIZATION_MISMATCH` | “Tài khoản và domain không thuộc cùng một tổ chức Google Workspace.” | **Dùng Super Admin của domain chính** | Nhận trợ giúp |
| `ORGANIZATION_ALREADY_REGISTERED` | “Tổ chức này đã được thiết lập trên UPTECH.” | **Đăng nhập vào tổ chức** | Nhận trợ giúp |
| `ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE` | “Tổ chức này đã được thiết lập trên UPTECH nhưng tài khoản của bạn chưa có quyền.” | **Gửi yêu cầu truy cập** | Đăng nhập bằng tài khoản khác |
| `DIRECTORY_BOOTSTRAP_SYNC_PENDING` | “Tổ chức đã được thiết lập và danh bạ Google Workspace đang được đồng bộ.” | **Kiểm tra trạng thái** | Đăng xuất và quay lại sau |
| `DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE` | “Lần đồng bộ danh bạ chưa hoàn tất và có thể thử lại an toàn.” | **Thử đồng bộ lại** | Nhận trợ giúp |
| `DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED` | “Đồng bộ danh bạ đã hết số lần thử an toàn và cần UPTECH kiểm tra.” | **Nhận trợ giúp** | Đăng xuất và quay lại sau |
| `USER_NOT_PROVISIONED` | “Công ty đã được nhận diện nhưng Admin chưa cấp phòng ban hoặc quyền truy cập cho bạn.” | **Gửi yêu cầu cấp quyền** | Dùng tài khoản khác |
| `ACCESS_MAPPING_CONFLICT` | “Quyền hoặc phòng ban của bạn đang được cấu hình không nhất quán.” | **Yêu cầu Admin sửa quyền** | Đăng xuất |
| `USER_SUSPENDED` | “Tài khoản Google Workspace của bạn đang bị tạm khóa.” | **Dùng tài khoản đang hoạt động** | Sao chép hướng dẫn liên hệ Admin |
| `USER_REMOVED` | “Tài khoản không còn hoạt động trong Google Workspace của công ty.” | **Dùng tài khoản đang hoạt động** | Sao chép hướng dẫn liên hệ Admin |
| `DIRECTORY_SYNC_PENDING` | “Danh bạ công ty đang được Admin thiết lập nên UPTECH chưa thể xác nhận quyền của bạn.” | **Sao chép hướng dẫn liên hệ Admin** | Thử đăng nhập sau |
| `DIRECTORY_STALE` | “UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật.” | **Nhận trợ giúp** | Thử đăng nhập sau |
| `DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE` | “UPTECH chưa thể xác nhận quyền hiện tại vì dữ liệu tổ chức chưa được cập nhật.” | **Yêu cầu Admin đồng bộ lại** | Thử đăng nhập sau |
| `WORKSPACE_SUSPENDED` | “Không gian làm việc của công ty đang tạm ngừng hoạt động.” | **Liên hệ Admin/UPTECH** | Dùng tài khoản tổ chức khác |
| `SESSION_REVOKED` or `SESSION_EXPIRED` | “Phiên đăng nhập đã hết hiệu lực hoặc quyền của bạn vừa thay đổi.” | **Đăng nhập lại** | Dùng tài khoản khác |
| `ONBOARDING_EXPIRED` | “Phiên thiết lập đã hết hạn hoặc đã được sử dụng.” | **Thiết lập lại từ đầu** | Nhận trợ giúp |
| `PROVIDER_UNAVAILABLE` | “Hiện chưa thể xác minh quyền với Google; không có quyền truy cập nào được cấp.” | **Thử lại** | Nhận trợ giúp |
| `RATE_LIMITED` | “Bạn đã thử quá nhiều lần; UPTECH tạm dừng yêu cầu để bảo vệ tài khoản.” | **Thử lại sau thời gian hiển thị** | Nhận trợ giúp |
| `FORBIDDEN` | “Tài khoản không có quyền truy cập không gian làm việc được yêu cầu.” | **Đăng nhập bằng tài khoản tổ chức của bạn** | Nhận trợ giúp |
| `INTERNAL_ERROR` | “Không thể hoàn tất yêu cầu; hãy cung cấp mã yêu cầu cho bộ phận hỗ trợ.” | **Quay lại đăng nhập** | Sao chép mã yêu cầu |

Each label above maps to a closed action ID; the renderer may not accept a URL or method from query parameters or provider errors:

| Public state | Primary action ID | Secondary action ID |
|---|---|---|
| `PERSONAL_GOOGLE_ACCOUNT` | `SWITCH_GOOGLE_ACCOUNT` | `OPEN_ENTERPRISE_LOGIN_HELP` |
| `UNKNOWN_WORKSPACE` | `START_ORGANIZATION_SETUP` | `SWITCH_GOOGLE_ACCOUNT` |
| `SUPER_ADMIN_REQUIRED` | `SWITCH_GOOGLE_ACCOUNT` | `COPY_SUPER_ADMIN_INSTRUCTIONS` |
| `DELEGATED_ADMIN_UNSUPPORTED` | `SWITCH_GOOGLE_ACCOUNT` | `COPY_SUPER_ADMIN_INSTRUCTIONS` |
| `GOOGLE_CONSENT_CANCELLED` | `RESTART_DIRECTORY_CONSENT` | `SWITCH_GOOGLE_ACCOUNT` |
| `DIRECTORY_SCOPE_REQUIRED` | `RESTART_DIRECTORY_CONSENT` | `SWITCH_GOOGLE_ACCOUNT` |
| `CONSENT_ACCOUNT_MISMATCH` | `RESTART_DIRECTORY_CONSENT` | `SWITCH_GOOGLE_ACCOUNT` |
| `DOMAIN_NOT_VERIFIED` | `OPEN_DOMAIN_VERIFICATION_HELP` | `SWITCH_GOOGLE_ACCOUNT` |
| `GOOGLE_ORGANIZATION_MISMATCH` | `SWITCH_GOOGLE_ACCOUNT` | `CONTACT_UPTECH` |
| `ORGANIZATION_ALREADY_REGISTERED` | `START_NORMAL_LOGIN` | `CONTACT_UPTECH` |
| `ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE` | `SUBMIT_ACCESS_REQUEST` | `SWITCH_GOOGLE_ACCOUNT` |
| `DIRECTORY_BOOTSTRAP_SYNC_PENDING` | `CHECK_BOOTSTRAP_STATUS` | `EXIT_ONBOARDING` |
| `DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE` | `RETRY_DIRECTORY_SYNC` | `CONTACT_UPTECH` |
| `DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED` | `CONTACT_UPTECH` | `EXIT_ONBOARDING` |
| `USER_NOT_PROVISIONED` | `SUBMIT_ACCESS_REQUEST` | `SWITCH_GOOGLE_ACCOUNT` |
| `ACCESS_MAPPING_CONFLICT` | `SUBMIT_ACCESS_REQUEST` | `EXIT_ONBOARDING` |
| `USER_SUSPENDED` | `SWITCH_GOOGLE_ACCOUNT` | `COPY_WORKSPACE_ADMIN_INSTRUCTIONS` |
| `USER_REMOVED` | `SWITCH_GOOGLE_ACCOUNT` | `COPY_WORKSPACE_ADMIN_INSTRUCTIONS` |
| `DIRECTORY_SYNC_PENDING` | `COPY_WORKSPACE_ADMIN_INSTRUCTIONS` | `START_NORMAL_LOGIN` |
| `DIRECTORY_STALE` | `CONTACT_UPTECH` | `START_NORMAL_LOGIN` |
| `DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE` | `SUBMIT_ACCESS_REQUEST` | `START_NORMAL_LOGIN` |
| `WORKSPACE_SUSPENDED` | `CONTACT_UPTECH` | `SWITCH_GOOGLE_ACCOUNT` |
| `SESSION_REVOKED` or `SESSION_EXPIRED` | `START_NORMAL_LOGIN` | `SWITCH_GOOGLE_ACCOUNT` |
| `ONBOARDING_EXPIRED` | `START_NORMAL_LOGIN` | `CONTACT_UPTECH` |
| `PROVIDER_UNAVAILABLE` | `START_NORMAL_LOGIN` | `CONTACT_UPTECH` |
| `RATE_LIMITED` | `START_NORMAL_LOGIN_AFTER_COOLDOWN` | `CONTACT_UPTECH` |
| `FORBIDDEN` | `SWITCH_GOOGLE_ACCOUNT` | `CONTACT_UPTECH` |
| `INTERNAL_ERROR` | `START_NORMAL_LOGIN` | `COPY_REQUEST_ID` |

The complete action registry is:

| Action ID | Method and exact destination | Required authority/precondition | Bounded result |
|---|---|---|---|
| `START_NORMAL_LOGIN` | `POST /api/v1/auth/google/transactions`, server enum `LOGIN` | same-origin + CSRF when a cookie exists | clears transient setup state and starts normal OIDC |
| `START_NORMAL_LOGIN_AFTER_COOLDOWN` | `POST /api/v1/auth/google/transactions`, server enum `LOGIN` | same rules as normal login; button remains disabled until the bounded server `Retry-After` elapses | starts a new normal OIDC transaction, never replays the denied request |
| `SWITCH_GOOGLE_ACCOUNT` | `POST /api/v1/auth/google/transactions`, server enum `SWITCH_ACCOUNT` | same-origin + CSRF when a cookie exists | clears transient authorities and starts OIDC with account selection |
| `START_ORGANIZATION_SETUP` | `POST /api/v1/onboarding/google-workspace/transactions` | active `FIRST_DOMAIN_CLAIM_RESERVE` | creates bound Directory consent transaction |
| `RESTART_DIRECTORY_CONSENT` | `POST /api/v1/onboarding/google-workspace/transactions` | same unconsumed first-domain capability and verified identity | clears only the failed setup transaction and creates fresh state/nonce/PKCE |
| `CHECK_BOOTSTRAP_STATUS` | `GET /api/v1/onboarding/google-workspace/status` | `DIRECTORY_BOOTSTRAP_STATUS_READ` | returns one allowlisted status only |
| `RETRY_DIRECTORY_SYNC` | `POST /api/v1/onboarding/google-workspace/sync-retry` | both status operations and an expired retryable lease | requeues the same bounded job or returns its current public state |
| `FINISH_BOOTSTRAP` | `POST /api/v1/onboarding/google-workspace/finish` | status capability and `READY` | consumes status authority and starts fresh normal OIDC |
| `EXIT_ONBOARDING` | `POST /api/v1/onboarding/logout` | same-origin + CSRF | revokes/clears onboarding cookies and returns to `/login` |
| `SUBMIT_ACCESS_REQUEST` | `POST /api/v1/onboarding/access-requests` | known-tenant `ACCESS_REQUEST_SUBMIT` capability | creates or returns one deduplicated `PENDING` receipt; never grants access |
| `OPEN_ENTERPRISE_LOGIN_HELP` | `GET /help/enterprise-login` | none | renders static supported-account and escalation steps |
| `OPEN_DOMAIN_VERIFICATION_HELP` | `GET /help/google-workspace/domain-verification` | none | renders static Google Admin domain-verification steps and an allowlisted Google Admin link |
| `COPY_SUPER_ADMIN_INSTRUCTIONS` | local clipboard action, fixed template ID `SUPER_ADMIN_SETUP_V1` | supported browser clipboard gesture | copies bounded setup instructions with no tenant data |
| `COPY_WORKSPACE_ADMIN_INSTRUCTIONS` | local clipboard action, fixed template ID `WORKSPACE_ACCESS_V1` | supported browser clipboard gesture | copies bounded contact/mapping instructions plus request ID only |
| `CONTACT_UPTECH` | exact recipient `mailto:contact@uptech.vn` | explicit user gesture | opens a fixed subject/body template containing only public code and request ID |
| `COPY_REQUEST_ID` | local clipboard action | request ID is a validated UUID | copies only the request ID |

Mutating actions use POST, origin/CSRF validation, idempotency/deduplication, loading state, and double-submit protection. Restart actions clear stale transient cookies and create new state/nonce/PKCE. Clipboard, help, and mail actions use fixed localized templates; no server/provider string becomes HTML, a URL, or a mail recipient.

If the Clipboard API is unavailable or denied, the same button reveals the fixed text in a selectable read-only block with a manual-copy instruction. If no mail handler opens, the fixed `contact@uptech.vn` address and request ID remain selectable. A failed local helper action never changes the authorization decision.

`Gửi yêu cầu cấp quyền` uses the already reserved onboarding operation. The minimal first version stores one deduplicated pending, tenant-scoped request resolved server-side from the capability's `resource_workspace_id`; it accepts no requested role, department, workspace, or recipient from the client. It returns a receipt and instructions to contact the company's administrator. The request is a handoff record only: it cannot activate a membership and is marked fulfilled automatically only after a later authorized mapping/admission succeeds. Building an Admin inbox or Dashboard is outside this change, so this specification does not claim that submission alone resolves access.

The request action uses:

```text
POST /api/v1/onboarding/access-requests
GET  /api/v1/onboarding/access-requests/current
```

The read endpoint requires `ACCESS_REQUEST_READ` and returns only `PENDING`, `FULFILLED`, or `CANCELLED` plus the public request ID. It exposes no workspace, membership, mapping, role, department, owner, or administrator identity.

For an unknown organization with no tenant, the handoff button copies generic setup instructions for the company's Super Admin instead of creating an unbound request. If a fully verified bootstrap attempt loses a race, the base result is `ORGANIZATION_ALREADY_REGISTERED`. The `_ACCESS_REQUEST_AVAILABLE` variant is returned only when one atomic database routine proves that the stable Google `customerId` exactly equals the registered workspace customer and that every conflicting verified locator belongs to that same workspace/customer, then consumes the first-domain capability and issues the bound access-request capability. A domain collision with a different or missing customer binding fails closed, exposes no workspace metadata, and never issues request authority.

The existing login card's visual language remains unchanged. This work changes state-specific copy and actions only; it does not redesign the Login UI.

## 13. Public errors and internal diagnostics

The implementation adds a versioned result/error contract rather than changing the meaning of existing database enum values in place. Internal failures may be more precise, but the public mapping must not enable tenant enumeration.

Each API problem contains only an allowlisted code, HTTP status, generic detail, UUID request ID, and one or two allowlisted recovery action IDs selected from the server registry. Redirect query parameters contain only an allowlisted public error code and request ID; the landing route re-resolves permitted actions server-side rather than trusting action IDs in a URL. URLs never contain domains, emails, provider subjects, workspace/customer IDs, mappings, tokens, secret references, or arbitrary return locations.

Operational logs record event name, public outcome, request ID, and bounded non-secret diagnostics. Tokens, OAuth codes, cookies, PKCE verifiers, secrets, secret references, and raw Google payloads are never logged.

## 14. Data and integrity additions

The additive migration introduces exactly this minimum state:

- nullable `onboarding_sessions.resource_workspace_id`, used only by known-tenant recovery/status capabilities and never returned as normal tenant authority;
- two additional allowed operations on the existing onboarding-session model: `DIRECTORY_BOOTSTRAP_STATUS_READ` and `DIRECTORY_BOOTSTRAP_SYNC_RETRY`;
- operation-shape checks requiring `resource_workspace_id IS NULL` for every `FIRST_DOMAIN_CLAIM_*` row and `resource_workspace_id IS NOT NULL` with a valid workspace foreign key for every access-request or status row; direct writes remain revoked;
- status insertion/reissuance routines additionally prove that capability identity and `resource_workspace_id` equal the receipt's Initial Owner identity and workspace, and that the connector belongs to that same workspace;
- a conditional onboarding expiry constraint: first-domain-claim and access-request operation families remain at most 30 minutes, status-only rows are at most 24 hours, and mixed operation families are rejected;
- non-authoritative `google_workspace_bootstrap_attempts` containing attempt ID, source onboarding-session ID, identity ID, candidate workspace ID, candidate status hash, state `PREPARED | COMMITTED | ABORTED`, completion deadline, and transition timestamps; only narrow routines may insert/transition it, one source capability may have at most one live prepared attempt, and transitions are one-way;
- terminal onboarding rows referenced by a bootstrap attempt remain non-authoritative but are retained for at least seven days for reconciliation; after that window their cleanup is allowed and any unauthenticated historical reconciliation must return `UNKNOWN`, never authorize secret destruction;
- immutable, non-authoritative `google_workspace_bootstrap_receipts` containing `attempt_id` primary key, unique source onboarding-session ID, unique initial-status onboarding-session ID, identity ID, unique workspace ID, connector ID, and `committed_at`; it has no direct runtime read/grant path and exists only for idempotency, reconciliation, and tightly bound status reissuance;
- receipt attempt/identity/workspace/connector references use `ON DELETE RESTRICT`, and committed attempts/receipts are retained for the workspace lifetime; source/initial-status session UUIDs are immutable correlation values rather than foreign keys, so normal cleanup of consumed/expired onboarding rows neither mutates nor deletes the receipt; an aborted attempt is retained until its provider secret is destroyed or quarantined and for at least seven days;
- nullable `workspace_domain_locators.google_customer_id`, `domain_kind`, and `provider_parent_domain`, where `domain_kind` is `PRIMARY`, `SECONDARY`, or `ALIAS`;
- a supporting unique `(workspace_id, google_customer_id)` workspace/customer key plus locator checks requiring customer and kind to be both null or both present; a composite foreign key to that same workspace/customer binding; allowed-kind enforcement; exactly one `PRIMARY` per bootstrapped workspace/customer through a partial unique index; null parent for `PRIMARY`/`SECONDARY`; and an existing verified same-customer parent for every `ALIAS`;
- database-side lower-case ASCII normalization, deterministic sort/deduplication, one-primary/customer-domain equality, at most 1,000 domains, at most 253 bytes per domain, and at most 256 KiB total normalized domain/provenance bytes before any locator insert;
- `ORG_UNIT` as a supported source kind on the existing permission-mapping authority, keyed by stable Google OU ID rather than a user-supplied path;
- `workspace_access_requests`, keyed by `(workspace_id, id)`, bound to a global Google Identity, with `PENDING`, `FULFILLED`, or `CANCELLED` status and a unique live request per workspace/identity/reason class; only successful later admission may mark it `FULFILLED`;
- a foreign key from `connectors.directory_authorized_by_identity_id` to the existing Identity authority;
- a partial unique index permitting at most one active `SYNC_WORKER` service actor per workspace;
- versioned bootstrap/login result types and narrow routines, including a new `google_login_access_state_v2`; no new meaning is added to `google_login_access_state_v1`;
- replacement scope constraints/functions that permit only the exact legacy four-scope set or exact five-scope set, while bootstrap completion requires five.

New tenant-owned relations carry `workspace_id`, composite foreign keys, forced RLS, no direct runtime grants, and narrow `SECURITY DEFINER` access. Global pre-tenant records reveal no tenant metadata through runtime queries.

Migration `0009` drops/recreates only the constraints or routines that must be widened, creates new versioned types/routines instead of mutating deployed result meanings, revokes privileges from `PUBLIC`, API, and worker roles, and grants only the exact new entrypoints. Files `0001` through `0008` are never edited. Once deployed, `0009` is also immutable; any correction becomes a later additive migration.

No parallel User, Identity, Workspace, Membership, Session, connector, secret, permission, or Directory-generation authority may be created.

## 15. Audit events

At minimum, record redacted events for:

- onboarding capability issued/expired/consumed;
- organization setup started, cancelled, denied, conflicted, and completed;
- Super Admin proof succeeded/failed without storing raw proof;
- verified domain set claimed;
- Initial Owner membership created;
- Directory connector activated and first sync queued;
- setup status checked or retry requested;
- mapped employee admitted or denied by reason class;
- access request submitted/deduplicated;
- existing generation publish and revoke events.

Pre-tenant denials use the platform audit relation correlated to the verified Identity when one exists. Bootstrap completion writes a tenant audit event with `actor_kind = SYSTEM`, null actor/membership/session IDs, and the same request ID, because the Initial Owner has no product session yet. Later user actions use `actor_kind = USER` only after the existing audit shape can reference a real membership and session. Logs and audits keep request correlation without secrets.

## 16. Required verification

### 16.1 Unit and service tests

- persisted unknown-workspace capability and cookie lifecycle;
- disjoint first-claim, access-request, and status operation families plus their 30-minute/24-hour expiry bounds;
- setup start requires the exact onboarding operation;
- setup state/nonce/PKCE/account binding and replay denial;
- exact OAuth response of three OIDC plus five Directory scopes, and connector persistence of Directory five only;
- legacy exact-four connector compatibility without fake scope backfill, and duplicate/extra scope denial;
- domain-list normalization, total/count/individual bounds, `customerDomain`/primary equality, primary uniqueness, verified-only filtering, and alias-parent handling;
- OIDC `sub` equals Directory User ID;
- Directory User customer equals `/customers/my_customer`;
- `isAdmin=true` accepted;
- employee and delegated-admin-only setup denied with distinct safe reasons;
- a zero-group customer passes probes without a group-member request, while a non-empty group set requires member-read success;
- missing scopes, cancelled consent, account mismatch, unverified domain, customer mismatch, and provider failure;
- refresh token zeroing and SecretAdapter create/proven-rollback-destroy behavior;
- a connection loss after database commit reconciles the receipt and never destroys the referenced new secret;
- bootstrap and reconciliation serialize on the same attempt lock, while the prepared-attempt deadline prevents a delayed completion from committing after reconciliation has declared `NOT_COMMITTED`;
- an unprovable commit outcome issues no client authority and retains the labeled secret for reconciliation;
- expired status capability reissuance is limited to the exact Initial Owner bootstrap identity and never creates a product session;
- process/cookie loss after committed bootstrap but before `Set-Cookie` revokes the unreachable active status capability and reissues one only after a fresh exact-Initial-Owner OIDC login;
- every public denial state has an executable, allowlisted primary recovery action with the specified method/destination;
- capability-backed action IDs are returned only with the matching atomically committed capability; base variants never render dead privileged buttons;
- no open redirect, arbitrary action URL, raw provider error, token, or secret leakage.

### 16.2 PostgreSQL integration

Run migrations `0001` through additive `0009` in a disposable PostgreSQL database, then the new verifier and integration suite. Prove:

- runtime cannot read/write new tables directly;
- unknown workspace persists only onboarding authority, never tenant/session authority;
- first-claim rows require null `resource_workspace_id`; access-request/status rows require a valid bound workspace; status identity/workspace must match the bootstrap receipt;
- bootstrap consumes one valid capability exactly once;
- prepare is idempotent for identical bindings, forbids a second live attempt, creates no tenant authority, and permits only `PREPARED -> COMMITTED` or `PREPARED -> ABORTED`;
- the server-generated source/status hashes are distinct, the raw status token never enters PostgreSQL, and the cookie changes only after confirmed commit;
- bootstrap receipt idempotency and `COMMITTED`/`NOT_COMMITTED`/`UNKNOWN` reconciliation reveal no tenant data;
- two concurrent Super Admin claims produce exactly one workspace;
- duplicate customer or any duplicate verified domain aborts without partial rows;
- a race-loser receives request authority only when exact `customerId` and every conflicting locator converge on the same registered workspace/customer; domain/customer disagreement denies;
- workspace, all verified locators, Initial Owner, connector, worker actor, job, and audits commit atomically;
- a proven rollback leaves no workspace/connector database reference and permits candidate-secret destruction only after locked reconciliation; an unknown outcome retains the labeled provider secret and grants no client authority;
- setup status authority cannot access product/RLS data;
- retry status follows queued/unexpired-lease/expired-lease/attempt-limit semantics and cannot requeue another job;
- first-generation absence and stale generation deny normal login;
- active owner enters `/admin` only after a fresh generation and fresh login;
- first-time employee login persists/locks the global Identity by `sub` before either admission or restricted recovery issuance;
- active mapped employee is admitted to the correct tenant/department, with explicit admin-group precedence producing `ADMIN` and null department;
- Group, OU, and Directory Department signals resolving to one department admit, while no mapping and multiple distinct member departments deny;
- never-seen subjects resolve to `USER_NOT_PROVISIONED`, while explicit deletion or prior-generation disappearance resolves to `USER_REMOVED`;
- Google admin flags alone never create `OWNER`/`ADMIN` after bootstrap;
- Tenant A cannot claim, read, or act on Tenant B;
- removed/suspended user and removed group revoke existing authority;
- access-request creation is server-resolved, tenant-bound, deduplicated, and never grants membership; only later successful admission may mark it fulfilled.

Production integration tests must never target the production database.

### 16.3 Route, Web, and Mobile verification

- normal employee login scopes remain `openid email profile`;
- unknown hosted domain shows **Thiết lập tổ chức mới**;
- personal account has no setup bypass;
- all setup denials show reason, primary action, secondary action where defined, and request ID;
- provisioning page exposes no product navigation or tenant data;
- READY requires fresh normal login;
- OWNER/ADMIN routes `/admin`; mapped MEMBER routes `/home`;
- logout invalidates the old session;
- mobile setup opens only the allowlisted production Web origin and receives no Directory credential;
- existing visual layout remains unchanged apart from state copy/actions.

Then run the relevant security, login-route, Directory, PostgreSQL/RLS, typecheck, lint, build, Flutter analyze/test/build, and scoped browser-login verification before a completion claim.

## 17. Production rollout

1. Add and verify migration `0009`; do not edit `0001`-`0008`.
2. Register the new pre-tenant Directory callback URI in the same approved Google OAuth configuration: `https://uptech-knowledge-sigma.vercel.app/api/v1/onboarding/google-workspace/callback` for the current Production origin, with exact per-environment allowlisting and no wildcard callback.
3. Confirm the OAuth application is allowed to request the exact read-only domain scope in addition to the existing Directory scopes.
4. Keep Google Cloud Secret Manager and Vercel-to-GCP keyless identity as the only secret path.
5. Configure the existing Vercel cron route to invoke the existing zero-input Directory worker; do not introduce a second scheduler or accept tenant/job authority from the cron request.
6. Apply migration with the migration-owner credential exactly once; remove that credential from runtime afterward.
7. Deploy the exact clean pushed `main` commit through the repository's production deployment contract.
8. Run one real Super Admin bootstrap smoke:

```text
unknown hosted domain
  -> setup button
  -> Super Admin consent
  -> verified customer/domains
  -> provisioning
  -> first generation published
  -> fresh login
  -> correct tenant Initial Owner
  -> /admin
  -> logout
  -> old session denied
```

9. Confirm production logs contain no OAuth code, token, cookie, PKCE verifier, secret, or secret reference.

## 18. Non-goals

- No new Admin or Employee Dashboard.
- No Knowledge, Documents, Search, RAG, or Drive data plane.
- No UPTECH platform-admin role or automatic platform authority.
- No manual domain-entry or email-domain inference.
- No “first login becomes Owner.”
- No delegated-admin tenant creation in V1.
- No automatic employee admission without a fresh Directory profile and one valid mapping.
- No second secret provider, worker framework, permission engine, tenant model, identity model, membership model, or session model.
- No Login UI redesign.

## 19. Completion criteria

The feature is complete only when a real customer Google Workspace Super Admin can create an unknown organization, all server-verified customer domains are registered atomically, the first generation publishes, the Initial Owner completes a fresh normal login into `/admin`, a mapped employee enters only their authorized `/home` context, all specified denial states provide a safe recovery button, logout revokes the old session, and no tenant, role, token, or secret authority comes from a client.
