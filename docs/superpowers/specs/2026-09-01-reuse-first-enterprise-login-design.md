# Reuse-First Enterprise Login and Permission Design

## Approved scope

This is one 60-minute implementation task. Stop at the deadline and report exact status. Preserve the existing Web and Mobile login UI and reuse the existing Google OIDC, `oauth_transactions`, users, identities, workspaces, `workspace_domain_locators`, memberships, sessions, audit, connectors, `sync_jobs`, permission engine, RLS, and Web/Mobile auth. No parallel authority or `people_data_connections` relation may be introduced.

## Authority flow

1. Existing Google OIDC verifies state, nonce, PKCE, signature, issuer, audience/azp, expiry/issued-at, `email_verified`, `hd`, and `sub`.
2. The exact normalized verified `hd` resolves one active workspace through existing `workspace_domain_locators`; personal Google accounts and unknown workspaces are denied without enterprise authority.
3. The user identity is resolved by `(provider=GOOGLE, issuer, provider_subject=sub)`. Email remains mutable metadata and is never a role or durable identity key.
4. Authorization reads the latest `PUBLISHED`, complete, non-expired Directory generation for that workspace. It never calls Google Directory live during login.
5. The active Directory profile, groups, department, OU, and tenant-owned mapping determine membership authority. Missing, unmapped, suspended, deleted, stale, or inconsistent authority denies.
6. Configured admin group membership maps to existing `ADMIN`. Existing legitimately bootstrapped `OWNER` remains authorized for that tenant's Admin Control Plane without requiring admin-group membership. Google `isAdmin` and `isDelegatedAdmin` are stored only as Directory-setup eligibility signals and never grant `ADMIN`.
7. Department mappings produce `MEMBER + SALES|HR|IT|FINANCE` with no email-name inference.
8. Existing membership/session records bind workspace, user, identity, role, and security/authz versions. A changed or removed Directory authority bumps membership authorization version and revokes affected sessions/tokens.
9. Existing `OWNER`/`ADMIN` route to `/admin`; `MEMBER` routes to `/home`. Every decision is tenant-scoped.

## Directory integration

Reuse existing `connectors` rows with `purpose='DIRECTORY'`, `sync_jobs` rows with `job_kind='DIRECTORY_SYNC'`, the existing secret adapter interface, worker lease fence, snapshot generation, and publish routines. Add only missing customer binding, secure credential reference metadata, OU/admin-signal snapshot fields, and worker dispatch needed to run the read-only sync.

Connector setup must prove the consenting account is Google `isAdmin` or `isDelegatedAdmin`, successfully read every required dataset, and belongs to the same Google customer as the resolved tenant. This is setup eligibility only. If the existing secret adapter cannot securely create/read/replace/destroy a credential reference, stop with `SHARED CONTRACT GAP`; do not add a second secret authority.

## Permission and routing

The current default-deny permission engine remains the only application policy engine. Server-side route/API authority reloads the current Directory context inside the existing authenticated request transaction. It never accepts workspace, role, department, group, membership, or customer authority from the client.

`OWNER`/`ADMIN` may enter only their tenant's existing Admin Control Plane. `MEMBER` may enter only the existing Employee Data Plane. Tenant A cannot access Tenant B; Sales cannot access HR; HR cannot access Sales; Finance cannot access Sales/HR unless an explicit same-tenant ACL grants it; employees cannot call admin APIs.

Knowledge, Search, Documents, and RAG have no secure production repository in this codebase. They remain denied and are not implemented or enabled by this task. No fetch-all/front-end filtering or retrieve-all/post-LLM filtering is permitted.

## Required proof

- OWNER -> admin ALLOW; mapped ADMIN -> admin ALLOW; MEMBER -> admin DENY.
- Sales -> HR DENY; HR -> Sales DENY; Finance -> Sales/HR DENY absent an explicit ACL.
- Tenant A -> Tenant B DENY.
- Unknown, unmapped, suspended, deprovisioned, and stale-Directory users deny.
- A fresh last-known-good published generation authorizes without a live Google call.
- Removed group membership revokes the old authority.
- Logout makes the old session unusable.
- Security, Directory mapping, route guard, tenant/department isolation, PostgreSQL/RLS, Flutter, typecheck, lint, and build verification are run before a completion claim.

## Non-goals

No Login UI change, new dashboard, Knowledge/Search/RAG repository, document/chunk/vector schema, Drive feature, platform-admin authority, tenant selector, hard-coded domain, or production deployment.
