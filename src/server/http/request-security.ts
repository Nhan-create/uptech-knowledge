import { credentialMatchesHash } from "../sessions/session-security.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

export type RequestCredential =
  | { readonly ok: true; readonly kind: "none" }
  | { readonly ok: true; readonly kind: "cookie"; readonly credential: string }
  | { readonly ok: true; readonly kind: "bearer"; readonly credential: string }
  | {
      readonly ok: false;
      readonly reason:
        | "conflicting_credentials"
        | "malformed_authorization"
        | "malformed_session_cookie";
    };

export type CsrfDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "origin_mismatch"
        | "cross_site_request"
        | "missing_or_invalid_token";
    };

const COOKIE_CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCEPTED_FETCH_SITES = new Set(["same-origin", "same-site"]);

function extractSessionCookies(cookieHeader: string | null): string[] {
  if (cookieHeader === null) {
    return [];
  }

  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name === WEB_SESSION_COOKIE_NAME) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  return values;
}

export function classifyRequestCredential(headers: Headers): RequestCredential {
  const sessionCookies = extractSessionCookies(headers.get("cookie"));
  if (sessionCookies.length > 1 || sessionCookies.some((value) => value === "")) {
    return { ok: false, reason: "malformed_session_cookie" };
  }

  const authorization = headers.get("authorization");
  const bearerMatch = authorization?.match(/^Bearer[\t ]+([^\s,]+)$/iu) ?? null;
  if (authorization !== null && bearerMatch === null) {
    return { ok: false, reason: "malformed_authorization" };
  }

  const sessionCredential = sessionCookies[0];
  const bearerCredential = bearerMatch?.[1];
  if (sessionCredential !== undefined && bearerCredential !== undefined) {
    return { ok: false, reason: "conflicting_credentials" };
  }
  if (sessionCredential !== undefined) {
    return { ok: true, kind: "cookie", credential: sessionCredential };
  }
  if (bearerCredential !== undefined) {
    return { ok: true, kind: "bearer", credential: bearerCredential };
  }
  return { ok: true, kind: "none" };
}

export interface VerifyWebCsrfInput {
  readonly method: string;
  readonly credential_kind: "none" | "cookie" | "bearer";
  readonly headers: Headers;
  readonly allowed_origin: string;
  readonly expected_csrf_hash: string;
}

export function verifyWebCsrf(input: VerifyWebCsrfInput): CsrfDecision {
  const method = input.method.toUpperCase();
  if (
    input.credential_kind !== "cookie" ||
    !COOKIE_CSRF_METHODS.has(method)
  ) {
    return { allowed: true };
  }

  if (input.headers.get("origin") !== input.allowed_origin) {
    return { allowed: false, reason: "origin_mismatch" };
  }

  const fetchSite = input.headers.get("sec-fetch-site");
  if (fetchSite !== null && !ACCEPTED_FETCH_SITES.has(fetchSite)) {
    return { allowed: false, reason: "cross_site_request" };
  }

  const token = input.headers.get("x-csrf-token");
  if (
    token === null ||
    !credentialMatchesHash(token, input.expected_csrf_hash)
  ) {
    return { allowed: false, reason: "missing_or_invalid_token" };
  }

  return { allowed: true };
}
