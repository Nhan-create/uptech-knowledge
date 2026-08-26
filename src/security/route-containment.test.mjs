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
  ]) {
    assert.equal(
      classifyUnconfiguredRoute(pathname),
      "allow-auth-ingress",
      pathname,
    );
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

test("denies every current workspace and admin route", () => {
  for (const pathname of [
    "/admin",
    "/admin/users",
    "/chat",
    "/dashboard",
    "/documents",
    "/documents/doc-123",
    "/knowledge",
    "/notifications",
    "/profile",
    "/search",
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
