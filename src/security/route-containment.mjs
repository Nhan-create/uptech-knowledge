const PUBLIC_APPLICATION_PATHS = new Set([
  "/",
  "/login",
  "/san-pham",
  "/nguyen-tac",
  "/nang-luc",
  "/quy-trinh",
  "/api/demo-leads",
]);

const AUTH_INGRESS_PATHS = new Set([
  "/api/v1/auth/google/transactions",
  "/api/v1/auth/google/callback",
  "/api/v1/auth/session",
  "/api/v1/auth/logout",
]);

const PROTECTED_APPLICATION_PATHS = new Set(["/home"]);

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
export function classifyUnconfiguredRoute(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    return "deny-unconfigured";
  }

  // These approved login paths are intentionally matched before pathname
  // normalization so a trailing slash cannot expand the auth surface.
  if (AUTH_INGRESS_PATHS.has(pathname)) {
    return "allow-auth-ingress";
  }

  if (PROTECTED_APPLICATION_PATHS.has(pathname)) {
    return "allow-protected";
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
