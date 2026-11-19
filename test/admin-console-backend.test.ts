import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  isSameOriginAdminRequest,
  mapAdminDbError,
} from "../src/server/admin/auth.ts";
import { tokenizeQuery } from "../src/server/ai/retrieval.ts";
import { canAccessKnowledgeSpace } from "../src/server/knowledge/access-context.ts";
import { redactSensitiveDlpContent } from "../src/server/security/dlp-redactor.ts";
import { resolveEncryptedEnvelopeSecretProviderRegistration } from "../src/server/secrets/local-dev-secret-manager.ts";

test("admin UI components contain zero fixture or fake prototype strings", () => {
  const adminDir = join(process.cwd(), "src", "components", "admin");
  const files = readdirSync(adminDir).filter((file) =>
    file.endsWith(".ts") || file.endsWith(".tsx"),
  );
  assert.ok(files.length >= 7, "expected modular real admin UI components");

  const forbidden = [
    "fixture UI",
    "Fixture UI",
    "Read-only prototype",
    "Người dùng mẫu",
    "Nhóm mẫu",
    "Gemini",
  ];

  for (const file of files) {
    const content = readFileSync(join(adminDir, file), "utf8");
    for (const token of forbidden) {
      assert.equal(
        content.includes(token),
        false,
        `Found forbidden string "${token}" in ${file}`,
      );
    }
  }
});

test("migration 0016 enforces RLS and admin SECURITY DEFINER authority", () => {
  const sql = readFileSync(
    join(process.cwd(), "db", "migrations", "0016_admin_console_backend.sql"),
    "utf8",
  );

  for (const required of [
    "CREATE TABLE IF NOT EXISTS uptech.workspace_settings",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_billing_profiles",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_member_invites",
    "ALTER TABLE uptech.workspace_settings FORCE ROW LEVEL SECURITY;",
    "ALTER TABLE uptech.workspace_billing_profiles FORCE ROW LEVEL SECURITY;",
    "ALTER TABLE uptech.workspace_member_invites FORCE ROW LEVEL SECURITY;",
    "CREATE OR REPLACE FUNCTION uptech.require_admin_caller_v1()",
    "CREATE OR REPLACE FUNCTION uptech.admin_list_members_v1()",
    "CREATE OR REPLACE FUNCTION uptech.admin_update_member_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_invite_member_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_resolve_access_request_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_list_permission_mappings_v1()",
    "CREATE OR REPLACE FUNCTION uptech.admin_upsert_permission_mapping_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_delete_permission_mapping_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_list_connectors_v1()",
    "CREATE OR REPLACE FUNCTION uptech.admin_list_sync_jobs_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_list_audit_events_v1(",
    "CREATE OR REPLACE FUNCTION uptech.admin_get_workspace_overview_v1()",
    "CREATE OR REPLACE FUNCTION uptech.admin_update_provisioning_policy_v1(",
  ]) {
    assert.ok(sql.includes(required), `Missing required SQL statement: ${required}`);
  }
});

test("src/proxy.ts allowlists all 6 real admin APIs behind session cookie gate", () => {
  const proxySource = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  for (const endpoint of [
    "/api/v1/admin/users",
    "/api/v1/admin/permissions",
    "/api/v1/admin/connectors",
    "/api/v1/admin/billing",
    "/api/v1/admin/audit-logs",
    "/api/v1/admin/settings",
  ]) {
    assert.ok(proxySource.includes(endpoint), `Missing proxy allowlist entry: ${endpoint}`);
  }
  assert.ok(proxySource.includes("allowAuthenticatedAdminApi"));
  assert.ok(proxySource.includes("allowAuthenticatedWorkspacePage"));
});

test("isSameOriginAdminRequest rejects cross-site and mismatched origins", () => {
  const sameOriginReq = new Request("https://tenant-a.example/api/v1/admin/users", {
    method: "POST",
    headers: {
      origin: "https://tenant-a.example",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isSameOriginAdminRequest(sameOriginReq), true);

  const crossSiteReq = new Request("https://tenant-a.example/api/v1/admin/users", {
    method: "POST",
    headers: {
      origin: "https://tenant-b.example",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(isSameOriginAdminRequest(crossSiteReq), false);
});

test("mapAdminDbError maps PostgreSQL error codes to safe HTTP statuses", async () => {
  const cases: ReadonlyArray<{
    error: { code: string; message?: string };
    status: number;
    expectedCode: string;
  }> = [
    { error: { code: "42501", message: "owner authority required" }, status: 403, expectedCode: "FORBIDDEN" },
    { error: { code: "P0002", message: "member not found" }, status: 404, expectedCode: "NOT_FOUND" },
    { error: { code: "22023", message: "email domain is not verified" }, status: 400, expectedCode: "INVALID_DOMAIN" },
    { error: { code: "55000", message: "cannot remove last active owner" }, status: 409, expectedCode: "LAST_OWNER_PROTECTED" },
    { error: { code: "42883", message: "function does not exist" }, status: 503, expectedCode: "SCHEMA_UPGRADE_REQUIRED" },
  ];

  for (const item of cases) {
    const res = mapAdminDbError(item.error, "req-test", "fallback");
    assert.equal(res.status, item.status);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, item.expectedCode);
  }
});

test("migration 0017 defines enterprise workspace foundation tables, Space ACL, auto-accept invites, and knowledge analytics", () => {
  const sql = readFileSync(
    join(process.cwd(), "db", "migrations", "0017_enterprise_workspace_foundation.sql"),
    "utf8",
  );

  for (const required of [
    "CREATE TABLE IF NOT EXISTS uptech.ai_chat_sessions",
    "CREATE TABLE IF NOT EXISTS uptech.ai_chat_turns",
    "knowledge_spaces_access_scope_check",
    "CREATE TABLE IF NOT EXISTS uptech.knowledge_document_blobs",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_utility_runs",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_user_profiles",
    "CREATE OR REPLACE FUNCTION uptech.user_read_profile_and_sessions_v1()",
    "CREATE OR REPLACE FUNCTION uptech.user_update_profile_v1(",
    "CREATE OR REPLACE FUNCTION uptech.user_revoke_sessions_v1(",
    "CREATE OR REPLACE FUNCTION uptech.auto_accept_pending_invite_v1(",
    "CREATE TRIGGER identities_auto_accept_invite_trg",
    "CREATE OR REPLACE FUNCTION uptech.admin_get_knowledge_analytics_v1()",
  ]) {
    assert.ok(sql.includes(required), `Missing required 0017 SQL statement: ${required}`);
  }
});

test("canAccessKnowledgeSpace enforces WORKSPACE, DEPARTMENT, and ADMIN_ONLY Space ACL isolation", () => {
  const salesMember = {
    mode: "preview" as const,
    workspaceId: "ws-1",
    membershipId: "m-sales",
    workspaceRole: "MEMBER" as const,
    departmentKey: "SALES" as const,
    userId: "u-1",
    actorLabel: "Sales Member",
    session: undefined,
  };
  const hrMember = {
    ...salesMember,
    membershipId: "m-hr",
    departmentKey: "HR" as const,
  };
  const adminMember = {
    ...salesMember,
    membershipId: "m-admin",
    workspaceRole: "ADMIN" as const,
    departmentKey: null,
  };

  assert.equal(
    canAccessKnowledgeSpace(salesMember, {
      accessScope: "WORKSPACE",
      allowedDepartmentKey: null,
    }),
    true,
  );
  assert.equal(
    canAccessKnowledgeSpace(salesMember, {
      accessScope: "DEPARTMENT",
      allowedDepartmentKey: "SALES",
    }),
    true,
  );
  assert.equal(
    canAccessKnowledgeSpace(hrMember, {
      accessScope: "DEPARTMENT",
      allowedDepartmentKey: "SALES",
    }),
    false,
  );
  assert.equal(
    canAccessKnowledgeSpace(salesMember, {
      accessScope: "ADMIN_ONLY",
      allowedDepartmentKey: null,
    }),
    false,
  );
  assert.equal(
    canAccessKnowledgeSpace(adminMember, {
      accessScope: "DEPARTMENT",
      allowedDepartmentKey: "HR",
    }),
    true,
  );
  assert.equal(
    canAccessKnowledgeSpace(adminMember, {
      accessScope: "ADMIN_ONLY",
      allowedDepartmentKey: null,
    }),
    true,
  );
});

test("DocumentRouteError and DocumentRouteLoading contain zero fixture strings and proxy allowlists /api/v1/workspace/profile", () => {
  const errorFile = readFileSync(
    join(process.cwd(), "src", "features", "documents", "DocumentRouteError.tsx"),
    "utf8",
  );
  const loadingFile = readFileSync(
    join(process.cwd(), "src", "features", "documents", "DocumentRouteLoading.tsx"),
    "utf8",
  );
  assert.equal(errorFile.toLowerCase().includes("fixture"), false);
  assert.equal(loadingFile.toLowerCase().includes("fixture"), false);

  const proxySource = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  assert.ok(proxySource.includes("/api/v1/workspace/profile"));
});

test("migration 0018 defines FTS search_tsv, multi-version snapshots, comments, and knowledge connectors", () => {
  const sql = readFileSync(
    join(process.cwd(), "db", "migrations", "0018_bigtech_enterprise_platform.sql"),
    "utf8",
  );
  for (const required of [
    "ADD COLUMN IF NOT EXISTS search_tsv tsvector",
    "knowledge_document_chunks_search_tsv_idx",
    "ADD COLUMN IF NOT EXISTS chunks_snapshot_json jsonb",
    "CREATE TABLE IF NOT EXISTS uptech.knowledge_document_comments",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_knowledge_connectors",
    "CREATE TABLE IF NOT EXISTS uptech.workspace_ingestion_api_keys",
  ]) {
    assert.ok(sql.includes(required), `Missing required 0018 SQL statement: ${required}`);
  }
});

test("redactSensitiveDlpContent masks API secrets, CCCD citizen IDs, payment cards, and phone numbers", () => {
  const raw =
    "Key: upt_live_1234567890abcdef1234567890abcdef, CCCD: 079200012345, Card: 4111 2222 3333 4444, Phone: 0901234567";
  const res = redactSensitiveDlpContent(raw, true);
  assert.equal(res.redactionCount, 4);
  assert.equal(res.sanitizedText.includes("079200012345"), false);
  assert.equal(res.sanitizedText.includes("4111 2222 3333 4444"), false);
  assert.equal(res.sanitizedText.includes("0901234567"), false);
  assert.ok(res.sanitizedText.includes("[REDACTED_SECRET]"));
  assert.ok(res.sanitizedText.includes("[REDACTED_CCCD]"));
  assert.ok(res.sanitizedText.includes("[REDACTED_CARD]"));
  assert.ok(res.sanitizedText.includes("[REDACTED_PHONE]"));
});

test("tokenizeQuery expands enterprise acronyms into bilingual semantic tokens", () => {
  const tokens = tokenizeQuery("Quy định WFH và MFA");
  assert.ok(tokens.includes("wfh"));
  assert.ok(tokens.includes("remote"));
  assert.ok(tokens.includes("mfa"));
  assert.ok(tokens.includes("vpn"));
});

test("resolveEncryptedEnvelopeSecretProviderRegistration encrypts and decrypts Directory refresh tokens with AES-256-GCM without requiring GCP Billing", async () => {
  const reg = resolveEncryptedEnvelopeSecretProviderRegistration({
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: "0123456789abcdef0123456789abcdef0123456789a",
  });
  assert.ok(reg, "expected envelope secret provider registration");
  assert.equal(reg.providerId, "envelope-kms-secret-manager");
  const adapter = reg.createAdapter();
  const original = new TextEncoder().encode("1//0g-google-directory-refresh-token");
  const meta = {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    serviceIdentity: "GOOGLE_DIRECTORY_BOOTSTRAP_V1",
    purpose: "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN",
    requestId: "00000000-0000-4000-8000-000000000002",
  };
  const ref = await adapter.create(original, meta);
  assert.ok(ref.startsWith("envelope-kms:v1:"));
  assert.ok(ref.length <= 1024);
  const decrypted = await adapter.read(ref, meta);
  assert.equal(
    new TextDecoder().decode(decrypted),
    "1//0g-google-directory-refresh-token",
  );
});
