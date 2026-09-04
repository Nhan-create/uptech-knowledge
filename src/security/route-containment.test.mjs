import assert from "node:assert/strict";
import test from "node:test";

import { classifyUnconfiguredRoute } from "./route-containment.mjs";

test("allows only the explicitly public application paths", () => {
  for (const pathname of [
    "/",
    "/login",
    "/login/",
    "/san-pham",
    "/san-pham/",
    "/nguyen-tac",
    "/nguyen-tac/",
    "/nang-luc",
    "/nang-luc/",
    "/quy-trinh",
    "/quy-trinh/",
    "/dieu-khoan-su-dung",
    "/dieu-khoan-su-dung/",
    "/chinh-sach-bao-mat",
    "/chinh-sach-bao-mat/",
    "/api/demo-leads",
    "/api/demo-leads/",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "allow-public",
      pathname,
    );
  }
});

test("allows only the exact approved auth ingress paths", () => {
  for (const pathname of [
    "/api/v1/auth/google/transactions",
    "/api/v1/auth/google/callback",
    "/api/v1/auth/session",
    "/api/v1/auth/logout",
    "/api/v1/auth/mobile/google/transactions",
    "/api/v1/auth/mobile/google/callback",
    "/api/v1/auth/mobile/handoffs/exchange",
    "/api/v1/auth/mobile/refresh",
    "/api/v1/auth/mobile/session",
    "/api/v1/auth/mobile/workspaces",
    "/api/v1/auth/mobile/switch-workspace",
    "/api/v1/auth/mobile/logout",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "allow-auth-ingress",
      pathname,
    );
  }
});

test("allows only the exact Workspace bootstrap methods", () => {
  const start = "/api/v1/onboarding/google-workspace/transactions";
  const callback = "/api/v1/onboarding/google-workspace/callback";
  const status = "/api/v1/onboarding/google-workspace/status";
  const retry = "/api/v1/onboarding/google-workspace/sync-retry";
  const finish = "/api/v1/onboarding/google-workspace/finish";
  assert.equal(classifyUnconfiguredRoute(start, "POST"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(callback, "GET"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(status, "GET"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(retry, "POST"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(finish, "POST"), "allow-auth-ingress");
  for (const [pathname, method] of [
    [start, "GET"], [start + "/", "POST"], [start + "/tenant-a", "POST"],
    [callback, "POST"], [callback + "/", "GET"], [callback + "/tenant-a", "GET"],
    [status, "POST"], [status + "/", "GET"], [status + "/tenant-a", "GET"],
    [retry, "GET"], [retry + "/", "POST"], [retry + "/tenant-a", "POST"],
    [finish, "GET"], [finish + "/", "POST"], [finish + "/tenant-a", "POST"],
  ]) {
    assert.equal(classifyUnconfiguredRoute(pathname, method), "deny-unconfigured", `${method} ${pathname}`);
  }
});

test("allows only the exact onboarding logout and access-request methods", () => {
  const logout = "/api/v1/onboarding/logout";
  const submit = "/api/v1/onboarding/access-requests";
  const current = "/api/v1/onboarding/access-requests/current";
  assert.equal(classifyUnconfiguredRoute(logout, "POST"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(submit, "POST"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(current, "GET"), "allow-auth-ingress");
  for (const [pathname, method] of [
    [logout, "GET"], [logout + "/", "POST"], [logout + "/extra", "POST"],
    [submit, "GET"], [submit + "/", "POST"], [submit + "/extra", "POST"],
    [current, "POST"], [current + "/", "GET"], [current + "/extra", "GET"],
  ]) {
    assert.equal(classifyUnconfiguredRoute(pathname, method), "deny-unconfigured", `${method} ${pathname}`);
  }
});

test("allows only /home through to protected route enforcement", () => {
  assert.equal(classifyUnconfiguredRoute("/home"), "allow-protected");

  for (const pathname of ["/home/", "/home/extra", "/home?bypass=true"]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      pathname,
    );
  }
});

test("does not normalize or prefix-match the auth ingress surface", () => {
  for (const pathname of [
    "/api/v1/auth/google/transactions/",
    "/api/v1/auth/google/transactions/extra",
    "/api/v1/auth/google/callback/",
    "/api/v1/auth/google/callback/extra",
    "/api/v1/auth/session/",
    "/api/v1/auth/logout/",
    "/api/v1/auth/google/transaction",
    "/api/v1/auth/google/callback?code=provider-code",
    "/api/v1/auth/mobile/refresh/",
    "/api/v1/auth/mobile/session/extra",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      pathname,
    );
  }
});

test("allows only the explicit public asset surface", () => {
  for (const pathname of [
    "/favicon.ico",
    "/logo-uptech-white.svg",
    "/media/hero/uptech-knowledge-hero.webm",
    "/_next/static/chunks/app.js",
    "/_next/image",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "allow-public",
      pathname,
    );
  }
});

test("allows only the exact Google Directory cron GET ingress", () => {
  const pathname = "/api/internal/cron/google-directory";
  assert.equal(
    classifyUnconfiguredRoute(pathname, "GET"),
    "allow-auth-ingress",
  );
  for (const [candidate, method] of [
    [pathname, "POST"],
    [`${pathname}/`, "GET"],
    [`${pathname}/extra`, "GET"],
    [`${pathname}?workspace_id=tenant-a`, "GET"],
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(candidate, method),
      "deny-unconfigured",
      `${method} ${candidate}`,
    );
  }
});

test("allows only the exact authenticated Google Directory consent methods", () => {
  const initiate = "/api/v1/admin/connectors/google-directory/transactions";
  const callback = "/api/v1/admin/connectors/google-directory/callback";
  assert.equal(classifyUnconfiguredRoute(initiate, "POST"), "allow-auth-ingress");
  assert.equal(classifyUnconfiguredRoute(callback, "GET"), "allow-auth-ingress");
  for (const [candidate, method] of [
    [initiate, "GET"],
    [initiate, "PUT"],
    [`${initiate}/`, "POST"],
    [`${initiate}/tenant-b`, "POST"],
    [callback, "POST"],
    [callback, "DELETE"],
    [`${callback}/`, "GET"],
    [`${callback}/tenant-b`, "GET"],
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(candidate, method),
      "deny-unconfigured",
      `${method} ${candidate}`,
    );
  }
});

test("allows only the exact existing admin routes through to the admin layout guard", () => {
  for (const pathname of [
    "/admin",
    "/admin/users",
    "/admin/billing",
    "/admin/connectors",
    "/admin/permissions",
    "/admin/audit-logs",
    "/admin/settings",
  ]) {
    assert.equal(classifyUnconfiguredRoute(pathname), "allow-protected", pathname);
  }

  for (const pathname of [
    "/admin/",
    "/admin/users/",
    "/admin/users/extra",
    "/admin?bypass=true",
    "/admin/platform",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      pathname,
    );
  }
});

test("allows exact mobile association documents for GET and HEAD only", () => {
  for (const pathname of [
    "/.well-known/assetlinks.json",
    "/.well-known/apple-app-site-association",
    "/apple-app-site-association",
  ]) {
    assert.equal(classifyUnconfiguredRoute(pathname, "GET"), "allow-public");
    assert.equal(classifyUnconfiguredRoute(pathname, "HEAD"), "allow-public");
    assert.equal(
      classifyUnconfiguredRoute(pathname, "POST"),
      "deny-unconfigured",
    );
    assert.equal(
      classifyUnconfiguredRoute(`${pathname}/`, "GET"),
      "deny-unconfigured",
    );
    assert.equal(
      classifyUnconfiguredRoute(`${pathname}/extra`, "GET"),
      "deny-unconfigured",
    );
  }
});

test("denies every current workspace and admin route", () => {
  for (const pathname of [
    "/chat",
    "/dashboard",
    "/documents",
    "/documents/doc-123",
    "/knowledge",
    "/notifications",
    "/profile",
    "/search",
    "/rag",
    "/utility",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      pathname,
    );
  }
});

test("fails closed for unknown pages and future APIs", () => {
  for (const pathname of [
    "/people",
    "/future-product-route",
    "/san-pham/extra",
    "/nguyen-tac/extra",
    "/nang-luc/extra",
    "/quy-trinh/extra",
    "/api/auth/google",
    "/api/documents/doc-123",
    "/api/documents/secret.pdf",
    "/api/demo-leads/extra",
    "/documents/secret.pdf",
    "/unknown.js",
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      pathname,
    );
  }
});

test("does not accept malformed or query-bearing input as an allow decision", () => {
  for (const pathname of [
    "",
    "login",
    "/login?bypass=true",
    "/api/demo-leads?bypass=true",
    null,
    undefined,
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "deny-unconfigured",
      String(pathname),
    );
  }
});
