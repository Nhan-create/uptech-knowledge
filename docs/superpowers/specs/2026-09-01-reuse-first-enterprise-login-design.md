# Reuse-First Enterprise Login and Permission Design

## Approved scope

Complete the existing Google Workspace login and tenant permission path without changing the Web or Mobile login UI and without creating a second auth, tenant, membership, session, connector, job, or audit authority.

The existing `users`, `identities`, `workspaces`, `workspace_domain_locators`, `workspace_memberships`, `sessions`, `session_tokens`, `connectors`, `sync_jobs`, `audit_events`, Google OIDC services, Web cookie flow, and Mobile A3 handoff/refresh flow remain authoritative.

## Authority flow

1. Existing Google OIDC verifies state, nonce, PKCE, signature, issuer, audience/azp, exp/iat, `email_verified`, `hd`, and `sub`.
2. Existing `workspace_domain_locators` resolves the tenant from the verified hosted domain.
3. Existing `(provider, issuer, provider_subject)` identity resolves the user.
4. The current published Directory generation resolves the user's lifecycle, tenant-scoped groups, and department mapping.
5. The configured tenant admin group maps to existing role `ADMIN`; every department mapping maps to `MEMBER` plus one of `SALES`, `HR`, or `IT`. Google Admin status is setup eligibility only and never grants `ADMIN`.
6. Existing membership/session rows bind the tenant, user, identity, role, and security/authz versions. Current Directory authority is reloaded server-side for protected work.
7. Web members land on `/home`; existing `OWNER` and `ADMIN` memberships are accepted only by the existing `/admin` route tree. Cross-role access redirects or denies server-side.
8. Backend permission evaluates before data access. PostgreSQL tenant context and forced RLS remain the final isolation boundary.

## Directory and mapping data

Reuse `connectors` rows with `purpose = 'DIRECTORY'` and `sync_jobs` rows with `job_kind = 'DIRECTORY_SYNC'`. Add only tenant-scoped Directory snapshot and mapping relations that do not already exist:

- published sync generations linked to the existing Directory connector;
- people profiles keyed by Google immutable subject, including lifecycle state;
- provider group snapshots and direct group edges;
- tenant mapping rows for `ADMIN_GROUP` and `DEPARTMENT` sources;
- a server-only routine that publishes a complete generation atomically, applies the mapping to the existing membership, bumps versions, and revokes sessions/tokens when a user is suspended, deleted, unmapped, or removed from the required group.

No `people_data_connections`, enterprise login transaction, enterprise discovery limiter, per-tenant OIDC authority, setup session, or platform operator authority is introduced.

## Permission and routing

The existing default-deny permission engine remains the only application policy engine. A trusted permission context loader reads the current membership and published Directory generation inside the existing request transaction. It never accepts workspace, role, department, group, or membership authority from a client.

`/home` authenticates the Web session and accepts only `MEMBER`; `OWNER`/`ADMIN` are redirected to `/admin`. The `/admin` layout authenticates the same Web session and accepts only `OWNER`/`ADMIN`; `MEMBER` is denied or redirected to `/home`. Existing login and dashboard components are unchanged.

The current fixture Search/Documents/RAG routes remain contained and are not promoted to production. No fetch-all or post-LLM filtering is added. Permission predicates must be applied before any protected adapter or retrieval operation.

## Mobile

The existing A3 system-browser, callback, handoff, access/refresh, workspace, and logout protocol remains unchanged. No Mobile login screen or login DTO is changed. Any actively used legacy refresh/session authority is migrated to the A3 repository or removed when safe; no new Mobile auth service is created.

## Required behavior

- Tenant A admin cannot access Tenant B.
- Sales cannot access HR; HR cannot access Sales.
- `MEMBER` cannot access admin routes or APIs.
- Personal Gmail, unknown workspace/user, suspended/deprovisioned people, removed required group, stale Directory generation, replayed/mismatched OIDC transactions, and revoked sessions fail closed.
- Logout and Directory lifecycle revocation make old sessions unusable.
- Audit metadata remains fixed and redacted.

## Non-goals

No login UI change, new dashboard, Search/Documents/RAG implementation, full Drive connector, Directory settings UI, new platform-admin system, tenant selector, hard-coded production domain, or deployment/promotion is part of this delivery.

