const PUBLIC_APPLICATION_PATHS = new Set([
  "/",
  "/login",
  "/san-pham",
  "/nguyen-tac",
  "/nang-luc",
  "/quy-trinh",
  "/dieu-khoan-su-dung",
  "/chinh-sach-bao-mat",
  "/api/demo-leads",
]);

const AUTH_INGRESS_PATHS = new Set([
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
]);

const INTERNAL_CRON_PATHS = new Set([
  "/api/internal/cron/google-directory",
]);

const DIRECTORY_CONSENT_METHODS = new Map([
  ["/api/v1/admin/connectors/google-directory/transactions", "POST"],
  ["/api/v1/admin/connectors/google-directory/callback", "GET"],
]);

const WORKSPACE_BOOTSTRAP_METHODS = new Map([
  ["/api/v1/onboarding/google-workspace/transactions", "POST"],
  ["/api/v1/onboarding/google-workspace/callback", "GET"],
  ["/api/v1/onboarding/google-workspace/status", "GET"],
  ["/api/v1/onboarding/google-workspace/sync-retry", "POST"],
  ["/api/v1/onboarding/google-workspace/finish", "POST"],
]);

const PROTECTED_APPLICATION_PATHS = new Set([
  "/home",
  "/admin",
  "/admin/users",
  "/admin/billing",
  "/admin/connectors",
  "/admin/permissions",
  "/admin/audit-logs",
  "/admin/settings",
]);

const MOBILE_ASSOCIATION_PATHS = new Set([
  "/.well-known/assetlinks.json",
  "/.well-known/apple-app-site-association",
  "/apple-app-site-association",
]);

const PUBLIC_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/file.svg",
  "/globe.svg",
  "/logo-uptech-white.svg",
  "/logo.png",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

const PUBLIC_ASSET_PREFIXES = ["/_next/", "/media/"];

function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    return null;
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

/**
 * Login-slice containment policy.
 *
 * This is deliberately an exact allowlist. The proxy only contains the route
 * surface; auth ingress handlers enforce their HTTP contracts and the /home
 * route enforces the approved session contract. This policy must not become
 * the eventual authorization engine.
 */
export function classifyUnconfiguredRoute(pathname, method) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    return "deny-unconfigured";
  }

  // These approved login paths are intentionally matched before pathname
  // normalization so a trailing slash cannot expand the auth surface.
  if (AUTH_INGRESS_PATHS.has(pathname)) {
    return "allow-auth-ingress";
  }

  if (INTERNAL_CRON_PATHS.has(pathname)) {
    return method === "GET" ? "allow-auth-ingress" : "deny-unconfigured";
  }

  if (DIRECTORY_CONSENT_METHODS.has(pathname)) {
    return DIRECTORY_CONSENT_METHODS.get(pathname) === method
      ? "allow-auth-ingress"
      : "deny-unconfigured";
  }

  if (WORKSPACE_BOOTSTRAP_METHODS.has(pathname)) {
    return WORKSPACE_BOOTSTRAP_METHODS.get(pathname) === method
      ? "allow-auth-ingress"
      : "deny-unconfigured";
  }

  if (PROTECTED_APPLICATION_PATHS.has(pathname)) {
    return "allow-protected";
  }

  if (MOBILE_ASSOCIATION_PATHS.has(pathname)) {
    return method === "GET" || method === "HEAD"
      ? "allow-public"
      : "deny-unconfigured";
  }

  const normalizedPathname = normalizePathname(pathname);

  if (
    normalizedPathname !== null &&
    (PUBLIC_APPLICATION_PATHS.has(normalizedPathname) ||
      PUBLIC_ASSET_PATHS.has(normalizedPathname) ||
      PUBLIC_ASSET_PREFIXES.some((prefix) =>
        normalizedPathname.startsWith(prefix),
      ))
  ) {
    return "allow-public";
  }

  return "deny-unconfigured";
}
