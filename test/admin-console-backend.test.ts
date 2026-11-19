import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  isSameOriginAdminRequest,
  mapAdminDbError,
} from "../src/server/admin/auth.ts";

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
    "member-a@example.test",
    "member-b@example.test",
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
  const sameOriginReq = new Request("https://app.example/api/v1/admin/users", {
    method: "POST",
    headers: {
      origin: "https://app.example",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isSameOriginAdminRequest(sameOriginReq), true);

  const crossSiteReq = new Request("https://app.example/api/v1/admin/users", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
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
