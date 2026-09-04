# Google Workspace Tenant Bootstrap — Production Runbook

This is an executable release checklist, not evidence that production deployment, consent, or login has occurred. Record evidence outside this file without copying credentials or sensitive response data.

## 1. Freeze exact release inputs

1. Record the full SHA of the reviewed Web commit on `main`; confirm the pushed remote SHA is identical and the scoped diff contains no `.env` files, credentials, database URLs, temporary files, or unrelated code.
2. Record the separately recorded Mobile commit from the authoritative Mobile repository. Do not substitute the Web SHA or an untracked local Mobile directory.
3. Confirm the Web and Mobile release records point to the versions reviewed together. Stop if either exact commit is missing, unpushed, or ambiguous.

## 2. Prepare Google Cloud

1. Enable the Admin SDK API, Secret Manager API, and IAM Service Account Credentials API in the intended production Google Cloud project.
2. Use a dedicated keyless service account for Directory secret access. Do not create, download, upload, or retain a service-account key file.
3. Bind Vercel OIDC to Google Cloud Workload Identity Federation (WIF). Configure the provider's exact audience to match the production provider named by `UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER`.
4. Restrict attribute mappings and conditions to the exact trusted Vercel team, project, and production environment claims. Do not allow arbitrary repositories, preview deployments, branches, teams, or subjects.
5. Grant the service account least-privilege Secret Manager access only to the approved Directory refresh-credential secrets. Do not grant project-wide Owner, Editor, or broad secret-administration roles.
6. Verify impersonation succeeds only from the restricted production Vercel identity and fails from a preview or mismatched subject.

## 3. Configure Vercel production metadata

Set these server-only Vercel Production environment names through the platform's protected environment controls, without pasting their values into tickets, logs, commits, or chat:

- `UPTECH_GCP_SECRET_MANAGER_PROJECT_ID`
- `UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER`
- `UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL`
- `CRON_SECRET`

Use project metadata and an opaque random cron credential. Never upload service-account JSON or a key file. Confirm Preview and Development do not inherit Production-only values unless explicitly required and separately reviewed.

## 4. Register Google OAuth callbacks

Register both of the following as exact Google OAuth Web redirect URIs on the approved production Web client:

- Post-tenant Directory connection: `https://uptech-knowledge-sigma.vercel.app/api/v1/admin/connectors/google-directory/callback`
- First-organization bootstrap: `https://uptech-knowledge-sigma.vercel.app/api/v1/onboarding/google-workspace/callback`

The bootstrap callback is only for customer Google Workspace Super Admin tenant creation. It is separate from employee login and from post-tenant Directory connection. Do not add wildcard origins, alternate paths, query strings, or frontend-provided redirect targets.

## 5. Apply immutable migration 0009

1. Provide a direct migration-owner connection only to the isolated one-shot migration process. The ordinary runtime and build must never receive this credential.
2. Set the runner's explicit production-apply switch and execute `npm run migrate:login:production` once from the exact reviewed Web commit. The runner must acquire its advisory lock, detect the definitive bootstrap marker, apply only when absent, and run all configured verifiers.
3. Confirm the bootstrap routine marker and verifier results without running destructive or disposable integration suites against production.
4. Immediately remove the migration-owner connection from the process and platform environment. Confirm the runtime database role remains a non-superuser with `NOBYPASSRLS`.
5. Migration `0009` is immutable after application. Never edit or replay migrations `0001` through `0009` to repair production.

## 6. Deploy the exact Web commit

1. Create the Vercel Production deployment from the recorded full Web SHA on `main`; verify the deployment's source SHA exactly matches the release record.
2. Keep Git pushes detached from production-domain promotion. There is no automatic domain promotion; attach or promote the production domain only as an explicit release action after the exact-SHA check.
3. Verify the scheduled request targets only `/api/internal/cron/google-directory` with the approved authorization boundary and carries no tenant, customer, job, or workspace selector.

## 7. Bootstrap with a customer Super Admin

1. Start from `/login` with the customer's Google Workspace Super Admin account and the unknown hosted domain, then select organization setup.
2. Complete the separate bootstrap consent with the same Google subject that started the transaction. Reject account switching, callback replay, missing verified email, missing hosted domain, or mismatched state.
3. Verify server-side Directory evidence establishes `isAdmin=true` (not delegated-admin alone), a stable `customerId`, and verified domains belonging to that same customer. The login hosted domain must be one of those verified domains.
4. Confirm the atomic result creates one tenant/customer binding, verified domain locators, one initial UPTECH OWNER membership, the connector's opaque credential reference, and no UPTECH system-admin authority.
5. Stop if a domain or customer is already bound elsewhere, any evidence mismatches, consent storage fails, or the transaction cannot finish atomically.

## 8. Publish the first Directory generation

1. Invoke the existing zero-input worker through the authenticated production cron route; never supply a tenant, customer, workspace, connector, or job selector from the caller.
2. Confirm Users, Groups, Group Members, OU, Department, and admin signals stage under the connector's bound workspace/customer organization.
3. Confirm one generation becomes `PUBLISHED` and remains fresh under the configured TTL before allowing normal product access.
4. Confirm the initial Owner remains in setup/status flow until the fresh publication exists. Treat missing, failed, stale, or cross-customer evidence as fail closed.

## 9. Run the real enterprise-login smoke

Use bounded real accounts and record only non-sensitive pass/fail evidence:

1. OWNER path: `/login` → Google → login callback → correct tenant/identity/membership → OWNER → `/admin`; verify an active session and no redirect loop.
2. MEMBER path: `/login` → Google → login callback → correct tenant/identity/membership → MEMBER → `/home`; verify department isolation and that another department's resources remain denied.
3. Cross-tenant path: verify an authenticated user cannot select or observe a different tenant and that role/department inputs from the frontend have no authority.
4. Logout each smoke session, then replay the old session and confirm old session denial.
5. Stop if any route, tenant, identity, membership, role, department, session, freshness, or revoke result differs from the expected binding.

## 10. Inspect redacted production logs

Inspect the fixed release window for the bootstrap callback, login callback, Directory worker, generation publication, and logout. Logs must contain correlation-safe status only and must not contain token/code/cookie/secret/database URL/credential reference data. Also confirm there is no OAuth authorization code, cookie value, refresh credential, connection string, private key material, or raw upstream response body.

If sensitive material appears, stop the release, restrict access to the affected logs, rotate or revoke the exposed material through its owning platform, and investigate the exact emission path. Do not copy the material into an issue or chat.

## 11. Roll back or stop safely

An application rollback to the last known-good exact commit is allowed. Migration `0009` is immutable and is not rolled back destructively. On uncertainty, fail closed by disabling the affected connector or release flag, leave Directory-controlled access denied, preserve redacted evidence, and investigate before resuming.

Stop immediately when the exact source SHA is uncertain, the production database target is ambiguous, migration-owner separation is broken, WIF claims are broader than the intended production identity, callbacks differ, Google organization evidence conflicts, the first generation is not fresh, isolation fails, an old session remains valid, or logs disclose sensitive material.

## 12. ADMIN ACTION REQUIRED

Use this single consolidated block only when an account owner must complete an interactive or privileged platform action:

1. Approve or verify the restricted Google Cloud APIs, dedicated keyless service account, WIF audience/attribute conditions, and least-privilege Secret Manager IAM binding.
2. Verify the four named Vercel Production environment entries exist in protected platform settings, without disclosing their values.
3. Register both exact OAuth Web redirect URIs and complete the customer Super Admin's interactive consent/MFA directly in Google's trusted interface.
4. Authorize the one-shot migration-owner process, then remove its access and verify the runtime role remains non-superuser `NOBYPASSRLS`.
5. Authorize explicit exact-commit Production deployment/domain promotion and the bounded real login/logout smoke.

Do not send passwords, tokens, secrets, database URLs, private keys, or MFA codes in chat.
